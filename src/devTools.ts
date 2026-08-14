import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function resolvePath(input: string): string {
    return path.isAbsolute(input) ? input : path.join(os.homedir(), input);
}

const MAX_READ_CHARS = 30000; // no volcar archivos gigantes completos al chat

export function readFile(input: string): string {
    const filePath = resolvePath(input);

    if (!fs.existsSync(filePath)) {
        throw new Error(`No encontré el archivo: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error(`Eso es una carpeta, no un archivo: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    if (content.length > MAX_READ_CHARS) {
        return (
            content.slice(0, MAX_READ_CHARS) +
            `\n\n[... archivo cortado, tiene ${content.length} caracteres en total ...]`
        );
    }
    return content;
}

export function writeFile(input: string, content: string): string {
    const filePath = resolvePath(input);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
}

/**
 * Edición quirúrgica: busca un texto EXACTO dentro de un archivo y lo
 * reemplaza, sin tocar el resto — igual que cuando yo mismo (Claude) edito
 * archivos en esta conversación. Mucho más seguro y barato que reescribir
 * el archivo completo para un cambio chico.
 *
 * Exige que el texto a buscar aparezca EXACTAMENTE una vez — si no
 * aparece, o aparece varias veces (ambiguo, no sabríamos cuál cambiar),
 * rechaza en vez de arriesgarse a editar el lugar equivocado.
 */
export function editFile(input: string, oldStr: string, newStr: string): string {
    const filePath = resolvePath(input);

    if (!fs.existsSync(filePath)) {
        throw new Error(`No encontré el archivo: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const occurrences = content.split(oldStr).length - 1;

    if (occurrences === 0) {
        throw new Error(
            'No encontré ese texto exacto en el archivo — puede que el archivo haya cambiado ' +
            'desde la última vez que lo leíste. Vuelve a leerlo primero con leer_archivo.'
        );
    }

    if (occurrences > 1) {
        throw new Error(
            `Ese texto aparece ${occurrences} veces en el archivo — no sé cuál de todas cambiar. ` +
            'Dame un fragmento más largo/específico que aparezca una sola vez.'
        );
    }

    const newContent = content.replace(oldStr, newStr);
    fs.writeFileSync(filePath, newContent, 'utf8');
    return filePath;
}

const DELETE_TIMEOUT_MS = 15000;

/**
 * "Borra" un archivo mandándolo a la Papelera de reciclaje de Windows —
 * NO es un borrado permanente. Si algún día se confirma por error, el
 * archivo se puede recuperar desde ahí, igual que si lo borraras a mano
 * en el explorador de archivos.
 */
export function deleteFile(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const filePath = resolvePath(input);

        if (!fs.existsSync(filePath)) {
            return reject(new Error(`No encontré el archivo: ${filePath}`));
        }

        const script = [
            'Add-Type -AssemblyName Microsoft.VisualBasic',
            `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${filePath.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
        ].join('; ');

        const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

        const timeout = setTimeout(() => {
            ps.kill();
            reject(new Error('Se agotó el tiempo de espera al borrar el archivo (15s).'));
        }, DELETE_TIMEOUT_MS);

        let stderr = '';
        ps.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        ps.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        ps.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(`No se pudo borrar el archivo: ${stderr.trim() || `código ${code}`}`));
            }
            resolve(`${filePath} enviado a la Papelera de reciclaje.`);
        });
    });
}

export interface DirEntry {
    name: string;
    type: 'archivo' | 'carpeta';
    sizeKB?: string;
}

export function listDirectory(input: string): DirEntry[] {
    const dirPath = resolvePath(input);

    if (!fs.existsSync(dirPath)) {
        throw new Error(`No encontré la carpeta: ${dirPath}`);
    }

    return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
        if (entry.isDirectory()) {
            return { name: entry.name, type: 'carpeta' as const };
        }
        const stat = fs.statSync(path.join(dirPath, entry.name));
        return { name: entry.name, type: 'archivo' as const, sizeKB: (stat.size / 1024).toFixed(1) };
    });
}

const COMMAND_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 8000;

export function runCommand(command: string, cwdInput?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const cwd = cwdInput ? resolvePath(cwdInput) : os.homedir();

        exec(
            command,
            { cwd, timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
            (error, stdout, stderr) => {
                const output = (stdout + stderr).trim();
                const truncated =
                    output.length > MAX_OUTPUT_CHARS
                        ? output.slice(0, MAX_OUTPUT_CHARS) + '\n\n[... salida cortada ...]'
                        : output;

                if (error) {
                    // Igual devolvemos la salida (a veces el error trae info útil,
                    // ej. un error de compilación), no solo el mensaje de error crudo.
                    return reject(
                        new Error(`El comando terminó con error: ${error.message}\n\nSalida:\n${truncated}`)
                    );
                }

                resolve(truncated || '(el comando no produjo salida)');
            }
        );
    });
}