import { app } from 'electron';
import * as path from 'path';

/**
 * Resuelve una ruta a un recurso (piper/, build/) que funciona tanto en
 * desarrollo (npm start) como ya empaquetada en el .exe instalado —
 * Electron mueve estos archivos a lugares distintos en cada caso, así
 * que no se puede usar una ruta relativa fija en todos lados.
 *
 * Dev: <raíz del proyecto>/<segmentos>
 * Empaquetada: <carpeta resources del instalador>/<segmentos>
 *   (ver "extraResources" en package.json, que copia piper/ y build/ ahí)
 */
export function getResourcePath(...segments: string[]): string {
    const base = app.isPackaged
        ? process.resourcesPath
        : path.join(__dirname, '..');
    return path.join(base, ...segments);
}