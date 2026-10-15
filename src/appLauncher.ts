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
  notepad: 'notepad',
  calc: 'calc',
  mspaint: 'mspaint',
  taskmgr: 'taskmgr',
};

export async function openApp(name: string): Promise<string> {
  const key = name.toLowerCase().trim();

  if (os.platform() !== 'win32') {
    throw new Error('openApp por ahora solo soporta Windows.');
  }

  const known = KNOWN_APPS[key];
  if (known) {
    return new Promise((resolve, reject) => {
      exec(`start "" ${known}`, (error) => {
        if (error) return reject(new Error(`No pude abrir "${name}": ${error.message}.`));
        resolve(`Abriendo ${name}...`);
      });
    });
  }

  // Un nombre que no está en KNOWN_APPS nunca llega a la consola: se busca
  // en el Menú Inicio y se abre la app que Windows tiene registrada.
  const found = await findInstalledProgram(key);
  if (found.length === 0) {
    throw new Error(`No encontré "${name}" instalado en el Menú Inicio.`);
  }
  const program = found.find((app) => app.name.toLowerCase() === key) ?? found[0];
  await launchProgram(program);
  return `Abriendo ${name}...`;
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