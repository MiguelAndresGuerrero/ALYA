import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { loadSettings, saveSettings, type AlyaSettings } from './settingsStore';
import { getResourcePath } from './resourcePaths';
import { MOOD_SHAPES, guessMood, toneToShape, type Mood } from './expression';

// --- Configuración de Piper (voz neuronal local) ---
const PIPER_DIR = getResourcePath('piper');
const PIPER_EXE = path.join(PIPER_DIR, 'piper.exe');
const VOICE_MODEL = path.join(PIPER_DIR, 'voices', 'es_ES-sharvard-medium.onnx');
// Cada frase se genera en su propio archivo temporal: así se puede ir
// preparando el audio de la siguiente mientras todavía suena la anterior.
let wavCounter = 0;

function nextWavPath(): string {
  wavCounter = (wavCounter + 1) % 10000;
  return path.join(os.tmpdir(), `alya_speech_${process.pid}_${wavCounter}.wav`);
}

function removeWav(wavPath: string): void {
  try {
    fs.unlinkSync(wavPath);
  } catch {
    // ya no estaba (o nunca se llegó a crear)
  }
}

// sharvard-medium trae 2 hablantes. Confirmado por el config.json:
// "speaker_id_map": { "M": 0, "F": 1 } -> 1 = femenino. Fijo, sin
// selector — ALYA siempre habla como mujer.
const SPEAKER_ID = '1';

// Ritmo natural de las palabras. Ya NO se controla desde el panel: el
// control de "Tono de la voz" cambia qué tan grave/aguda y serena/animada
// suena, pero las palabras siempre duran lo mismo (un "hola" nunca se
// estira por bajar el control).
const BASE_LENGTH_SCALE = 1.15;

// Límites de seguridad para que ninguna combinación (control manual +
// ánimo automático) deje la voz irreconocible.
const MIN_SEMITONES = -5;
const MAX_SEMITONES = 4.5;
const MIN_NOISE_SCALE = 0.3;
const MAX_NOISE_SCALE = 1.05;

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
 * Ajusta el texto SOLO para la síntesis de voz (lo que se ve en pantalla
 * no cambia):
 * - "Alya" no está en el diccionario del sintetizador y lo pronuncia mal;
 *   "Alia" suena igual en español y sí lo reconoce bien.
 * - Quita símbolos de formato (asteriscos, backticks, guiones bajos,
 *   numerales de título) y emojis, que el sintetizador leería en voz alta o tropezaría
 *   con ellos.
 */
function toSpeechText(text: string): string {
  return text
    .replace(/alya/gi, (match) => (match === match.toUpperCase() ? 'ALIA' : 'Alia'))
    .replace(/[*`]+/g, '')
    .replace(/_+/g, ' ')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Lee cuánto dura de verdad un archivo .wav, leyendo su encabezado
 * (formato RIFF/WAVE estándar) — así el límite de tiempo de espera se
 * ajusta al audio real, en vez de un número fijo que corta textos largos
 * a la mitad.
 */
function getWavDurationSeconds(wavPath: string): number | null {
  try {
    const buffer = fs.readFileSync(wavPath);
    // Encabezado WAV estándar: byteRate en la posición 28 (4 bytes), tamaño
    // de los datos de audio en la posición 40 (4 bytes) — ver especificación RIFF/WAVE.
    const byteRate = buffer.readUInt32LE(28);
    const dataSize = buffer.readUInt32LE(40);
    if (byteRate === 0) return null;
    return dataSize / byteRate;
  } catch {
    return null; // si algo falla leyendo el encabezado, seguimos con el valor por defecto
  }
}

/** Los números finales con los que se sintetiza UNA frase. */
interface VoiceRender {
  pitchFactor: number; // 1 = tono original, <1 más grave, >1 más aguda
  lengthScale: number; // lo que se le pasa a Piper
  noiseScale: number;
  sentenceSilence: number;
}

/**
 * Combina el control manual ("Tono de la voz") con el ánimo de la frase
 * y devuelve los parámetros de síntesis.
 *
 * El truco para cambiar el tono SIN cambiar cuánto dura la frase: el
 * tono se cambia después, remuestreando el audio (applyPitchAndVolume),
 * y eso por sí solo alargaría o acortaría el audio en la misma
 * proporción. Para compensarlo, le pedimos a Piper que hable justo esa
 * proporción más rápido o más lento — las dos cosas se cancelan y la
 * duración final queda igual.
 */
function buildVoiceRender(settings: AlyaSettings, mood: Mood): VoiceRender {
  const tone = toneToShape(settings.tone);
  const moodShape = settings.autoExpression === false ? MOOD_SHAPES.neutral : MOOD_SHAPES[mood];

  const semitones = Math.max(MIN_SEMITONES, Math.min(MAX_SEMITONES, tone.semitones + moodShape.semitones));
  const pitchFactor = Math.pow(2, semitones / 12);

  const noiseScale = Math.max(
    MIN_NOISE_SCALE,
    Math.min(MAX_NOISE_SCALE, settings.noiseScale + tone.noiseDelta + moodShape.noiseDelta)
  );

  return {
    pitchFactor,
    lengthScale: BASE_LENGTH_SCALE * moodShape.rhythm * pitchFactor,
    noiseScale,
    // Los silencios también pasan por el remuestreo, así que se compensan igual.
    sentenceSilence: (moodShape.pauseSeconds + tone.pauseSeconds) * pitchFactor,
  };
}

/**
 * Ubica dónde empiezan las muestras de audio dentro del .wav. Casi
 * siempre es en el byte 44, pero se busca el bloque "data" de verdad por
 * si el encabezado trae bloques extra.
 */
function findWavData(buffer: Buffer): { start: number; size: number } | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const start = offset + 8;
      return { start, size: Math.min(size, buffer.length - start) };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Aplica el tono y el volumen directamente sobre las muestras PCM de 16
 * bits del .wav ya generado — así no depende de que el reproductor
 * (Media.SoundPlayer) tenga esos controles, porque no los tiene.
 *
 * - Tono: se remuestrea el audio (se "lee" más lento para que suene más
 *   grave, o más rápido para que suene más aguda), interpolando entre
 *   muestras para que no suene áspero.
 * - Volumen: se escala cada muestra.
 *
 * Si no hay nada que cambiar no se toca el archivo, para no perder
 * calidad de audio sin necesidad.
 */
function applyPitchAndVolume(wavPath: string, pitchFactor: number, volumePercent: number): void {
  const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
  const changesPitch = Math.abs(pitchFactor - 1) > 0.001;
  if (!changesPitch && volume >= 1) return;

  try {
    const buffer = fs.readFileSync(wavPath);
    const data = findWavData(buffer);
    if (!data) return;

    const channels = buffer.readUInt16LE(22);
    const bitsPerSample = buffer.readUInt16LE(34);
    if (bitsPerSample !== 16 || channels !== 1) return; // formato inesperado, mejor no tocar el audio

    const inputCount = Math.floor(data.size / 2);
    if (inputCount < 2) return;

    const input = new Int16Array(inputCount);
    for (let i = 0; i < inputCount; i++) input[i] = buffer.readInt16LE(data.start + i * 2);

    const outputCount = changesPitch ? Math.floor(inputCount / pitchFactor) : inputCount;
    const header = Buffer.from(buffer.subarray(0, data.start));
    const out = Buffer.alloc(header.length + outputCount * 2);
    header.copy(out, 0);

    const last = inputCount - 1;
    for (let i = 0; i < outputCount; i++) {
      let sample: number;

      if (changesPitch) {
        // Interpolación cúbica (Catmull-Rom) entre las 4 muestras vecinas.
        const pos = i * pitchFactor;
        const i1 = Math.min(last, Math.floor(pos));
        const t = pos - i1;
        const p0 = input[Math.max(0, i1 - 1)];
        const p1 = input[i1];
        const p2 = input[Math.min(last, i1 + 1)];
        const p3 = input[Math.min(last, i1 + 2)];
        sample =
          p1 +
          0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
      } else {
        sample = input[i];
      }

      const scaled = Math.round(sample * volume);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), header.length + i * 2);
    }

    // El archivo cambió de tamaño: actualizamos los dos campos del
    // encabezado que lo declaran (tamaño total RIFF y tamaño del bloque data).
    out.writeUInt32LE(out.length - 8, 4);
    out.writeUInt32LE(outputCount * 2, data.start - 4);

    fs.writeFileSync(wavPath, out);
  } catch (err) {
    console.error('No se pudo ajustar el tono/volumen del audio:', (err as Error).message);
    // seguimos igual con el audio original antes que no sonar nada
  }
}

/**
 * Genera el audio de un texto con Piper y devuelve la ruta del .wav ya
 * listo para sonar (con el tono y el volumen aplicados). Devuelve null si
 * la mandaron a callar mientras se generaba.
 */
function synthesizeWithPiper(text: string, mood: Mood): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const settings = loadSettings();
    const render = buildVoiceRender(settings, mood);
    const wavPath = nextWavPath();

    const generation = stopGeneration;
    const piper = track(spawn(PIPER_EXE, [
      '--model', VOICE_MODEL,
      '--speaker', SPEAKER_ID,
      '--length_scale', render.lengthScale.toFixed(3),
      '--noise_scale', render.noiseScale.toFixed(3),
      '--noise_w', String(settings.noiseW),
      '--sentence_silence', render.sentenceSilence.toFixed(3),
      '--output_file', wavPath,
    ]));

    let stderr = '';
    piper.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    piper.on('error', (err) => {
      removeWav(wavPath);
      reject(err);
    });
    piper.on('close', (code) => {
      // La silenciaron mientras se generaba el audio: no se reproduce nada.
      if (generation !== stopGeneration) {
        removeWav(wavPath);
        return resolve(null);
      }
      if (code !== 0) {
        removeWav(wavPath);
        return reject(new Error(`Piper terminó con error: ${stderr.trim() || `código ${code}`}`));
      }
      applyPitchAndVolume(wavPath, render.pitchFactor, settings.volume ?? 100);
      resolve(wavPath);
    });

    // Si el proceso se corta antes de leer el texto (ej. la callaron), que
    // el error de escritura no tumbe nada: el "close" ya se encarga.
    piper.stdin.on('error', () => { });
    piper.stdin.write(text, 'utf8');
    piper.stdin.end();
  });
}

function playWav(wavPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `(New-Object Media.SoundPlayer '${wavPath}').PlaySync()`;
    const generation = stopGeneration;
    const ps = track(spawn('powershell', ['-NoProfile', '-Command', script]));
    playbackListener?.();

    // El límite de esperas se ajusta a la duración REAL del audio (leída
    // del propio archivo .wav) más un margen generoso — así un texto
    // largo nunca se corta a la mitad. Si no se puede leer la duración
    // por algún motivo, usamos 60s como respaldo razonable.
    const duracionReal = getWavDurationSeconds(wavPath);
    const margenSegundos = 20;
    const timeoutMs = duracionReal
      ? Math.max(60000, (duracionReal + margenSegundos) * 1000)
      : 60000;

    const timeout = setTimeout(() => {
      ps.kill();
      reject(new Error(`Se mató un proceso de audio colgado (timeout de ${Math.round(timeoutMs / 1000)}s).`));
    }, timeoutMs);

    ps.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ps.on('close', (code) => {
      clearTimeout(timeout);
      // Si la cortaron a propósito (silencio), no es un error de reproducción.
      if (generation !== stopGeneration) return resolve();
      code === 0 ? resolve() : reject(new Error('No se pudo reproducir el audio.'));
    });
  });
}

function speakFallback(text: string): Promise<void> {
  return new Promise((resolve) => {
    const settings = loadSettings();
    const volume = Math.max(0, Math.min(100, Math.round(settings.volume ?? 100)));

    const script = [
      'Add-Type -AssemblyName System.Speech',
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
      '$text = [Console]::In.ReadToEnd()',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$s.Rate = 0',
      `$s.Volume = ${volume}`,
      '$s.Speak($text)',
    ].join('; ');

    const ps = track(
      spawn('powershell', ['-NoProfile', '-Command', script], {
        stdio: ['pipe', 'ignore', 'pipe'],
      })
    );
    playbackListener?.();

    // Acá no hay un archivo de audio que medir de antemano (SAPI genera
    // sobre la marcha) — estimamos el tiempo según la longitud del texto
    // (~12 caracteres por segundo a ritmo normal de habla), con margen.
    const segundosEstimados = text.length / 12;
    const margenSegundos = 20;
    const timeoutMs = Math.max(60000, (segundosEstimados + margenSegundos) * 1000);

    const timeout = setTimeout(() => {
      ps.kill();
      resolve();
    }, timeoutMs);

    ps.on('error', (err) => {
      clearTimeout(timeout);
      console.error('Error al hablar (fallback):', err.message);
      resolve();
    });
    ps.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });

    ps.stdin.on('error', () => { }); // la callaron antes de leer el texto
    ps.stdin.write(text, 'utf8');
    ps.stdin.end();
  });
}

// Un audio ya preparado para sonar: el .wav de Piper, o (si Piper no está
// o falló) el texto para decirlo con la voz de respaldo de Windows.
type PreparedSpeech = { wav: string; text: string } | { fallbackText: string };

/**
 * Prepara el audio de un texto (Piper, con SAPI como respaldo si falla).
 * SIEMPRE resuelve, nunca rechaza — cualquier error queda registrado en
 * consola, pero nunca debe trabar la fila de voz. null = nada que decir.
 */
async function prepareSpeech(text: string, mood: Mood): Promise<PreparedSpeech | null> {
  if (os.platform() !== 'win32') {
    console.log(`[ALYA diría, ${mood}]: ${text}`);
    return null;
  }

  const speechText = toSpeechText(text);
  if (!speechText) return null; // ej. un mensaje que era solo emojis

  if (!piperIsAvailable()) {
    console.warn('Piper no está listo todavía (ver README) — usando voz de respaldo.');
    return { fallbackText: speechText };
  }

  const generation = stopGeneration;
  try {
    const wav = await synthesizeWithPiper(speechText, mood);
    return wav ? { wav, text: speechText } : null;
  } catch (err) {
    // Si falló porque la silenciaron, no hay que "rescatar" la frase con
    // la voz de respaldo: justamente se quería que se callara.
    if (generation !== stopGeneration) return null;
    console.error('Piper falló, usando voz de respaldo:', (err as Error).message);
    return { fallbackText: speechText };
  }
}

/** Hace sonar un audio ya preparado. Tampoco rechaza nunca. */
async function playPrepared(item: PreparedSpeech, generation: number): Promise<void> {
  if ('fallbackText' in item) {
    await speakFallback(item.fallbackText);
    return;
  }

  try {
    await playWav(item.wav);
  } catch (err) {
    if (generation !== stopGeneration) return;
    console.error('No se pudo reproducir la voz, usando voz de respaldo:', (err as Error).message);
    await speakFallback(item.text);
  } finally {
    removeWav(item.wav);
  }
}

// --- Silencio ---
// Los procesos que están generando o reproduciendo voz en este momento
// (para poder cortarlos), y un contador que cambia cada vez que se manda
// a callar: lo que estaba en la fila con el número viejo ya no se dice.
const activeProcesses = new Set<ChildProcess>();
let stopGeneration = 0;

function track<T extends ChildProcess>(child: T): T {
  activeProcesses.add(child);
  child.once('close', () => activeProcesses.delete(child));
  child.once('error', () => activeProcesses.delete(child));
  return child;
}

/** Corta lo que ALYA esté diciendo ahora y descarta lo que tenía en fila. */
export function stopSpeaking(): void {
  stopGeneration++;
  for (const child of activeProcesses) {
    try {
      child.kill();
    } catch {
      // ya había terminado
    }
  }
}

// Empieza como quedó la última vez (se guarda en la configuración).
let muted = loadSettings().muted === true;

export function isMuted(): boolean {
  return muted;
}

/**
 * Silencia o devuelve la voz. Al silenciar se calla EN EL MOMENTO (no
 * termina la frase) y no vuelve a hablar hasta que se la reactive.
 */
export function setMuted(value: boolean): void {
  muted = value;
  if (muted) stopSpeaking();
  try {
    saveSettings({ ...loadSettings(), muted });
  } catch (err) {
    console.warn('[ALYA] No se pudo guardar el estado de silencio:', (err as Error).message);
  }
}

// --- Fila de voz ---
// Son dos filas encadenadas:
//  1) la de PREPARAR el audio (Piper), una frase detrás de otra, y
//  2) la de REPRODUCIRLO, también de a una.
// Nunca suenan dos cosas a la vez (eso colgaba los procesos de audio),
// pero la frase siguiente se va generando mientras suena la anterior:
// así una respuesta larga se dice de corrido, sin silencios entre frases.
let synthQueue: Promise<void> = Promise.resolve();
let voiceQueue: Promise<void> = Promise.resolve();

// Aviso de "ALYA está hablando / dejó de hablar", para que la interfaz
// pueda animar el avatar. Se cuenta cuántas frases hay en la fila: avisa
// "hablando" con la primera y "terminó" recién cuando se vacía.
let speakingListener: ((speaking: boolean) => void) | null = null;
let pendingSpeech = 0;

export function setSpeakingListener(listener: (speaking: boolean) => void): void {
  speakingListener = listener;
}

/**
 * Espera a que ALYA termine de decir lo que tenga en fila (con un tope,
 * por si algo se cuelga). Sirve antes de escuchar el audio del PC: si
 * no, su propia voz se mezclaría con lo que se quiere reconocer.
 */
export function waitUntilQuiet(maxMs = 15000): Promise<void> {
  if (pendingSpeech === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxMs);
    voiceQueue.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Aviso de que un audio empezó a SONAR de verdad (no solo a prepararse).
// Lo usa la ventana para medir cuánto de la voz de ALYA le llega al
// micrófono antes de dejarse interrumpir por la voz del usuario.
let playbackListener: (() => void) | null = null;

export function setPlaybackListener(listener: () => void): void {
  playbackListener = listener;
}

/**
 * Pone un texto en la fila de voz. "mood" es el ánimo con el que se
 * dice (viene de la respuesta de ALYA); si no se pasa, se deduce del
 * propio texto. Si la voz está silenciada no hace nada.
 */
export function speak(text: string, mood?: Mood, options: { force?: boolean } = {}): void {
  // Silenciada: no dice nada. "force" es solo para avisos que tienen que
  // sonar igual (un recordatorio que pediste a una hora).
  if (muted && !options.force) return;

  const finalMood = mood ?? guessMood(text);
  const generation = stopGeneration;

  pendingSpeech++;
  if (pendingSpeech === 1) speakingListener?.(true);

  // 1) Preparar el audio. Espera su turno entre las preparaciones, pero
  //    NO a que termine de sonar lo anterior.
  const prepared: Promise<PreparedSpeech | null> = synthQueue
    .then(() => (generation !== stopGeneration ? null : prepareSpeech(text, finalMood)))
    .catch(() => null);
  synthQueue = prepared.then(() => undefined);

  // 2) Reproducirlo cuando le toque.
  voiceQueue = voiceQueue
    .then(async () => {
      const item = await prepared;
      if (!item) return;
      // La mandaron a callar mientras esto esperaba su turno: se descarta.
      if (generation !== stopGeneration) {
        if ('wav' in item) removeWav(item.wav);
        return;
      }
      await playPrepared(item, generation);
    })
    .catch(() => { }) // nada de lo anterior rechaza, pero la fila nunca debe romperse
    .then(() => {
      pendingSpeech--;
      if (pendingSpeech === 0) speakingListener?.(false);
    });
}

// --- Hablar mientras se escribe la respuesta ---
// La respuesta de ALYA llega de a poco. En vez de esperar al final para
// leerla entera, se va diciendo por frases completas: la primera apenas
// está (para que empiece a hablar enseguida) y las siguientes en tramos
// más largos (suenan más naturales que frase por frase).
const FIRST_CHUNK_MIN_CHARS = 16;
const NEXT_CHUNK_MIN_CHARS = 110;

// Fin de frase: . ! ? … (con comillas o paréntesis de cierre) seguidos de
// un espacio, o un salto de línea. "3.5" o "v1.0" no cuentan: no hay
// espacio después del punto.
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g;

/**
 * Cuántos caracteres del comienzo de "text" son frases completas.
 * "first": corta en la PRIMERA frase que alcance el mínimo; si no, en la
 * ÚLTIMA frase completa disponible. 0 = todavía no hay nada para decir.
 */
function completeSentencesLength(text: string, minLength: number, first: boolean): number {
  let cut = 0;
  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[0].length;
    if (end < minLength) continue;
    cut = end;
    if (first) break;
  }
  return cut;
}

export interface SpeechStream {
  /**
   * Texto de la respuesta hasta ahora (completo, no solo lo nuevo): dice
   * las frases que ya estén terminadas. "settled" = ese texto ya quedó
   * cerrado, se dice todo lo pendiente sin esperar a que siga.
   */
  push(textSoFar: string, mood?: Mood, settled?: boolean): void;
  /** La respuesta terminó: dice lo que faltaba. */
  end(finalText: string, mood?: Mood): void;
}

/** Empieza a decir una respuesta que todavía se está escribiendo. */
export function createSpeechStream(): SpeechStream {
  const generation = stopGeneration;
  let spoken = 0; // hasta qué carácter del texto ya se mandó a la fila de voz
  let chunks = 0;
  let streamMood: Mood | undefined; // un solo ánimo para toda la respuesta

  const say = (chunk: string, mood: Mood | undefined): void => {
    // Si la callaron (o la silenciaron) a mitad de la respuesta, el resto
    // de ESTA respuesta ya no se dice; la próxima sí.
    if (generation !== stopGeneration) return;
    const clean = chunk.trim();
    if (!clean) return;
    if (!streamMood) streamMood = mood ?? guessMood(clean);
    chunks++;
    speak(clean, streamMood);
  };

  return {
    push(textSoFar: string, mood?: Mood, settled = false): void {
      const pending = textSoFar.slice(spoken);
      const cut = settled
        ? pending.length
        : chunks === 0
          ? completeSentencesLength(pending, FIRST_CHUNK_MIN_CHARS, true)
          : completeSentencesLength(pending, NEXT_CHUNK_MIN_CHARS, false);
      if (cut === 0) return;
      say(pending.slice(0, cut), mood);
      spoken += cut;
    },
    end(finalText: string, mood?: Mood): void {
      say(finalText.slice(spoken), mood);
      spoken = finalText.length;
    },
  };
}

// Se dejan exportadas por compatibilidad con main.ts, aunque este modo
// no usa un servidor persistente (ver historial: el binario de Piper que
// tenemos no soporta quedarse vivo recibiendo frases sueltas).
export function startVoiceServer(): void { }
export function stopVoiceServer(): void { }