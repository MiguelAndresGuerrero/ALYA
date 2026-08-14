import { exec } from 'child_process';
import * as os from 'os';

// Mapa de apps conocidas -> comando para abrirlas en Windows.
// Añade aquí las tuyas (Minecraft launcher, etc).
export const KNOWN_APPS: Record<string, string> = {
  discord: '"%LOCALAPPDATA%\\Discord\\Update.exe" --processStart Discord.exe',
  spotify: '"%LOCALAPPDATA%\\Spotify\\Spotify.exe"',
  steam: 'steam://open/main',
  chrome: 'chrome',
  vscode: 'code',
  explorer: 'explorer',
};

export function openApp(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const key = name.toLowerCase().trim();
    const command = KNOWN_APPS[key] || key;

    if (os.platform() !== 'win32') {
      return reject(new Error('openApp por ahora solo soporta Windows.'));
    }

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
