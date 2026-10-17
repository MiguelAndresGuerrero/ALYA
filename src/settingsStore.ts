import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ThinkingMode } from './thinking';
import type { WakeSensitivity } from './wakeMatch';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'configuracion.json');

export interface AlyaSettings {
    userName: string;
    tone: number; // tono de la voz, 0.1-2.0 (1 = normal): más bajo = más grave y serena, más alto = más aguda y animada. NO cambia la duración de las palabras.
    autoExpression: boolean; // si ALYA ajusta sola la expresión según lo que dice
    thinkingMode: ThinkingMode; // 'auto' = piensa más solo cuando la pregunta lo pide, 'rapido' = nunca, 'profundo' = siempre
    adaptToUser: boolean; // si ALYA aprende cómo la usa esta persona y se adapta
    noiseScale: number; // entonación: más alto = menos plana
    noiseW: number; // variación en duración de sonidos
    volume: number; // volumen de la voz, 0-100
    muted: boolean; // voz silenciada con el botón del chat (se recuerda entre sesiones)
    voiceInterrupt: boolean; // ALYA se calla si te escucha hablar mientras ella habla (pensado para audífonos)
    wakeEnabled: boolean; // escucha activa: se despierta al oír una de las frases
    wakePhrases: string; // frases para despertarla, separadas por coma
    wakeSensitivity: WakeSensitivity;
    wakeSilenceMs: number; // pausa que da por terminada tu frase
    wakeConversationSeconds: number; // cuánto sigue escuchando después de responder (0 = nada)
    wakeSound: boolean; // tono corto al despertarse
    wakeShowWindow: boolean; // muestra la ventana del chat al llamarla
    wakePauseWhileObs: boolean;
}

const DEFAULT_SETTINGS: AlyaSettings = {
    userName: 'Andrés',
    tone: 1.0,
    autoExpression: true,
    thinkingMode: 'auto',
    adaptToUser: true,
    noiseScale: 0.85,
    noiseW: 1.0,
    volume: 100,
    muted: false,
    voiceInterrupt: false,
    wakeEnabled: false,
    wakePhrases: 'oye alya, hola alya',
    wakeSensitivity: 'normal',
    wakeSilenceMs: 1200,
    wakeConversationSeconds: 8,
    wakeSound: true,
    wakeShowWindow: false,
    wakePauseWhileObs: false,
};

export function loadSettings(): AlyaSettings {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings(settings: AlyaSettings): void {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}