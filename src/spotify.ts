import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';

// OJO: se leen como funciones, no como constantes fijas al importar el
// módulo — así, si guardas las credenciales desde el panel de
// Configuración mientras ALYA ya está corriendo, se usan de inmediato
// sin tener que reiniciar la app.
function getClientId(): string {
    return process.env.SPOTIFY_CLIENT_ID ?? '';
}

function getClientSecret(): string {
    return process.env.SPOTIFY_CLIENT_SECRET ?? '';
}

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-modify-playback-state user-read-playback-state';

const TOKENS_FILE = path.join(app.getPath('userData'), 'spotify-tokens.json');

interface SpotifyTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // epoch ms
}

interface SpotifyTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

interface SpotifySearchResponse {
    tracks?: {
        items?: Array<{
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
        }>;
    };
}

function loadTokens(): SpotifyTokens | null {
    try {
        return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function saveTokens(tokens: SpotifyTokens): void {
    fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

function checkCredentials(): void {
    if (!getClientId() || !getClientSecret()) {
        throw new Error(
            'Falta configurar SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en el .env (ver README).'
        );
    }
}

/**
 * Arranca el proceso de login con Spotify: abre tu navegador para que
 * apruebes el acceso, y levanta un mini-servidor local temporal para
 * recibir la respuesta (se cierra solo apenas la recibe).
 */
export function startSpotifyAuth(): Promise<void> {
    checkCredentials();

    return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutHandle: NodeJS.Timeout;

        const server = http.createServer(async (req, res) => {
            // El navegador a veces pide cosas de más (ej. /favicon.ico) al mismo
            // origen — las ignoramos por completo, solo nos interesa /callback.
            if (!req.url || !req.url.startsWith('/callback')) {
                res.writeHead(404);
                res.end();
                return;
            }

            const url = new URL(req.url, REDIRECT_URI);
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            if (error) {
                res.end('Acceso rechazado. Ya puedes cerrar esta pestaña.');
                finish(new Error(`Spotify rechazó el acceso: ${error}`));
                return;
            }

            if (!code) {
                res.end('Algo salió mal, no llegó ningún código. Ya puedes cerrar esta pestaña.');
                finish(new Error('Spotify no mandó un código de autorización.'));
                return;
            }

            // Importante: NO le decimos "listo" al navegador hasta confirmar que
            // el intercambio por tokens de verdad funcionó — si no, quedaría
            // diciendo "conectado" aunque hubiera fallado después.
            try {
                await exchangeCodeForTokens(code);
                res.end('¡Listo! ALYA ya está conectada a tu Spotify. Ya puedes cerrar esta pestaña.');
                finish(null);
            } catch (err) {
                res.end('Algo falló conectando con Spotify. Ya puedes cerrar esta pestaña e intentar de nuevo.');
                finish(err as Error);
            }
        });

        function finish(err: Error | null): void {
            if (settled) return; // ya se resolvió/rechazó una vez, ignoramos cualquier petición extra
            settled = true;
            clearTimeout(timeoutHandle);
            server.close();
            if (err) reject(err);
            else resolve();
        }

        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                finish(
                    new Error(
                        'El puerto 8888 ya está en uso (puede que haya un intento de conexión anterior ' +
                        'colgado) — cierra ALYA por completo y ábrela de nuevo antes de reintentar.'
                    )
                );
            } else {
                finish(err);
            }
        });

        server.listen(8888, '127.0.0.1', () => {
            const authUrl =
                `https://accounts.spotify.com/authorize?` +
                `client_id=${encodeURIComponent(getClientId())}` +
                `&response_type=code` +
                `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
                `&scope=${encodeURIComponent(SCOPES)}`;
            shell.openExternal(authUrl);
        });

        // Si nadie completa el login en 3 minutos, no dejamos el servidor
        // colgado para siempre.
        timeoutHandle = setTimeout(() => {
            finish(new Error('Se agotó el tiempo esperando el login de Spotify (3 min).'));
        }, 180000);
    });
}

async function exchangeCodeForTokens(code: string): Promise<void> {
    const basicAuth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64');

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        }),
    });

    if (!response.ok) {
        throw new Error(`Spotify rechazó el intercambio de token: ${response.status}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    saveTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
        expiresAt: Date.now() + data.expires_in * 1000,
    });
}

async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
    const basicAuth = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64');

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }),
    });

    if (!response.ok) {
        throw new Error('No se pudo renovar la conexión con Spotify — puede que haya que reconectar.');
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    const tokens: SpotifyTokens = {
        accessToken: data.access_token,
        // Spotify no siempre manda un refresh_token nuevo — si no lo manda, seguimos con el mismo.
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
    };
    saveTokens(tokens);
    return tokens;
}

async function getValidAccessToken(): Promise<string> {
    checkCredentials();
    const tokens = loadTokens();

    if (!tokens) {
        throw new Error(
            'ALYA todavía no está conectada a tu Spotify — pídele que se conecte primero.'
        );
    }

    // Renovamos un poco antes de que expire de verdad (30s de margen).
    if (Date.now() > tokens.expiresAt - 30000) {
        const renewed = await refreshAccessToken(tokens.refreshToken);
        return renewed.accessToken;
    }

    return tokens.accessToken;
}

export function isSpotifyConnected(): boolean {
    return loadTokens() !== null;
}

export interface SpotifyTrack {
    uri: string;
    name: string;
    artist: string;
}

export async function searchTrack(query: string): Promise<SpotifyTrack | null> {
    const token = await getValidAccessToken();

    const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
        throw new Error(`Spotify respondió con error al buscar: ${response.status}`);
    }

    const data = (await response.json()) as SpotifySearchResponse;
    const track = data.tracks?.items?.[0];
    if (!track) return null;

    return {
        uri: track.uri,
        name: track.name,
        artist: track.artists?.[0]?.name ?? 'Desconocido',
    };
}

/**
 * Abre el reproductor WEB de Spotify (open.spotify.com) en tu navegador
 * real, en vez de pelear con la app instalada — evita todos los líos de
 * rutas distintas según cómo esté instalada (Store, instalador normal,
 * etc). Una vez que tengas sesión iniciada ahí, cuenta como "dispositivo
 * activo" para la API igual que la app de escritorio.
 */
async function openSpotifyRobustly(): Promise<void> {
    await shell.openExternal('https://open.spotify.com');
}

/**
 * Reproduce una canción en el dispositivo activo de Spotify (la app de
 * escritorio, un altavoz conectado, lo que esté sonando ahí).
 */
export async function playTrack(uri: string): Promise<void> {
    const token = await getValidAccessToken();

    const response = await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [uri] }),
    });

    console.log(`[Spotify] PUT /me/player/play para ${uri} -> código ${response.status}`);

    if (response.status === 404) {
        const err = new Error('No hay ningún dispositivo de Spotify activo.');
        (err as Error & { noActiveDevice: boolean }).noActiveDevice = true;
        throw err;
    }

    if (!response.ok && response.status !== 204) {
        throw new Error(`Spotify no pudo reproducir la canción: ${response.status}`);
    }
}

/**
 * Igual que playTrack, pero si no hay ningún dispositivo activo, abre la
 * app de Spotify sola, espera a que arranque, y reintenta UNA vez antes
 * de rendirse.
 */
async function playTrackWithAutoOpen(uri: string): Promise<void> {
    try {
        await playTrack(uri);
    } catch (err) {
        if (!(err as Error & { noActiveDevice?: boolean }).noActiveDevice) {
            throw err; // fue otro tipo de error, no lo tapamos reintentando
        }

        await openSpotifyRobustly();
        // Spotify tarda unos segundos en arrancar y registrarse como
        // dispositivo activo — sin esta espera, el reintento fallaría igual.
        await new Promise((resolve) => setTimeout(resolve, 6000));

        try {
            await playTrack(uri);
        } catch {
            throw new Error(
                'Abrí Spotify, pero sigue sin aparecer como dispositivo activo — puede que tarde ' +
                'un poco más en cargar. Pídemelo de nuevo en unos segundos.'
            );
        }
    }
}

/** Busca y reproduce en un solo paso — lo que usa la herramienta de ALYA. */
export async function searchAndPlaySpotify(query: string): Promise<SpotifyTrack> {
    const track = await searchTrack(query);
    if (!track) {
        throw new Error(`No encontré "${query}" en Spotify.`);
    }

    console.log(`[Spotify] Buscando "${query}" -> encontré: "${track.name}" de ${track.artist} (${track.uri})`);

    await playTrackWithAutoOpen(track.uri);

    console.log(`[Spotify] Comando de reproducir enviado sin error para: ${track.uri}`);

    return track;
}