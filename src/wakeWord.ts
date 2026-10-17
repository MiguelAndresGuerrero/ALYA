import { utilityProcess, type UtilityProcess } from 'electron';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getResourcePath } from './resourcePaths';
import { loadSettings, type AlyaSettings } from './settingsStore';
import { displayWakePhrase, normalizeSensitivity, parseWakePhrases } from './wakeMatch';

export type WakeState = 'off' | 'loading' | 'listening' | 'paused' | 'unavailable';

export interface WakeStatus {
    state: WakeState;
    detail: string;
    phrase: string;
    silenceMs: number;
    conversationSeconds: number;
    sound: boolean;
}

// Más de esto en un minuto huele a que algo la está despertando sola (un
// video, el stream, un eco): se pausa un rato y avisa.
const MAX_WAKES_PER_MINUTE = 6;
const RATE_LIMIT_PAUSE_MS = 2 * 60 * 1000;
const OBS_CHECK_MS = 15000;
const MAX_CHUNK_BYTES = 16000 * 2 * 2;

let child: UtilityProcess | null = null;
let ready = false;
let unavailableReason = '';
let obsRunning = false;
let rateLimitedUntil = 0;
let obsTimer: NodeJS.Timeout | null = null;
let rateTimer: NodeJS.Timeout | null = null;
const recentWakes: number[] = [];

let statusListener: ((status: WakeStatus) => void) | null = null;
let wakeHandler: (() => void) | null = null;
let lastStatusKey = '';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, number));
}

function wakeSettings(settings: AlyaSettings = loadSettings()) {
    return {
        enabled: settings.wakeEnabled === true,
        phrases: parseWakePhrases(settings.wakePhrases),
        phrase: displayWakePhrase(settings.wakePhrases),
        sensitivity: normalizeSensitivity(settings.wakeSensitivity),
        silenceMs: clamp(settings.wakeSilenceMs, 600, 2500, 1200),
        conversationSeconds: clamp(settings.wakeConversationSeconds, 0, 20, 8),
        sound: settings.wakeSound !== false,
        pauseWhileObs: settings.wakePauseWhileObs === true,
    };
}

export function getWakeStatus(): WakeStatus {
    const settings = wakeSettings();
    let state: WakeState = 'listening';
    let detail = '';

    if (!settings.enabled) {
        state = 'off';
    } else if (unavailableReason) {
        state = 'unavailable';
        detail = unavailableReason;
    } else if (!ready) {
        state = 'loading';
        detail = 'Cargando el reconocimiento de voz…';
    } else if (Date.now() < rateLimitedUntil) {
        state = 'paused';
        detail = 'Pausada: se despertó demasiadas veces seguidas.';
    } else if (settings.pauseWhileObs && obsRunning) {
        state = 'paused';
        detail = 'Pausada mientras OBS está abierto.';
    }

    return {
        state,
        detail,
        phrase: settings.phrase,
        silenceMs: settings.silenceMs,
        conversationSeconds: settings.conversationSeconds,
        sound: settings.sound,
    };
}

function publish(): void {
    const status = getWakeStatus();
    const key = JSON.stringify(status);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    statusListener?.(status);
}

export function setWakeStatusListener(listener: (status: WakeStatus) => void): void {
    statusListener = listener;
}

export function setWakeHandler(handler: () => void): void {
    wakeHandler = handler;
}

function checkObs(): void {
    exec('tasklist /FI "IMAGENAME eq obs64.exe" /NH', { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        obsRunning = !error && /obs64\.exe/i.test(stdout);
        publish();
    });
}

function stopEngine(): void {
    if (child) {
        child.removeAllListeners();
        child.kill();
    }
    child = null;
    ready = false;
    if (obsTimer) clearInterval(obsTimer);
    obsTimer = null;
}

function startEngine(): void {
    const settings = wakeSettings();
    const voskDir = getResourcePath('vosk');
    unavailableReason = '';
    ready = false;

    if (!fs.existsSync(voskDir)) {
        unavailableReason = `Falta el reconocimiento de voz: no existe la carpeta ${voskDir}.`;
        publish();
        return;
    }

    child = utilityProcess.fork(path.join(__dirname, 'wakeEngine.js'), [], { serviceName: 'ALYA escucha activa' });

    child.on('message', (message: { type: string; model?: string; phrase?: string; message?: string }) => {
        if (message.type === 'ready') {
            ready = true;
            console.log(`[ALYA] Escucha activa lista (modelo ${message.model}).`);
        } else if (message.type === 'error') {
            console.warn('[ALYA] Escucha activa:', message.message);
            if (!ready) {
                unavailableReason = message.message ?? 'No se pudo iniciar el reconocimiento de voz.';
                stopEngine();
            }
        } else if (message.type === 'wake') {
            onWake();
        }
        publish();
    });

    child.on('exit', (code) => {
        if (!child) return;
        child = null;
        ready = false;
        unavailableReason = `El reconocimiento de voz se cerró (código ${code}). Apágala y vuelve a encenderla.`;
        publish();
    });

    child.postMessage({
        type: 'start',
        voskDir,
        phrases: settings.phrases,
        sensitivity: settings.sensitivity,
    });

    if (settings.pauseWhileObs) {
        checkObs();
        obsTimer = setInterval(checkObs, OBS_CHECK_MS);
    }
    publish();
}

function onWake(): void {
    const now = Date.now();
    while (recentWakes.length > 0 && now - recentWakes[0] > 60000) recentWakes.shift();
    recentWakes.push(now);

    if (recentWakes.length > MAX_WAKES_PER_MINUTE) {
        recentWakes.length = 0;
        rateLimitedUntil = now + RATE_LIMIT_PAUSE_MS;
        console.warn('[ALYA] Escucha activa pausada: se despertó demasiadas veces en un minuto.');
        if (rateTimer) clearTimeout(rateTimer);
        rateTimer = setTimeout(publish, RATE_LIMIT_PAUSE_MS + 100);
        publish();
        return;
    }
    if (getWakeStatus().state !== 'listening') return;
    wakeHandler?.();
}

/** Arranca, reconfigura o apaga la escucha según lo guardado en Configuración. */
export function configureWake(): void {
    const settings = wakeSettings();
    if (!settings.enabled) {
        stopEngine();
        unavailableReason = '';
        publish();
        return;
    }
    if (!child) {
        startEngine();
        return;
    }
    child.postMessage({ type: 'config', phrases: settings.phrases, sensitivity: settings.sensitivity });
    if (settings.pauseWhileObs && !obsTimer) {
        checkObs();
        obsTimer = setInterval(checkObs, OBS_CHECK_MS);
    } else if (!settings.pauseWhileObs && obsTimer) {
        clearInterval(obsTimer);
        obsTimer = null;
        obsRunning = false;
    }
    publish();
}

/** Audio del micrófono (PCM 16 kHz, 16 bits) mandado por la ventana de chat. */
export function feedWakeAudio(chunk: unknown): void {
    if (!child || getWakeStatus().state !== 'listening') return;
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) return;
    if (chunk.byteLength > MAX_CHUNK_BYTES || chunk.byteLength % 2 !== 0) return;
    child.postMessage({ type: 'audio', data: chunk });
}

export function flushWakeAudio(): void {
    if (child && ready) child.postMessage({ type: 'flush' });
}

export function shutdownWake(): void {
    stopEngine();
    if (rateTimer) clearTimeout(rateTimer);
}