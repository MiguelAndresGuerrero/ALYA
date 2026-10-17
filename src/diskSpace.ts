import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveFolderPath } from './fileTools';
import { isSensitivePath } from './secrets';

// Revisa qué ocupa espacio. Solo mide: no borra ni mueve nada.

const FOLDER_BUDGET_MS = 25000;
const OVERVIEW_BUDGET_MS = 20000;
const STAT_BATCH = 64;
const TOP_CHILDREN = 12;
const TOP_FILES = 8;

export interface SizedItem {
    nombre: string;
    ruta: string;
    tipo: 'carpeta' | 'archivo';
    bytes: number;
    tamano: string;
}

interface Scan {
    deadline: number;
    incomplete: boolean;
    denied: number;
    topFiles: SizedItem[];
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return '0 KB';
}

function newScan(budgetMs: number): Scan {
    return { deadline: Date.now() + budgetMs, incomplete: false, denied: 0, topFiles: [] };
}

function rememberFile(scan: Scan, filePath: string, bytes: number): void {
    // Los archivos con credenciales cuentan en el total, pero su nombre no sale.
    if (bytes === 0 || isSensitivePath(filePath)) return;
    const smallest = scan.topFiles[scan.topFiles.length - 1];
    if (scan.topFiles.length >= TOP_FILES && smallest && bytes <= smallest.bytes) return;
    scan.topFiles.push({ nombre: path.basename(filePath), ruta: filePath, tipo: 'archivo', bytes, tamano: formatBytes(bytes) });
    scan.topFiles.sort((a, b) => b.bytes - a.bytes);
    scan.topFiles.length = Math.min(scan.topFiles.length, TOP_FILES);
}

async function fileBytes(filePath: string, scan: Scan): Promise<number> {
    try {
        const stats = await fs.promises.stat(filePath);
        rememberFile(scan, filePath, stats.size);
        return stats.size;
    } catch {
        return 0;
    }
}

/** Suma todo lo que hay dentro de una carpeta. Los accesos directos de carpeta (junctions) no se siguen. */
async function folderBytes(dir: string, scan: Scan): Promise<number> {
    if (Date.now() > scan.deadline) {
        scan.incomplete = true;
        return 0;
    }

    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        scan.denied++;
        return 0;
    }

    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) folders.push(full);
        else if (entry.isFile()) files.push(full);
    }

    let total = 0;
    for (let i = 0; i < files.length; i += STAT_BATCH) {
        const sizes = await Promise.all(files.slice(i, i + STAT_BATCH).map((file) => fileBytes(file, scan)));
        total += sizes.reduce((sum, size) => sum + size, 0);
    }
    for (const folder of folders) total += await folderBytes(folder, scan);
    return total;
}

function scanNotes(scan: Scan): string[] {
    const notes: string[] = [];
    if (scan.incomplete) notes.push('La revisión llegó a su límite de tiempo: los tamaños son mínimos, puede haber más.');
    if (scan.denied > 0) notes.push(`${scan.denied} carpetas no se pudieron abrir (permisos de Windows) y no están sumadas.`);
    return notes;
}

/** Mide cada subcarpeta y archivo de una carpeta, de mayor a menor, y busca los archivos más pesados. */
export async function analyzeFolder(input: string) {
    const root = resolveFolderPath(input);
    let stats: fs.Stats;
    try {
        stats = fs.statSync(root);
    } catch {
        throw new Error(`No encontré la carpeta: ${root}`);
    }
    if (!stats.isDirectory()) throw new Error(`Eso no es una carpeta: ${root}`);
    if (isSensitivePath(root)) throw new Error('Esa carpeta guarda credenciales o datos de cuentas; ALYA no la revisa.');

    const scan = newScan(FOLDER_BUDGET_MS);
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const items: SizedItem[] = [];
    let hiddenBytes = 0;

    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(root, entry.name);
        let bytes = 0;
        if (entry.isDirectory()) bytes = await folderBytes(full, scan);
        else if (entry.isFile()) bytes = await fileBytes(full, scan);
        else continue;

        if (isSensitivePath(full)) {
            hiddenBytes += bytes;
            continue;
        }
        items.push({
            nombre: entry.name,
            ruta: full,
            tipo: entry.isDirectory() ? 'carpeta' : 'archivo',
            bytes,
            tamano: formatBytes(bytes),
        });
    }

    items.sort((a, b) => b.bytes - a.bytes);
    const total = items.reduce((sum, item) => sum + item.bytes, 0) + hiddenBytes;
    const rest = items.slice(TOP_CHILDREN).reduce((sum, item) => sum + item.bytes, 0) + hiddenBytes;

    return {
        carpeta: root,
        total: formatBytes(total),
        total_bytes: total,
        contenido: items.slice(0, TOP_CHILDREN),
        resto: rest > 0 ? formatBytes(rest) : null,
        archivos_mas_grandes: scan.topFiles,
        notas: scanNotes(scan),
    };
}

export interface DriveInfo {
    disco: string;
    total: string;
    libre: string;
    usado_porcentaje: number;
}

/** Discos conectados con su espacio total y libre. */
export function listDrives(): DriveInfo[] {
    const drives: DriveInfo[] = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`;
        try {
            const info = fs.statfsSync(root);
            const total = info.blocks * info.bsize;
            const free = info.bavail * info.bsize;
            if (total <= 0) continue;
            drives.push({
                disco: `${letter}:`,
                total: formatBytes(total),
                libre: formatBytes(free),
                usado_porcentaje: Math.round(((total - free) / total) * 100),
            });
        } catch {
            continue;
        }
    }
    return drives;
}

interface CleanupSpot {
    nombre: string;
    ruta: string;
    consejo: string;
}

function cleanupSpots(): CleanupSpot[] {
    const home = os.homedir();
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const windows = process.env.SystemRoot || 'C:\\Windows';
    const systemDrive = (process.env.SystemDrive || 'C:') + '\\';

    return [
        { nombre: 'Temporales de tu usuario', ruta: os.tmpdir(), consejo: 'Se pueden borrar. Lo que esté en uso, Windows no deja borrarlo.' },
        { nombre: 'Temporales de Windows', ruta: path.join(windows, 'Temp'), consejo: 'Se pueden borrar desde Configuración > Sistema > Almacenamiento > Archivos temporales.' },
        { nombre: 'Descargas', ruta: path.join(home, 'Downloads'), consejo: 'Suele tener instaladores y archivos viejos. Revisa antes de borrar.' },
        { nombre: 'Papelera de reciclaje', ruta: path.join(systemDrive, '$Recycle.Bin'), consejo: 'Vaciarla libera este espacio de inmediato.' },
        { nombre: 'Actualizaciones de Windows descargadas', ruta: path.join(windows, 'SoftwareDistribution', 'Download'), consejo: 'Se limpian con Archivos temporales > Limpieza de Windows Update.' },
        { nombre: 'Windows anterior (Windows.old)', ruta: path.join(systemDrive, 'Windows.old'), consejo: 'Se quita con Archivos temporales > Instalaciones anteriores de Windows. Después ya no se puede volver a la versión vieja.' },
        { nombre: 'Caché de sombreadores de NVIDIA', ruta: path.join(local, 'NVIDIA', 'DXCache'), consejo: 'Se puede borrar; los juegos la vuelven a crear y la primera partida puede ir un poco más lenta.' },
        { nombre: 'Caché de sombreadores de DirectX', ruta: path.join(local, 'D3DSCache'), consejo: 'Se puede borrar; se vuelve a crear sola.' },
        { nombre: 'Caché de npm', ruta: path.join(local, 'npm-cache'), consejo: 'Se limpia con "npm cache clean --force".' },
        { nombre: 'Caché de pip', ruta: path.join(local, 'pip', 'Cache'), consejo: 'Se limpia con "pip cache purge".' },
        { nombre: 'Informes de errores', ruta: path.join(local, 'CrashDumps'), consejo: 'Se pueden borrar.' },
    ];
}

/** Resumen general: discos y lugares que normalmente se pueden limpiar. */
export async function spaceOverview() {
    const scan = newScan(OVERVIEW_BUDGET_MS);
    const lugares: Array<SizedItem & { consejo: string }> = [];

    for (const spot of cleanupSpots()) {
        if (!fs.existsSync(spot.ruta)) continue;
        const bytes = await folderBytes(spot.ruta, scan);
        if (bytes < 1024 ** 2) continue;
        lugares.push({ nombre: spot.nombre, ruta: spot.ruta, tipo: 'carpeta', bytes, tamano: formatBytes(bytes), consejo: spot.consejo });
    }
    lugares.sort((a, b) => b.bytes - a.bytes);

    return {
        discos: listDrives(),
        lugares_que_se_pueden_limpiar: lugares,
        notas: scanNotes(scan),
    };
}