import { BrowserWindow, shell, session } from 'electron';
import { getResourcePath } from './resourcePaths';

// Ventana INVISIBLE, solo para buscar en YouTube (encontrar la URL del
// primer resultado) — nunca se muestra ni reproduce nada ahí. Una vez
// encontrada la URL, se abre de verdad en TU navegador real (Brave,
// Chrome, el que tengas puesto por defecto en Windows).
//
// Nota: como YouTube ahora abre en tu navegador real, ALYA ya NO puede
// controlar la fila de reproducción, el auto-salto de anuncios, ni
// actualizar el overlay de OBS para YouTube — esas funciones necesitan
// que ALYA controle la ventana, y tu navegador real está fuera de su
// alcance. Es un cambio a propósito, no un bug.
let searchWindow: BrowserWindow | null = null;
let adBlockingReady = false;

// Bloqueador de anuncios propio para la ventana de búsqueda (reduce el
// ruido de fondo mientras busca, aunque ya no reproduce ahí).
const AD_URL_PATTERNS = [
    '*://*.doubleclick.net/*',
    '*://*.googlesyndication.com/*',
    '*://*.googleadservices.com/*',
    '*://googleads.g.doubleclick.net/*',
    '*://pubads.g.doubleclick.net/*',
    '*://securepubads.g.doubleclick.net/*',
    '*://static.doubleclick.net/*',
    '*://*.2mdn.net/*',
    '*://*.googletagservices.com/*',
    '*://*/pagead/*',
    '*://*/api/stats/ads*',
    '*://*/ptracking*',
    '*://*/get_midroll_*',
    '*://*.google.com/pagead/*',
];

/**
 * Prepara la sesión de la ventana de búsqueda (bloqueo de anuncios +
 * extensiones cargadas a mano) — se llama UNA vez al arrancar la app.
 */
export async function initializePlayerSession(): Promise<void> {
    if (adBlockingReady) return;
    adBlockingReady = true;

    const playerSession = session.fromPartition('persist:alya-player');
    playerSession.webRequest.onBeforeRequest({ urls: AD_URL_PATTERNS }, (_details, callback) => {
        callback({ cancel: true });
    });

    await loadSideloadedExtensions(playerSession);
}

// Extensiones de Chrome cargadas a mano (Electron no puede instalarlas
// desde la tienda directo, hay que darle la carpeta ya descomprimida).
// Cada una vive en ALYA/extensions/<nombre-de-carpeta>/ — agrega ahí
// cualquier otra que quieras, no hace falta tocar código de nuevo.
const EXTENSIONS_DIR = getResourcePath('extensions');

async function loadSideloadedExtensions(playerSession: Electron.Session): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(EXTENSIONS_DIR)) return;

    const folders = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());

    for (const folder of folders) {
        const extPath = path.join(EXTENSIONS_DIR, folder.name);
        try {
            const loaded = await playerSession.loadExtension(extPath, { allowFileAccess: true });
            console.log(`[ALYA] Extensión cargada: ${loaded.name}`);
        } catch (err) {
            console.warn(`[ALYA] No pude cargar la extensión en ${extPath}:`, (err as Error).message);
        }
    }
}

function getSearchWindow(): BrowserWindow {
    if (searchWindow && !searchWindow.isDestroyed()) {
        return searchWindow;
    }

    searchWindow = new BrowserWindow({
        width: 960,
        height: 680,
        show: false, // nunca se muestra — es solo para buscar
        title: 'ALYA — Búsqueda',
        icon: getResourcePath('build', 'icon.ico'),
        webPreferences: {
            partition: 'persist:alya-player',
        },
    });

    searchWindow.on('closed', () => {
        searchWindow = null;
    });

    return searchWindow;
}

/**
 * Abre cualquier URL en TU navegador real (Brave, Chrome, el que tengas
 * por defecto) — con tu sesión ya iniciada.
 */
export async function openUrl(url: string): Promise<void> {
    await shell.openExternal(url);
}

/**
 * Busca en YouTube y devuelve la URL Y el título del primer resultado,
 * sin abrir nada todavía (eso lo hacen playImmediately/queueOrPlaySong).
 * YouTube renderiza sus resultados con JavaScript DESPUÉS de que la
 * página "terminó de cargar" — así que no basta con buscar una sola vez
 * apenas carga; reintentamos varias veces con una pequeña espera entre
 * cada intento, hasta que los resultados aparezcan de verdad.
 */
async function findFirstYouTubeResult(query: string): Promise<{ url: string; title: string }> {
    const win = getSearchWindow();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    await win.loadURL(searchUrl);

    const findScript = `
    (function() {
      const selectors = ['a#video-title', 'a#thumbnail', 'ytd-video-renderer a#video-title-link'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.href && el.href.includes('watch?v=')) {
          return { url: el.href, title: (el.title || el.textContent || '').trim() };
        }
      }
      return null;
    })();
  `;

    const MAX_INTENTOS = 10;
    const ESPERA_ENTRE_INTENTOS_MS = 500;

    let result: { url: string; title: string } | null = null;
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        result = await win.webContents.executeJavaScript(findScript);
        if (result) break;
        await new Promise((resolve) => setTimeout(resolve, ESPERA_ENTRE_INTENTOS_MS));
    }

    if (!result) {
        throw new Error(
            'No pude identificar el primer resultado de la búsqueda — probá con otras palabras.'
        );
    }

    return result;
}

/**
 * Busca algo en YouTube y lo abre en tu navegador real. Ya no interrumpe
 * ni encola nada — cada pedido abre su propia pestaña, tal como
 * funcionaría cualquier link normal.
 */
export async function playImmediately(query: string): Promise<void> {
    const { url } = await findFirstYouTubeResult(query);
    await shell.openExternal(url);
}

/**
 * Compatibilidad con el nombre anterior — ya no hay fila real (ALYA no
 * puede controlar tu navegador externo), así que esto simplemente abre
 * el video, igual que playImmediately. playedNow siempre es true.
 */
export async function queueOrPlaySong(
    query: string
): Promise<{ playedNow: boolean; queuePosition: number }> {
    const { url } = await findFirstYouTubeResult(query);
    await shell.openExternal(url);
    return { playedNow: true, queuePosition: 0 };
}

/**
 * Ya no se puede saber qué está sonando ni qué hay en fila — eso
 * necesitaba que ALYA controlara la ventana de reproducción, y ahora
 * abre en tu navegador real, fuera de su alcance.
 */
export function getQueueState(): { currentlyPlaying: string | null; queue: string[] } {
    return { currentlyPlaying: null, queue: [] };
}

/** Compatibilidad con el nombre anterior. */
export async function searchAndPlayYouTube(query: string): Promise<string> {
    await playImmediately(query);
    return 'abierto en tu navegador';
}