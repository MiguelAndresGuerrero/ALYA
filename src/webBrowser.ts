import { BrowserWindow, shell } from 'electron';
import { setNowPlaying } from './obsOverlay';

// Reutilizamos UNA sola ventana de navegador SOLO para música — ahí es
// donde vive la lógica de la fila de reproducción (necesita controlar
// la ventana para saber cuándo termina una canción). Para todo lo demás
// (páginas web normales, búsquedas), usamos tu navegador real (ver
// openUrl más abajo), para que tengas tu sesión de Google y todo lo
// demás ya iniciado — no una ventana aparte, sin tu cuenta.
let browserWindow: BrowserWindow | null = null;

// Fila de reproducción: canciones esperando su turno. Cuando la que está
// sonando termina, la siguiente de la fila arranca sola.
const songQueue: string[] = [];
let pollInterval: NodeJS.Timeout | null = null;
const POLL_INTERVAL_MS = 5000;

function getBrowserWindow(): BrowserWindow {
    if (browserWindow && !browserWindow.isDestroyed()) {
        return browserWindow;
    }

    browserWindow = new BrowserWindow({
        width: 960,
        height: 680,
        show: false,
        title: 'ALYA — Navegador',
    });

    browserWindow.on('closed', () => {
        browserWindow = null;
        songQueue.length = 0; // se cerró la ventana, ya no hay fila que seguir
        setNowPlaying(null); // el overlay de OBS deja de mostrar algo
    });

    return browserWindow;
}

/**
 * Abre cualquier URL en TU navegador real (Chrome, o el que tengas por
 * defecto) — con tu sesión de Google y todo lo demás ya iniciado. No usa
 * la ventana interna de ALYA (esa es solo para música).
 */
export async function openUrl(url: string): Promise<void> {
    await shell.openExternal(url);
}

/**
 * Busca en YouTube y devuelve la URL del primer resultado, sin reproducir
 * nada todavía. YouTube puede cambiar su HTML con el tiempo, así que
 * probamos varios selectores conocidos por si uno deja de funcionar.
 */
async function findFirstYouTubeResult(query: string): Promise<string> {
    const win = getBrowserWindow();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    await win.loadURL(searchUrl);

    const firstVideoUrl: string | null = await win.webContents.executeJavaScript(`
    (function() {
      const selectors = ['a#video-title', 'a#thumbnail', 'ytd-video-renderer a#video-title-link'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.href && el.href.includes('watch?v=')) return el.href;
      }
      return null;
    })();
  `);

    if (!firstVideoUrl) {
        win.show();
        win.focus();
        throw new Error(
            'No pude identificar el primer resultado automáticamente, pero te dejé abierta la ' +
            'página de búsqueda para que elijas tú.'
        );
    }

    return firstVideoUrl;
}

/**
 * Lee el título real del video actual (el que YouTube pone en la pestaña)
 * y se lo pasa al overlay de OBS.
 */
async function updateOverlayFromCurrentPage(win: BrowserWindow): Promise<void> {
    try {
        const title: string = await win.webContents.executeJavaScript(
            `document.title.replace(/ - YouTube$/, '')`
        );
        setNowPlaying(title || null);
    } catch {
        // no pasa nada si falla, el overlay solo se queda con el valor anterior
    }
}

/**
 * Revisa cada pocos segundos si la canción actual ya terminó, y si es
 * así, arranca la siguiente de la fila. Se detiene solo cuando la fila
 * queda vacía (se vuelve a activar cuando se agrega algo nuevo).
 */
function ensureQueuePolling(): void {
    if (pollInterval) return;

    pollInterval = setInterval(async () => {
        if (songQueue.length === 0) {
            clearInterval(pollInterval!);
            pollInterval = null;
            return;
        }

        if (!browserWindow || browserWindow.isDestroyed()) return;

        try {
            const ended: boolean = await browserWindow.webContents.executeJavaScript(`
        (function() {
          const v = document.querySelector('video');
          if (!v) return false;
          return v.ended || (v.duration > 0 && v.currentTime >= v.duration - 1);
        })();
      `);

            if (ended) {
                const next = songQueue.shift()!;
                await browserWindow.loadURL(next);
                await updateOverlayFromCurrentPage(browserWindow);
            }
        } catch {
            // La ventana puede estar cargando otra página en este instante — no pasa nada, probamos de nuevo en el próximo intervalo.
        }
    }, POLL_INTERVAL_MS);
}

/**
 * Busca algo en YouTube. Si no hay nada sonando ahora mismo, lo reproduce
 * directo. Si ya hay algo sonando, lo agrega al final de la fila —
 * arrancará solo cuando le toque el turno.
 */
export async function queueOrPlaySong(
    query: string
): Promise<{ playedNow: boolean; queuePosition: number }> {
    const win = getBrowserWindow();
    const videoUrl = await findFirstYouTubeResult(query);

    const currentUrl = win.webContents.getURL();
    const somethingIsPlaying = currentUrl.includes('youtube.com/watch');

    if (!somethingIsPlaying) {
        await win.loadURL(videoUrl);
        win.show();
        win.focus();
        await updateOverlayFromCurrentPage(win);
        return { playedNow: true, queuePosition: 0 };
    }

    songQueue.push(videoUrl);
    ensureQueuePolling();
    return { playedNow: false, queuePosition: songQueue.length };
}

/** Compatibilidad con el nombre anterior — ahora usa la fila por dentro. */
export async function searchAndPlayYouTube(query: string): Promise<string> {
    const result = await queueOrPlaySong(query);
    return result.playedNow ? 'reproduciendo ahora' : `agregada a la fila (posición ${result.queuePosition})`;
}