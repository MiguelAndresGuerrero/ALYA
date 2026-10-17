// Corre en un proceso aparte (utilityProcess): carga Vosk y escucha si en
// el audio del micrófono aparece alguna de las frases para despertar a
// ALYA. Todo pasa dentro del PC: este proceso no manda nada a internet ni
// guarda el audio, solo avisa cuándo oyó la frase.
import * as fs from 'fs';
import * as path from 'path';
import {
    findGrammarPhrase,
    findWakePhrase,
    resolvePhrases,
    type HeardWord,
    type WakeSensitivity,
} from './wakeMatch';

type EngineConfig = { phrases: string[]; sensitivity: WakeSensitivity };

type Incoming =
    | ({ type: 'start'; voskDir: string } & EngineConfig)
    | ({ type: 'config' } & EngineConfig)
    | { type: 'audio'; data: Uint8Array }
    | { type: 'flush' };

type Outgoing =
    | { type: 'ready'; model: string; mode: 'grammar' | 'free' }
    | { type: 'wake'; phrase: string }
    | { type: 'error'; message: string };

type Pointer = unknown;

interface Vosk {
    findWord: (model: Pointer, word: string) => number;
    newRecognizer: (model: Pointer, rate: number) => Pointer;
    newGrammarRecognizer: (model: Pointer, rate: number, grammar: string) => Pointer;
    setWords: (recognizer: Pointer, words: number) => void;
    free: (recognizer: Pointer) => void;
    accept: (recognizer: Pointer, data: Buffer, length: number) => number;
    result: (recognizer: Pointer) => string;
    partial: (recognizer: Pointer) => string;
    final: (recognizer: Pointer) => string;
    reset: (recognizer: Pointer) => void;
}

const SAMPLE_RATE = 16000;
const MAX_CHUNK_BYTES = SAMPLE_RATE * 2 * 2;

// Palabras que suenan parecido a las frases o salen mucho en una charla.
// Con ellas en la gramática, "oye, allá está" se reconoce como eso y no
// se fuerza a "oye alia".
const DECOYS = (
    'a ya la allá allí ahí hay haya aya halla hola oye oiga olla o y e que qué de el lo le se si sí no un una ' +
    'es está para por con como cómo mi tu su me te ella ale ali alí lía lia italia amalia dalia talía hoy ' +
    'ayer ahora bien voy vamos va casa'
).split(' ');

let vosk: Vosk | null = null;
let model: Pointer = null;
let recognizer: Pointer = null;
let grammarPhrases: string[] | null = null;
let config: EngineConfig = { phrases: [], sensitivity: 'normal' };

function send(message: Outgoing): void {
    process.parentPort.postMessage(message);
}

function libraryFiles(libDir: string): string[] {
    if (process.platform === 'win32') {
        // Vosk depende de estas tres; cargarlas antes por ruta completa evita
        // que Windows las busque en otras carpetas del sistema.
        return ['libwinpthread-1.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libvosk.dll'].map((file) =>
            path.join(libDir, file)
        );
    }
    return [path.join(libDir, 'libvosk.so')];
}

// Busca la carpeta del modelo hasta dos niveles abajo, porque al
// descomprimir el .zip en Windows suele quedar una carpeta dentro de otra.
function findModelDir(dir: string, depth = 2): string | null {
    if (fs.existsSync(path.join(dir, 'am')) && fs.existsSync(path.join(dir, 'conf'))) return dir;
    if (depth === 0) return null;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'lib') continue;
        const found = findModelDir(path.join(dir, entry.name), depth - 1);
        if (found) return found;
    }
    return null;
}

/**
 * Arma el reconocedor para las frases actuales. Si el modelo conoce todas
 * sus palabras, usa una gramática cerrada (mucho más precisa); si no, el
 * reconocimiento libre comparando por cómo suena.
 */
function buildRecognizer(): 'grammar' | 'free' {
    if (!vosk) throw new Error('Vosk no está cargado.');
    if (recognizer) vosk.free(recognizer);
    recognizer = null;

    const knows = (word: string) => vosk!.findWord(model, word) >= 0;
    grammarPhrases = resolvePhrases(config.phrases, knows);

    if (grammarPhrases) {
        const decoys = DECOYS.filter((word) => knows(word));
        const grammar = JSON.stringify([...new Set([...grammarPhrases, ...decoys])].concat('[unk]'));
        recognizer = vosk.newGrammarRecognizer(model, SAMPLE_RATE, grammar);
        if (recognizer) vosk.setWords(recognizer, 1);
    } else {
        recognizer = vosk.newRecognizer(model, SAMPLE_RATE);
    }
    if (!recognizer) throw new Error('No pude crear el reconocedor de voz.');
    return grammarPhrases ? 'grammar' : 'free';
}

function start(voskDir: string): void {
    const libDir = path.join(voskDir, 'lib');
    const libs = libraryFiles(libDir);
    const missingLib = libs.find((file) => !fs.existsSync(file));
    if (missingLib) throw new Error(`Falta la biblioteca de Vosk: ${missingLib}`);

    const modelDir = findModelDir(voskDir);
    if (!modelDir) throw new Error(`No encontré el modelo de voz dentro de ${voskDir}`);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi');
    let lib: ReturnType<typeof koffi.load> | null = null;
    for (const file of libs) lib = koffi.load(file);
    if (!lib) throw new Error('No pude cargar Vosk.');

    lib.func('void vosk_set_log_level(int level)')(-1);
    model = lib.func('void* vosk_model_new(const char* path)')(modelDir);
    if (!model) throw new Error(`El modelo de voz no se pudo abrir: ${modelDir}`);

    vosk = {
        findWord: lib.func('int vosk_model_find_word(void* model, const char* word)'),
        newRecognizer: lib.func('void* vosk_recognizer_new(void* model, float sample_rate)'),
        newGrammarRecognizer: lib.func('void* vosk_recognizer_new_grm(void* model, float sample_rate, const char* grammar)'),
        setWords: lib.func('void vosk_recognizer_set_words(void* rec, int words)'),
        free: lib.func('void vosk_recognizer_free(void* rec)'),
        accept: lib.func('int vosk_recognizer_accept_waveform(void* rec, const char* data, int length)'),
        result: lib.func('const char* vosk_recognizer_result(void* rec)'),
        partial: lib.func('const char* vosk_recognizer_partial_result(void* rec)'),
        final: lib.func('const char* vosk_recognizer_final_result(void* rec)'),
        reset: lib.func('void vosk_recognizer_reset(void* rec)'),
    };
    const mode = buildRecognizer();
    send({ type: 'ready', model: path.basename(modelDir), mode });
}

function parse(json: string): Record<string, unknown> {
    try {
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function heardWords(result: Record<string, unknown>): HeardWord[] {
    if (Array.isArray(result.result)) {
        return result.result
            .filter((item): item is { word: string; conf: number } => typeof item?.word === 'string')
            .map((item) => ({ word: item.word, conf: typeof item.conf === 'number' ? item.conf : undefined }));
    }
    const text = typeof result.text === 'string' ? result.text : typeof result.partial === 'string' ? result.partial : '';
    return text.split(' ').filter(Boolean).map((word) => ({ word }));
}

function check(result: Record<string, unknown>): void {
    if (!vosk) return;
    const phrase = grammarPhrases
        ? findGrammarPhrase(heardWords(result), grammarPhrases, config.sensitivity)
        : findWakePhrase(heardWords(result).map((item) => item.word).join(' '), config.phrases, config.sensitivity);
    if (!phrase) return;
    vosk.reset(recognizer);
    send({ type: 'wake', phrase });
}

function feed(data: Uint8Array): void {
    if (!vosk || !(data instanceof Uint8Array)) return;
    if (data.byteLength === 0 || data.byteLength > MAX_CHUNK_BYTES || data.byteLength % 2 !== 0) return;
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const isFinal = vosk.accept(recognizer, buffer, buffer.length) === 1;
    if (isFinal) {
        check(parse(vosk.result(recognizer)));
    } else if (config.sensitivity === 'alta') {
        // En "sensible" se reacciona apenas se oye, sin esperar a que el
        // reconocedor cierre la frase (más rápido, pero sin medir su seguridad).
        check(parse(vosk.partial(recognizer)));
    }
}

function flush(): void {
    if (!vosk) return;
    check(parse(vosk.final(recognizer)));
    vosk.reset(recognizer);
}

process.parentPort.on('message', (event: { data: Incoming }) => {
    const message = event.data;
    try {
        switch (message.type) {
            case 'start':
                config = { phrases: message.phrases, sensitivity: message.sensitivity };
                start(message.voskDir);
                break;
            case 'config':
                config = { phrases: message.phrases, sensitivity: message.sensitivity };
                if (vosk) buildRecognizer();
                break;
            case 'audio':
                feed(message.data);
                break;
            case 'flush':
                flush();
                break;
        }
    } catch (err) {
        send({ type: 'error', message: (err as Error).message });
    }
});