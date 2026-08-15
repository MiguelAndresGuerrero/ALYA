import { exec } from 'child_process';

export interface InstalledProgram {
    name: string;
    appId: string; // ruta de acceso directo, o AppID de una app de la Store
    isStoreApp: boolean;
}

/**
 * Busca un programa/juego/app instalado por nombre (coincidencia
 * parcial), usando Get-StartApps de PowerShell — lista TODO lo que
 * aparece en tu Menú Inicio en un solo lugar: apps normales, juegos
 * (la mayoría de los de Steam/Epic que crean acceso directo), Y apps
 * de la Microsoft Store (que NO usan accesos directos normales, así
 * que un escaneo de archivos por su cuenta nunca las encontraría).
 */
export function findInstalledProgram(query: string): Promise<InstalledProgram[]> {
    return new Promise((resolve, reject) => {
        const script = 'Get-StartApps | ConvertTo-Json -Compress';

        exec(`powershell -NoProfile -Command "${script}"`, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                return reject(new Error(`No pude consultar el Menú Inicio: ${error.message}`));
            }

            let apps: Array<{ Name: string; AppID: string }>;
            try {
                const parsed = JSON.parse(stdout);
                apps = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                return reject(new Error('No pude leer la lista de apps instaladas.'));
            }

            const queryLower = query.toLowerCase();
            const matches = apps
                .filter((a) => a.Name?.toLowerCase().includes(queryLower))
                .slice(0, 10)
                .map((a) => ({
                    name: a.Name,
                    appId: a.AppID,
                    // Las apps de la Store tienen un AppID con "!" (PackageFamilyName!AppId).
                    // Las normales tienen la ruta completa a su acceso directo (.lnk).
                    isStoreApp: a.AppID.includes('!'),
                }));

            resolve(matches);
        });
    });
}

/**
 * Abre un programa/app encontrado con findInstalledProgram. Las apps de
 * la Store se abren distinto (shell:appsFolder) que los accesos directos
 * normales.
 */
export function launchProgram(program: InstalledProgram): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = program.isStoreApp
            ? `explorer.exe shell:appsFolder\\${program.appId}`
            : `start "" "${program.appId}"`;

        exec(command, (error) => {
            if (error) return reject(new Error(`No pude abrir "${program.name}": ${error.message}`));
            resolve();
        });
    });
}