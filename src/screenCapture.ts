import { BrowserWindow, desktopCapturer, screen } from 'electron';

export interface ScreenCapture {
    base64: string;
    mimeType: string;
}

// Tope de tamaño de cada captura. Se captura a la resolución real de la
// pantalla (para que el texto chico se lea), pero un monitor 4K entero
// no aporta más y sí pesa: de ahí para arriba se reduce.
const MAX_CAPTURE_WIDTH = 2560;
const MAX_CAPTURE_HEIGHT = 1600;
const JPEG_QUALITY = 90;

/** El tamaño (en píxeles reales) que hace falta para la pantalla más grande. */
function captureSize(): { width: number; height: number } {
    let width = 1920;
    let height = 1080;
    try {
        for (const display of screen.getAllDisplays()) {
            width = Math.max(width, Math.round(display.size.width * display.scaleFactor));
            height = Math.max(height, Math.round(display.size.height * display.scaleFactor));
        }
    } catch {
        // sin datos de las pantallas: se queda con 1920×1080
    }
    return { width: Math.min(width, MAX_CAPTURE_WIDTH), height: Math.min(height, MAX_CAPTURE_HEIGHT) };
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hace invisibles las ventanas de ALYA mientras dura "task" y las deja
 * como estaban. Sin esto, al pedirle que mire la pantalla lo que más se
 * vería es su propia ventana tapando lo que querías mostrarle.
 * Se usa la opacidad (no ocultar/mostrar) para que la ventana no pierda
 * el foco ni parpadee en la barra de tareas.
 */
async function withAlyaWindowsHidden<T>(task: () => Promise<T>): Promise<T> {
    const windows = BrowserWindow.getAllWindows().filter(
        (win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized()
    );
    const previous = windows.map((win) => win.getOpacity());

    try {
        for (const win of windows) win.setOpacity(0);
        // Un instante para que Windows redibuje el escritorio sin ellas.
        if (windows.length > 0) await wait(180);
        return await task();
    } finally {
        windows.forEach((win, index) => {
            if (!win.isDestroyed()) win.setOpacity(previous[index] ?? 1);
        });
    }
}

/**
 * Captura TODAS las pantallas conectadas (multi-monitor), una imagen por
 * pantalla, sin que salgan las ventanas de ALYA. Usa desktopCapturer,
 * que viene integrado en Electron — no requiere instalar nada externo.
 */
export async function captureAllScreens(): Promise<ScreenCapture[]> {
    const sources = await withAlyaWindowsHidden(() =>
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: captureSize() })
    );

    const captures = sources
        .filter((source) => !source.thumbnail.isEmpty())
        .map((source) => ({
            base64: source.thumbnail.toJPEG(JPEG_QUALITY).toString('base64'),
            mimeType: 'image/jpeg',
        }));

    if (captures.length === 0) {
        throw new Error('No se encontró ninguna pantalla para capturar.');
    }
    return captures;
}