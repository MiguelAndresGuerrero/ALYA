import { exec, spawn } from 'child_process';
import * as os from 'os';

export interface DefenderStatus {
    realTimeProtectionEnabled: boolean | null;
    antivirusEnabled: boolean | null;
    lastQuickScanDaysAgo: number | null;
    signatureAgeDays: number | null;
}

/**
 * Consulta el estado real de Windows Defender vía PowerShell. Puede
 * fallar si ALYA no corre con permisos de administrador — en ese caso
 * devolvemos un error claro en vez de datos inventados.
 */
export function getDefenderStatus(): Promise<DefenderStatus> {
    return new Promise((resolve, reject) => {
        if (os.platform() !== 'win32') {
            return resolve({
                realTimeProtectionEnabled: null,
                antivirusEnabled: null,
                lastQuickScanDaysAgo: null,
                signatureAgeDays: null,
            });
        }

        const script =
            'Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled, ' +
            'QuickScanAge, AntivirusSignatureAge | ConvertTo-Json';

        exec(`powershell -NoProfile -Command "${script}"`, { timeout: 15000 }, (error, stdout) => {
            if (error) {
                return reject(
                    new Error(
                        `No pude consultar Windows Defender: ${error.message}. ` +
                        `(Puede que ALYA necesite correr como administrador para esto.)`
                    )
                );
            }

            try {
                const data = JSON.parse(stdout);
                resolve({
                    realTimeProtectionEnabled: data.RealTimeProtectionEnabled ?? null,
                    antivirusEnabled: data.AntivirusEnabled ?? null,
                    lastQuickScanDaysAgo: data.QuickScanAge ?? null,
                    signatureAgeDays: data.AntivirusSignatureAge ?? null,
                });
            } catch {
                reject(new Error('No pude leer la respuesta de Windows Defender.'));
            }
        });
    });
}

/**
 * Dispara un escaneo rápido de Windows Defender EN SEGUNDO PLANO — no
 * esperamos a que termine (puede tardar varios minutos), solo
 * confirmamos que arrancó. El usuario puede revisar el resultado más
 * tarde con getDefenderStatus() o abriendo Seguridad de Windows.
 */
export function startQuickScan(): void {
    if (os.platform() !== 'win32') return;

    const ps = spawn('powershell', ['-NoProfile', '-Command', 'Start-MpScan -ScanType QuickScan'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
    });

    ps.unref(); // que corra independiente, sin que ALYA tenga que esperarlo
}