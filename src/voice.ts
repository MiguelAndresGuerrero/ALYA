import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadSettings } from './settingsStore';
import { getResourcePath } from './resourcePaths';

// --- Configuración de Piper (voz neuronal local) ---
const PIPER_DIR = getResourcePath('piper');
const PIPER_EXE = path.join(PIPER_DIR, 'piper.exe');
const VOICE_MODEL = path.join(PIPER_DIR, 'voices', 'es_ES-sharvard-medium.onnx');
const TEMP_WAV = path.join(os.tmpdir(), 'alya_speech.wav');

// sharvard-medium trae 2 hablantes. Confirmado por el config.json:
// "speaker_id_map": { "M": 0, "F": 1 } -> 1 = femenino. Fijo, sin
// selector — ALYA siempre habla como mujer.
const SPEAKER_ID = '1';

// El ritmo/tono ya NO son constantes fijas — se leen del panel de
// configuración cada vez que habla, así los cambios aplican al instante.

function piperIsAvailable(): boolean {
  const modelExists = fs.existsSync(PIPER_EXE);
  const voiceExists = fs.existsSync(VOICE_MODEL);

  if (!modelExists || !voiceExists) {
    console.warn('--- Diagnóstico de voz ---');
    console.warn(`piper.exe (${modelExists ? 'SÍ' : 'NO'} encontrado): ${PIPER_EXE}`);
    console.warn(`Modelo de voz (${voiceExists ? 'SÍ' : 'NO'} encontrado): ${VOICE_MODEL}`);
    console.warn('--------------------------');
  }

  return modelExists && voiceExists;
}

/**
 * Ajusta la ortografía SOLO para la síntesis de voz (lo que se ve en pantalla
 * sigue diciendo "ALYA" normal). "Alya" no está en el diccionario del
 * sintetizador y lo pronuncia mal; "Alia" suena igual en español y sí lo
 * reconoce bien.
 */
function toSpeechText(text: string): string {
  return text.replace(/alya/gi, (match) => {
    return match === match.toUpperCase() ? 'ALIA' : 'Alia';
  });
}

function speakWithPiper(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const settings = loadSettings();

    const piper = spawn(PIPER_EXE, [
      '--model', VOICE_MODEL,
      '--speaker', SPEAKER_ID,
      '--length_scale', String(settings.lengthScale),
      '--noise_scale', String(settings.noiseScale),
      '--noise_w', String(settings.noiseW),
      '--output_file', TEMP_WAV,
    ]);

    let stderr = '';
    piper.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    piper.on('error', reject);
    piper.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Piper terminó con error: ${stderr.trim() || `código ${code}`}`));
      }
      playWav(TEMP_WAV).then(resolve).catch(reject);
    });

    piper.stdin.write(text, 'utf8');
    piper.stdin.end();
  });
}

function playWav(wavPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `(New-Object Media.SoundPlayer '${wavPath}').PlaySync()`;
    const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

    // Salvaguarda contra un proceso REALMENTE colgado (no contra una
    // respuesta larga que tarda en reproducirse — con la cola de voz ya
    // no debería haber competencia por el dispositivo de audio, así que
    // este límite puede ser generoso sin riesgo).
    const timeout = setTimeout(() => {
      ps.kill();
      reject(new Error('Se mató un proceso de audio colgado (timeout de 60s).'));
    }, 60000);

    ps.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ps.on('close', (code) => {
      clearTimeout(timeout);
      code === 0 ? resolve() : reject(new Error('No se pudo reproducir el audio.'));
    });
  });
}

function speakFallback(text: string): Promise<void> {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
      '$text = [Console]::In.ReadToEnd()',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$s.Rate = 0',
      '$s.Speak($text)',
    ].join('; ');

    const ps = spawn('powershell', ['-NoProfile', '-Command', script], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    // Ídem: 60s en vez de 10s, ya no hace falta ser tan agresivo con la
    // cola de voz previniendo solapamientos.
    const timeout = setTimeout(() => {
      ps.kill();
      resolve();
    }, 60000);

    ps.on('error', (err) => {
      clearTimeout(timeout);
      console.error('Error al hablar (fallback):', err.message);
      resolve();
    });
    ps.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    ps.stdin.write(text, 'utf8');
    ps.stdin.end();
  });
}

/**
 * Habla un texto de verdad (Piper, con SAPI como respaldo si falla).
 * Esta función SIEMPRE resuelve, nunca rechaza — cualquier error queda
 * registrado en consola, pero nunca debe trabar la fila de voz.
 */
async function speakNow(text: string): Promise<void> {
  if (os.platform() !== 'win32') {
    console.log(`[ALYA diría]: ${text}`);
    return;
  }

  const speechText = toSpeechText(text);

  if (!piperIsAvailable()) {
    console.warn('Piper no está listo todavía (ver README) — usando voz de respaldo.');
    await speakFallback(speechText);
    return;
  }

  try {
    await speakWithPiper(speechText);
  } catch (err) {
    console.error('Piper falló, usando voz de respaldo:', (err as Error).message);
    await speakFallback(speechText);
  }
}

// --- Fila de voz ---
// Si se llama a speak() varias veces seguidas (ej. mandas varios mensajes
// rápido en el chat), NUNCA deben sonar/competir por el audio al mismo
// tiempo — cada una espera a que la anterior termine. Esto es lo que
// evitaba el bug de procesos de audio colgándose entre sí.
let voiceQueue: Promise<void> = Promise.resolve();

export function speak(text: string): void {
  voiceQueue = voiceQueue.then(() => speakNow(text));
}

// Se dejan exportadas por compatibilidad con main.ts, aunque este modo
// no usa un servidor persistente (ver historial: el binario de Piper que
// tenemos no soporta quedarse vivo recibiendo frases sueltas).
export function startVoiceServer(): void { }
export function stopVoiceServer(): void { }