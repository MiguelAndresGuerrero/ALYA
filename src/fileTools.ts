import { spawn, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Atajos comunes -> carpeta real del usuario. Así ALYA entiende
// "abre mis descargas" sin que tengas que darle la ruta completa.
const FOLDER_SHORTCUTS: Record<string, string> = {
    escritorio: 'Desktop',
    desktop: 'Desktop',
    documentos: 'Documents',
    documents: 'Documents',
    descargas: 'Downloads',
    downloads: 'Downloads',
    imagenes: 'Pictures',
    imágenes: 'Pictures',
    pictures: 'Pictures',
    musica: 'Music',
    música: 'Music',
    music: 'Music',
    videos: 'Videos',
    vídeos: 'Videos',
};

function resolveFolderPath(input: string): string {
    const normalized = input.toLowerCase().trim();
    const shortcut = FOLDER_SHORTCUTS[normalized];
    if (shortcut) {
        return path.join(os.homedir(), shortcut);
    }
    // Si no es un atajo conocido, se asume que ya es una ruta (absoluta o
    // relativa a la carpeta del usuario).
    return path.isAbsolute(input) ? input : path.join(os.homedir(), input);
}

/**
 * Abre una carpeta en el Explorador de Windows. Acepta atajos comunes
 * ("descargas", "escritorio") o una ruta completa.
 */
export function openFolder(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const folderPath = resolveFolderPath(input);

        if (!fs.existsSync(folderPath)) {
            return reject(new Error(`No encontré la carpeta: ${folderPath}`));
        }

        exec(`start "" "${folderPath}"`, (error) => {
            if (error) {
                return reject(new Error(`No pude abrir la carpeta: ${error.message}`));
            }
            resolve(`Abriendo ${folderPath}`);
        });
    });
}

export interface FoundFile {
    name: string;
    path: string;
}

const SEARCH_MAX_RESULTS = 20;
const SEARCH_MAX_DEPTH = 5;
const SEARCH_TIMEOUT_MS = 8000;

// Carpetas donde buscar por defecto si no se especifica una (evita
// escanear el disco C: entero, que sería lentísimo y muy invasivo).
const DEFAULT_SEARCH_FOLDERS = ['Desktop', 'Documents', 'Downloads'].map((f) =>
    path.join(os.homedir(), f)
);

// Carpetas que NUNCA hay que bajar a explorar (node_modules, .git, etc.
// son inmensas y nadie busca archivos ahí).
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'out', 'dist', '$RECYCLE.BIN']);

/**
 * Busca archivos por nombre (coincidencia parcial, sin distinguir
 * mayúsculas) dentro de las carpetas comunes del usuario, o dentro de
 * una carpeta específica si se indica.
 *
 * Tiene límites de tiempo, profundidad y cantidad de resultados a
 * propósito — es una búsqueda rápida y "suficientemente buena", no un
 * indexador completo del disco.
 */
export async function searchFiles(query: string, folderInput?: string): Promise<FoundFile[]> {
    const startTime = Date.now();
    const results: FoundFile[] = [];
    const queryLower = query.toLowerCase();

    const foldersToSearch = folderInput
        ? [resolveFolderPath(folderInput)]
        : DEFAULT_SEARCH_FOLDERS;

    function walk(dir: string, depth: number): void {
        if (results.length >= SEARCH_MAX_RESULTS) return;
        if (depth > SEARCH_MAX_DEPTH) return;
        if (Date.now() - startTime > SEARCH_TIMEOUT_MS) return;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // carpeta sin permiso de lectura u otro problema, la saltamos
        }

        for (const entry of entries) {
            if (results.length >= SEARCH_MAX_RESULTS) return;
            if (Date.now() - startTime > SEARCH_TIMEOUT_MS) return;

            if (entry.isDirectory()) {
                if (IGNORED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
                walk(path.join(dir, entry.name), depth + 1);
            } else if (entry.name.toLowerCase().includes(queryLower)) {
                results.push({ name: entry.name, path: path.join(dir, entry.name) });
            }
        }
    }

    for (const folder of foldersToSearch) {
        if (fs.existsSync(folder)) {
            walk(folder, 0);
        }
    }

    return results;
}