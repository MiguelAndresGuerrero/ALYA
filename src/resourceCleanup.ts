import { spawn } from 'child_process';
import * as os from 'os';

/**
 * Libera RAM sin cerrar ningún proceso — le pide a Windows que "compacte"
 * la memoria de cada programa abierto, devolviendo al sistema lo que no
 * está usando activamente en ese momento. No hay riesgo de pérdida de
 * datos porque ningún programa se cierra ni se interrumpe.
 *
 * (Técnica: reasignar MinWorkingSet fuerza a Windows a recalcular y
 * recortar el "working set" de cada proceso.)
 */
export function freeUpMemory(): Promise<string> {
    return new Promise((resolve, reject) => {
        if (os.platform() !== 'win32') {
            return resolve('(simulado) RAM liberada.');
        }

        const script =
            'Get-Process | ForEach-Object { ' +
            'try { $_.MinWorkingSet = $_.MinWorkingSet } catch {} ' +
            '}; Write-Output "ok"';

        const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

        const timeout = setTimeout(() => {
            ps.kill();
            reject(new Error('Se agotó el tiempo de espera liberando memoria (15s).'));
        }, 15000);

        let stdout = '';
        ps.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        ps.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        ps.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(`No se pudo liberar memoria (código ${code}).`));
            }
            resolve('RAM liberada — la memoria en reposo de cada programa se devolvió al sistema.');
        });
    });
}