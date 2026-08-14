import { desktopCapturer } from 'electron';

export interface ScreenCapture {
    base64: string;
    mimeType: string;
}

/**
 * Captura TODAS las pantallas conectadas (multi-monitor) como PNG.
 * Usa desktopCapturer, que viene integrado en Electron — no requiere
 * instalar nada externo.
 */
export async function captureAllScreens(): Promise<ScreenCapture[]> {
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
    });

    if (sources.length === 0) {
        throw new Error('No se encontró ninguna pantalla para capturar.');
    }

    return sources
        .filter((source) => !source.thumbnail.isEmpty())
        .map((source) => ({
            base64: source.thumbnail.toPNG().toString('base64'),
            mimeType: 'image/png',
        }));
}