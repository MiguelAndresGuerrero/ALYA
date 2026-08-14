import { spawn } from 'child_process';
import * as os from 'os';

// Códigos de "teclas de medios" virtuales de Windows — los mismos que
// manda un teclado físico al presionar play/pausa/siguiente/volumen.
// Funcionan sin importar qué programa esté reproduciendo (Spotify,
// YouTube en el navegador, VLC, lo que sea), porque Windows los enruta
// automáticamente a la app activa multimedia — igual que el hardware real.
const VK_MEDIA_NEXT_TRACK = 0xb0;
const VK_MEDIA_PREV_TRACK = 0xb1;
const VK_MEDIA_STOP = 0xb2;
const VK_MEDIA_PLAY_PAUSE = 0xb3;
const VK_VOLUME_MUTE = 0xad;
const VK_VOLUME_DOWN = 0xae;
const VK_VOLUME_UP = 0xaf;

export type MediaAction =
    | 'play_pause'
    | 'next'
    | 'previous'
    | 'stop'
    | 'volume_up'
    | 'volume_down'
    | 'mute';

const ACTION_TO_VK: Record<MediaAction, number> = {
    play_pause: VK_MEDIA_PLAY_PAUSE,
    next: VK_MEDIA_NEXT_TRACK,
    previous: VK_MEDIA_PREV_TRACK,
    stop: VK_MEDIA_STOP,
    volume_up: VK_VOLUME_UP,
    volume_down: VK_VOLUME_DOWN,
    mute: VK_VOLUME_MUTE,
};

/**
 * Manda una tecla de medios virtual (play/pausa, siguiente, volumen, etc).
 * Usa P/Invoke a user32.dll vía PowerShell — no requiere instalar nada,
 * viene con Windows.
 */
export function sendMediaKey(action: MediaAction): Promise<void> {
    return new Promise((resolve, reject) => {
        const vkCode = ACTION_TO_VK[action];
        if (vkCode === undefined) {
            return reject(new Error(`Acción de medios desconocida: ${action}`));
        }

        if (os.platform() !== 'win32') {
            console.log(`[ALYA simularía tecla de medios]: ${action}`);
            return resolve();
        }

        const script = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class AlyaMediaKeys {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'
[AlyaMediaKeys]::keybd_event(${vkCode}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[AlyaMediaKeys]::keybd_event(${vkCode}, 0, 2, [UIntPtr]::Zero)
`.trim();

        const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

        const timeout = setTimeout(() => {
            ps.kill();
            reject(new Error('Se mató un proceso de control multimedia colgado (timeout de 10s).'));
        }, 10000);

        let stderr = '';
        ps.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        ps.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        ps.on('close', (code) => {
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(`No se pudo enviar la tecla de medios: ${stderr.trim() || `código ${code}`}`));
            }
            resolve();
        });
    });
}