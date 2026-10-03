import { spawn } from 'child_process';
import * as os from 'os';

/**
 * Corre un script de PowerShell y devuelve lo que imprimió. NUNCA rechaza:
 * si falla, tarda de más, o no estamos en Windows, devuelve null y quien
 * llama sigue sin ese dato.
 *
 * El script va con -EncodedCommand (en base64 UTF-16), que evita cualquier
 * problema de comillas al pasarle un script de varias líneas.
 */
export function runPowerShell(script: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
        if (os.platform() !== 'win32') return resolve(null);

        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);

        let stdout = '';
        let settled = false;
        const finish = (value: string | null): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(value);
        };

        const timeout = setTimeout(() => {
            ps.kill();
            finish(null);
        }, timeoutMs);

        ps.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        ps.stderr.on('data', () => { }); // se descarta, pero hay que leerlo para que no se trabe
        ps.on('error', () => finish(null));
        ps.on('close', (code) => finish(code === 0 ? stdout : null));
    });
}