import { BrowserWindow, session } from 'electron';
import { getResourcePath } from './resourcePaths';

// --- Spotify sin la API ---
// Guardar una canción en "Canciones que te gustan" usando el reproductor
// web de Spotify (open.spotify.com) dentro de una ventana propia de ALYA,
// igual que lo harías a mano: buscar la canción y pulsar el botón de
// añadir. No hace falta crear una app en Spotify for Developers ni
// Client ID / Secret: solo iniciar sesión UNA vez en esa ventana (la
// sesión queda guardada en este PC).
//
// Dos cuidados importantes:
// - La búsqueda de Spotify SIEMPRE devuelve algo, aunque no tenga nada
//   que ver. Por eso nunca se guarda "el primer resultado": se compara
//   título y artista con lo pedido, y si ninguno coincide no se guarda
//   nada y se devuelven los más parecidos.
// - Depende de cómo está armada la página de Spotify, así que puede
//   dejar de funcionar si Spotify la cambia. Cada paso queda anotado en
//   la consola ("[ALYA][Spotify] ...") para poder ver qué pasó de verdad.

const PARTITION = 'persist:alya-spotify-web'; // cookies propias, separadas del resto de ALYA
const LOAD_TIMEOUT_MS = 25000;
const WAIT_HIDDEN_MS = 9000; // cuánto esperar los resultados con la ventana oculta
const WAIT_VISIBLE_MS = 15000; // y cuánto más con la ventana a la vista

export type SpotifySaveStatus =
    | 'saved'
    | 'already'
    | 'login'
    | 'no_match'
    | 'not_loaded'
    | 'unconfirmed'
    | 'error';

export interface SpotifyCandidate {
    title: string;
    artist: string;
}

export interface SpotifySaveResult {
    status: SpotifySaveStatus;
    /** La canción de Spotify que coincidió con lo pedido (si hubo). */
    title?: string;
    artist?: string;
    /** Con 'no_match': lo más parecido que devolvió la búsqueda (NO se guardó nada). */
    candidates?: SpotifyCandidate[];
    message: string;
}

let spotifyWindow: BrowserWindow | null = null;
let busy = false;

// --- Presentarse ante Spotify como un Chrome de escritorio actual ---
// El navegador que trae Electron se identifica como
// "... alya/1.0.7 Chrome/126... Electron/31...", y con eso Spotify NO
// entrega su reproductor de escritorio: manda la versión para celulares
// ("Mobile Web Player"), que tiene otra estructura y otra forma de buscar.
// Por eso esta ventana se presenta como un Chrome normal y reciente, en
// los tres lugares donde una página puede mirarlo: el texto de
// identificación, las cabeceras que viajan con cada pedido, y lo que ve
// el código de la página.
//
// Si algún día Spotify vuelve a mandar la versión móvil, lo primero a
// probar es subir este número (la versión de Chrome que esté vigente).
const MIN_CHROME_MAJOR = 152;

function desktopChrome(): { major: string; userAgent: string } {
    const real = parseInt((process.versions.chrome ?? '0').split('.')[0], 10) || 0;
    const major = String(Math.max(real, MIN_CHROME_MAJOR));
    return {
        major,
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    };
}

async function applyDesktopIdentity(win: BrowserWindow): Promise<void> {
    const { major, userAgent } = desktopChrome();
    win.webContents.setUserAgent(userAgent);

    // Lo anterior solo cambia el texto. Para que también cambien las
    // cabeceras "sec-ch-ua" y navigator.userAgentData hay que pedírselo al
    // motor del navegador por su canal de depuración.
    try {
        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) dbg.attach('1.3');
        const command = dbg.sendCommand('Emulation.setUserAgentOverride', {
            userAgent,
            platform: 'Win32',
            userAgentMetadata: {
                brands: [
                    { brand: 'Chromium', version: major },
                    { brand: 'Google Chrome', version: major },
                    { brand: 'Not?A_Brand', version: '24' },
                ],
                fullVersionList: [
                    { brand: 'Chromium', version: `${major}.0.0.0` },
                    { brand: 'Google Chrome', version: `${major}.0.0.0` },
                    { brand: 'Not?A_Brand', version: '24.0.0.0' },
                ],
                platform: 'Windows',
                platformVersion: '15.0.0',
                architecture: 'x86',
                model: '',
                mobile: false,
                bitness: '64',
                wow64: false,
            },
        });
        // Con límite de tiempo: si el motor no contesta este pedido, se sigue
        // igual (queda al menos el texto de identificación ya cambiado).
        await withTimeout(command, 4000, 'El ajuste de identificación del navegador');
    } catch (err) {
        log(`No se pudo ajustar la identificación completa del navegador: ${(err as Error).message}`);
    }
}

function log(text: string): void {
    console.log(`[ALYA][Spotify] ${text}`);
}

async function getWindow(): Promise<BrowserWindow> {
    if (spotifyWindow && !spotifyWindow.isDestroyed()) return spotifyWindow;

    // La identificación se fija en la sesión ANTES de crear la ventana:
    // cambiarla después no afecta a una ventana que ya existe (por eso el
    // primer intento seguía presentándose como Electron).
    session.fromPartition(PARTITION).setUserAgent(desktopChrome().userAgent);

    spotifyWindow = new BrowserWindow({
        width: 1120,
        height: 760,
        show: false,
        title: 'ALYA — Spotify',
        backgroundColor: '#121212',
        icon: getResourcePath('build', 'icon.ico'),
        webPreferences: {
            partition: PARTITION,
            contextIsolation: true,
            backgroundThrottling: false, // que la página cargue igual aunque la ventana esté oculta
        },
    });
    spotifyWindow.setMenu(null);

    // El ajuste de identificación se le pide a la página, así que primero
    // tiene que existir una: se carga una en blanco. (Pedírselo a una
    // ventana recién creada y vacía se quedaba esperando para siempre — eso
    // era lo que dejaba a ALYA en "Procesando…".)
    await withTimeout(spotifyWindow.loadURL('about:blank'), 5000, 'La ventana de Spotify').catch(() => { });
    await applyDesktopIdentity(spotifyWindow);

    // Cerrar la ventana solo la oculta: así la sesión y la página siguen listas.
    spotifyWindow.on('close', (event) => {
        event.preventDefault();
        spotifyWindow?.hide();
    });

    return spotifyWindow;
}

function searchUrl(query: string): string {
    return `https://open.spotify.com/search/${encodeURIComponent(query)}/tracks`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera una operación, pero no para siempre: si no termina en "ms",
 * falla con un error claro. Todo lo que se le pide a la ventana de
 * Spotify pasa por acá — una página que no contesta nunca debe dejar a
 * ALYA pegada en "Procesando…".
 */
function withTimeout<T>(operation: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} no respondió a tiempo.`)), ms);
        operation.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/** Ejecuta código dentro de la página de Spotify, con límite de tiempo. */
function runInPage<T>(win: BrowserWindow, code: string, ms = 6000): Promise<T> {
    return withTimeout(win.webContents.executeJavaScript(code, true) as Promise<T>, ms, 'La página de Spotify');
}

async function load(win: BrowserWindow, url: string): Promise<void> {
    try {
        await Promise.race([
            win.loadURL(url),
            new Promise<void>((_resolve, reject) =>
                setTimeout(() => reject(new Error('Spotify tardó demasiado en cargar.')), LOAD_TIMEOUT_MS)
            ),
        ]);
    } catch (err) {
        // ERR_ABORTED aparece cuando la página se redirige sola mientras
        // carga: no es un fallo, la página termina cargando igual.
        if (!String((err as Error).message).includes('ERR_ABORTED')) throw err;
    }
}

async function isMobilePlayer(win: BrowserWindow): Promise<boolean> {
    await sleep(1200); // la redirección a la versión móvil ocurre apenas carga
    return runInPage<boolean>(
        win,
        `/mobile web player/i.test(document.title) || /utm_medium=mobile|fallback=getapp/.test(location.href)`
    ).catch(() => false);
}

/** Espera a que aparezcan filas de resultados. Devuelve si aparecieron. */
async function waitForRows(win: BrowserWindow, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const count = await runInPage<number>(
            win,
            `document.querySelectorAll('[data-testid="tracklist-row"]').length`,
            4000
        ).catch(() => 0);
        if (count > 0) return true;
        await sleep(400);
    }
    return false;
}

// Lo que se ejecuta DENTRO de la página de resultados (ya cargada). Lee
// las primeras filas, elige la que coincide con el título y artista
// pedidos y pulsa su botón de "Añadir a Canciones que te gustan". Ese
// botón es el único de la fila con estado marcado/desmarcado
// (aria-checked), así se lo encuentra sin depender del idioma de Spotify.
function buildSaveScript(wanted: { title: string; artist: string }): string {
    return `
(async () => {
    const wanted = ${JSON.stringify(wanted)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const allRows = () => [...document.querySelectorAll('[data-testid="tracklist-row"]')];

    // Para comparar: minúsculas, sin acentos, sin lo que va entre paréntesis.
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
        .replace(/\\(.*?\\)|\\[.*?\\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1);
    // Qué parte de las palabras de "a" aparece en "b" (0 a 1).
    const overlap = (a, b) => {
        const A = tokens(a); const B = new Set(tokens(b));
        return A.length ? A.filter((t) => B.has(t)).length / A.length : 0;
    };

    await sleep(900); // que la lista termine de llenarse

    const loggedOut = !!document.querySelector('[data-testid="login-button"]');
    const rows = allRows().slice(0, 10).map((row) => ({
        row,
        title: (row.querySelector('a[href*="/track/"]')?.textContent || '').trim(),
        artist: [...row.querySelectorAll('a[href*="/artist/"]')].map((a) => a.textContent.trim()).join(', '),
    }));

    const hasArtist = tokens(wanted.artist).length > 0;
    const scored = rows.map((r) => {
        const titleIn = overlap(wanted.title, r.title);
        const titleBack = overlap(r.title, wanted.title);
        const artistScore = hasArtist ? Math.max(overlap(wanted.artist, r.artist), overlap(r.artist, wanted.artist)) : 0;
        // Sin artista para contrastar, el título tiene que coincidir casi exacto.
        const titleOk = titleIn >= 0.75 && titleBack >= (hasArtist ? 0.5 : 0.75);
        const artistOk = !hasArtist || artistScore >= 0.5;
        return { ...r, ok: titleOk && artistOk, score: titleIn + titleBack + artistScore };
    });

    const candidates = scored.slice(0, 3).map((r) => ({ title: r.title, artist: r.artist }));
    const best = scored.filter((r) => r.ok).sort((a, b) => b.score - a.score)[0];
    if (!best) return { status: 'no_match', candidates };

    const found = { title: best.title, artist: best.artist };
    if (loggedOut) return { status: 'login', ...found };

    const likeButton = () => best.row.querySelector('button[aria-checked]');
    const button = likeButton();
    if (!button) return { status: 'unconfirmed', ...found, detail: 'no encontré el botón de añadir en la fila' };
    if (button.getAttribute('aria-checked') === 'true') return { status: 'already', ...found };

    button.click();

    const until = Date.now() + 6000;
    while (Date.now() < until) {
        await sleep(200);
        const current = likeButton();
        if (current && current.getAttribute('aria-checked') === 'true') return { status: 'saved', ...found };
    }
    return { status: 'unconfirmed', ...found, detail: 'pulsé el botón pero no quedó marcado' };
})()
`;
}

// Foto de lo que muestra la página cuando no aparecen resultados, para
// poder entender por qué (queda en la consola).
const DIAGNOSTIC_SCRIPT = `({
    url: location.href,
    title: document.title,
    mobile: /mobile web player/i.test(document.title) || /utm_medium=mobile|fallback=getapp/.test(location.href),
    text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 260),
    userAgent: navigator.userAgent,
})`;

/**
 * Busca una canción en Spotify y la guarda en "Canciones que te gustan",
 * SOLO si encuentra una que coincida con el título (y el artista, si se da).
 * NUNCA rechaza: cualquier problema vuelve como status 'error'.
 */
const TOTAL_TIMEOUT_MS = 75000; // pase lo que pase, la herramienta contesta antes de esto

export async function saveToSpotifyLikedSongs(title: string, artist = ''): Promise<SpotifySaveResult> {
    const cleanTitle = title.replace(/\s+/g, ' ').trim();
    const cleanArtist = artist.replace(/\s+/g, ' ').trim();
    if (!cleanTitle) return { status: 'error', message: 'Falta el título de la canción.' };
    if (busy) return { status: 'error', message: 'Ya estoy guardando otra canción en Spotify, dame un momento.' };

    busy = true;
    log(`Pedido: guardar "${cleanTitle}"${cleanArtist ? ` de ${cleanArtist}` : ''}.`);
    try {
        return await withTimeout(searchAndSave(cleanTitle, cleanArtist), TOTAL_TIMEOUT_MS, 'Spotify');
    } catch (err) {
        // Se pasó del límite total (o falló algo inesperado): se descarta la
        // ventana para que el próximo intento arranque limpio.
        log(`Abandonado: ${(err as Error).message}`);
        if (spotifyWindow && !spotifyWindow.isDestroyed()) spotifyWindow.destroy();
        spotifyWindow = null;
        return {
            status: 'error',
            message: `No pude usar Spotify: ${(err as Error).message} Es un problema técnico con la página, no con la canción.`,
        };
    } finally {
        busy = false;
    }
}

async function searchAndSave(cleanTitle: string, cleanArtist: string): Promise<SpotifySaveResult> {
    const query = `${cleanTitle} ${cleanArtist}`.trim();
    const asked = `"${cleanTitle}"${cleanArtist ? ` de ${cleanArtist}` : ''}`;

    try {
        const win = await getWindow();
        const url = searchUrl(query);
        const wasVisible = win.isVisible();
        log(`Buscando ${asked} → ${url}`);
        await load(win, url);

        // Si aun así Spotify mandó su versión para celulares, puede ser por
        // una preferencia que dejó guardada en un intento anterior: se
        // borran los datos de Spotify de ESTA ventana y se prueba una vez más.
        let stillMobile = false;
        if (await isMobilePlayer(win)) {
            log('Spotify entregó la versión para celulares; borro sus datos guardados en esta ventana y reintento.');
            await withTimeout(win.webContents.session.clearStorageData(), 8000, 'Borrar los datos de Spotify').catch(() => { });
            await load(win, url);
            stillMobile = await isMobilePlayer(win);
        }

        // Primero con la ventana oculta; si los resultados no aparecen, se la
        // muestra (sin quitarte el foco) por si la página necesita estar a la vista.
        // (si sigue siendo la versión móvil no hay nada que esperar)
        let ready = stillMobile ? false : await waitForRows(win, WAIT_HIDDEN_MS);
        let shownToHelp = false;
        if (!ready && !stillMobile && !win.isVisible()) {
            log('Los resultados no aparecieron con la ventana oculta; la muestro y sigo esperando.');
            win.showInactive();
            shownToHelp = true;
            ready = await waitForRows(win, WAIT_VISIBLE_MS);
        }

        if (!ready) {
            const snapshot = await runInPage<{ mobile?: boolean }>(win, DIAGNOSTIC_SCRIPT).catch(() => null);
            log(`La página de Spotify no mostró resultados. Lo que se ve: ${JSON.stringify(snapshot)}`);
            win.show();
            return {
                status: 'not_loaded',
                message:
                    (snapshot?.mobile
                        ? 'Spotify entregó su versión para celulares en vez del reproductor de escritorio, y ahí no puedo buscar ni guardar. '
                        : 'La página de Spotify no llegó a mostrar resultados, así que no pude buscar la canción. ') +
                    'Esto NO significa que la canción no exista en Spotify: es un problema técnico con la página. ' +
                    'Dejé la ventana de Spotify abierta para ver qué muestra; el detalle quedó en la consola.',
            };
        }

        const found = await runInPage<{
            status: SpotifySaveStatus;
            title?: string;
            artist?: string;
            candidates?: SpotifyCandidate[];
            detail?: string;
        }>(win, buildSaveScript({ title: cleanTitle, artist: cleanArtist }), 20000);
        log(`Resultado: ${JSON.stringify(found)}`);

        const song = found.title ? `"${found.title}"${found.artist ? ` de ${found.artist}` : ''}` : asked;

        switch (found.status) {
            case 'saved':
                if (shownToHelp && !wasVisible) win.hide();
                return { ...found, message: `Guardé ${song} en Canciones que te gustan.` };

            case 'already':
                if (shownToHelp && !wasVisible) win.hide();
                return { ...found, message: `${song} ya estaba en Canciones que te gustan.` };

            case 'login':
                // Primera vez: hay que iniciar sesión. Se muestra la ventana en la
                // pantalla de inicio de sesión; al terminar, Spotify vuelve solo a
                // la búsqueda de esta canción.
                await load(win, `https://accounts.spotify.com/login?continue=${encodeURIComponent(url)}`).catch(() => { });
                win.show();
                win.focus();
                return {
                    ...found,
                    message:
                        `Encontré ${song} en Spotify, pero todavía no hay sesión de Spotify iniciada en ALYA. ` +
                        'Abrí una ventana para iniciar sesión (solo hace falta una vez). Cuando termines, ' +
                        'pídeme de nuevo que guarde la canción.',
                };

            case 'no_match': {
                if (shownToHelp && !wasVisible) win.hide();
                const similar = (found.candidates ?? [])
                    .map((c) => `"${c.title}" de ${c.artist}`)
                    .join('; ');
                return {
                    status: 'no_match',
                    candidates: found.candidates,
                    message:
                        `Busqué ${asked} en Spotify y ningún resultado coincide, así que NO guardé nada. ` +
                        (similar ? `Lo que devolvió la búsqueda: ${similar}. ` : '') +
                        'Puede que en Spotify tenga otro título o que haya que buscarla con otras palabras.',
                };
            }

            default:
                // No se pudo confirmar: se deja la búsqueda a la vista para terminar a mano.
                win.show();
                win.focus();
                return {
                    ...found,
                    status: 'unconfirmed',
                    message:
                        `Encontré ${song}, pero no pude confirmar que quedara guardada (${found.detail ?? 'sin detalle'}). ` +
                        'Te dejé abierta la búsqueda en Spotify: el botón de añadir está al lado de la canción.',
                };
        }
    } catch (err) {
        log(`Error: ${(err as Error).message}`);
        return { status: 'error', message: `No pude usar Spotify: ${(err as Error).message}` };
    }
}