import { exec } from 'child_process';
import * as os from 'os';
import { findInstalledProgram, launchProgram } from './programSearch';

// Mapa de apps conocidas -> comando para abrirlas en Windows.
// Añade aquí las tuyas (Minecraft launcher, etc).
export const KNOWN_APPS: Record<string, string> = {
  discord: '"%LOCALAPPDATA%\\Discord\\Update.exe" --processStart Discord.exe',
  steam: 'steam://open/main',
  chrome: 'chrome',
  vscode: 'code',
  explorer: 'explorer',
};

// Apps que resultaron tener rutas de instalación poco confiables entre
// distintas PCs (varían según versión, si es de la Store, etc.) — para
// estas, en vez de adivinar una ruta fija, buscamos de verdad en el
// Menú Inicio cada vez (más lento, pero no falla por una ruta vieja).
const DYNAMIC_LOOKUP_APPS = new Set(['spotify']);

export async function openApp(name: string): Promise<string> {
  const key = name.toLowerCase().trim();

  if (os.platform() !== 'win32') {
    throw new Error('openApp por ahora solo soporta Windows.');
  }

  if (DYNAMIC_LOOKUP_APPS.has(key)) {
    const found = await findInstalledProgram(key);
    if (found.length === 0) {
      throw new Error(`No encontré "${name}" instalado en el Menú Inicio.`);
    }
    await launchProgram(found[0]);
    return `Abriendo ${name}...`;
  }

  return new Promise((resolve, reject) => {
    const command = KNOWN_APPS[key] || key;

    exec(`start "" ${command}`, (error) => {
      if (error) {
        const hint = KNOWN_APPS[key]
          ? ''
          : ` No está en el mapa KNOWN_APPS de appLauncher.ts — agrégala ahí con su ruta completa.`;
        return reject(new Error(`No pude abrir "${name}": ${error.message}.${hint}`));
      }
      resolve(`Abriendo ${name}...`);
    });
  });
}

export function closeApp(processName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (os.platform() !== 'win32') {
      return reject(new Error('closeApp por ahora solo soporta Windows.'));
    }
    exec(`taskkill /IM ${processName} /F`, (error) => {
      if (error) {
        return reject(new Error(`No pude cerrar "${processName}": ${error.message}`));
      }
      resolve(`Cerrado ${processName}.`);
    });
  });
}