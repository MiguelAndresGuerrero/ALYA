import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Genera una imagen con Pollinations.ai (gratis, sin cuenta ni API key).
 * Devuelve la URL pública de la imagen Y una copia local descargada
 * (por si quieres usarla offline más adelante, ej. como fondo o ícono).
 */
export interface GeneratedImage {
    url: string;
    localPath: string;
}

// Dominio nuevo de Pollinations (agosto 2026). El viejo (image.pollinations.ai)
// quedó degradado a un solo modelo básico ("sana") — este nuevo sí deja usar
// Flux (mucha mejor calidad) de forma anónima y gratis, según su propia FAQ:
// "Unlimited flux images — completely free, always!"
const POLLINATIONS_BASE = 'https://gen.pollinations.ai/image/';
const POLLINATIONS_FALLBACK_BASE = 'https://image.pollinations.ai/prompt/';

export async function generateImage(prompt: string): Promise<GeneratedImage> {
    const seed = Math.floor(Math.random() * 1_000_000);
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `${POLLINATIONS_BASE}${encodedPrompt}?model=flux&width=1024&height=1024&seed=${seed}&nologo=true`;
    const localPath = path.join(os.tmpdir(), `alya_image_${Date.now()}.jpg`);

    console.log(`[ALYA] Generando imagen con prompt: "${prompt}"`);

    try {
        await downloadFile(url, localPath);
        return { url, localPath };
    } catch (err) {
        // Respaldo: si el dominio nuevo falla por lo que sea, probamos el viejo
        // (peor calidad, pero mejor que no generar nada).
        console.warn('Pollinations (nuevo) falló, probando respaldo:', (err as Error).message);
        const fallbackUrl = `${POLLINATIONS_FALLBACK_BASE}${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;
        await downloadFile(fallbackUrl, localPath);
        return { url: fallbackUrl, localPath };
    }
}

function downloadFile(url: string, destPath: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            // Seguir redirecciones (Pollinations a veces reenvía a su CDN de medios)
            if (
                response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                response.resume(); // descarta el cuerpo de esta respuesta
                if (redirectsLeft <= 0) {
                    return reject(new Error('Demasiadas redirecciones al descargar la imagen.'));
                }
                return downloadFile(response.headers.location, destPath, redirectsLeft - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`Pollinations respondió con código ${response.statusCode}`));
            }

            const file = fs.createWriteStream(destPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
            file.on('error', (err) => {
                file.close();
                fs.unlink(destPath, () => { });
                reject(err);
            });
        });

        request.on('error', reject);

        // No dejar la app esperando para siempre si el servicio no responde.
        request.setTimeout(30000, () => {
            request.destroy(new Error('Se agotó el tiempo de espera generando la imagen (30s).'));
        });
    });
}