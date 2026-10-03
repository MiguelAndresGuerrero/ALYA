import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// --- Perfil de comportamiento del usuario ---
// Cada persona usa a ALYA distinto: unos escriben corto y solo piden
// música, otros la usan para programar de madrugada. Este archivo lleva
// la cuenta de CÓMO la usa quien la tiene instalada, para que ALYA se
// adapte sola a esa persona.
//
// Vive en la carpeta de datos de la app (igual que memoria.json), así que
// cada usuario de Windows / cada instalación tiene su propio perfil, y
// nada de esto sale del PC salvo el resumen corto que va en el prompt.
const PROFILE_FILE = path.join(app.getPath('userData'), 'perfil.json');

const MAX_STYLE_NOTES = 15; // si aprende más, se van las más viejas
const MIN_MESSAGES_FOR_STATS = 8; // con menos, los números todavía no dicen nada

export interface UserProfile {
    /** Observaciones que ALYA fue notando sobre cómo se comunica y qué prefiere. */
    styleNotes: string[];
    /** Cuántas veces se usó cada herramienta (ej. "reproducir_spotify", "abrir_app:discord"). */
    toolUsage: Record<string, number>;
    /** Mensajes recibidos por hora del día (24 posiciones, 0 = medianoche). */
    hourCounts: number[];
    messageCount: number;
    totalChars: number;
}

function emptyProfile(): UserProfile {
    return { styleNotes: [], toolUsage: {}, hourCounts: new Array(24).fill(0), messageCount: 0, totalChars: 0 };
}

export function loadProfile(): UserProfile {
    try {
        const parsed = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
        const base = emptyProfile();
        return {
            styleNotes: Array.isArray(parsed.styleNotes) ? parsed.styleNotes.filter((n: unknown) => typeof n === 'string') : [],
            toolUsage: parsed.toolUsage && typeof parsed.toolUsage === 'object' ? parsed.toolUsage : {},
            hourCounts:
                Array.isArray(parsed.hourCounts) && parsed.hourCounts.length === 24 ? parsed.hourCounts : base.hourCounts,
            messageCount: Number(parsed.messageCount) || 0,
            totalChars: Number(parsed.totalChars) || 0,
        };
    } catch {
        return emptyProfile(); // no existe todavía, o está corrupto — empezamos de cero
    }
}

function saveProfile(profile: UserProfile): void {
    try {
        fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
        fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
    } catch (err) {
        // El perfil es un extra: si no se puede guardar, el chat sigue igual.
        console.warn('[ALYA] No se pudo guardar el perfil:', (err as Error).message);
    }
}

/** Anota un mensaje del usuario: a qué hora fue y qué tan largo. */
export function recordUserMessage(text: string, when: Date = new Date()): void {
    const profile = loadProfile();
    profile.messageCount++;
    profile.totalChars += text.length;
    profile.hourCounts[when.getHours()]++;
    saveProfile(profile);
}

/**
 * Anota que se usó una herramienta. Para abrir_app se guarda también
 * CUÁL app (así ALYA sabe que este usuario abre sobre todo Discord, por
 * ejemplo); para el resto alcanza con el nombre de la herramienta.
 */
export function recordToolUse(name: string, args: Record<string, unknown>): void {
    if (!name) return;
    const profile = loadProfile();
    const appName = name === 'abrir_app' ? String(args.nombre ?? '').trim().toLowerCase() : '';
    const key = appName ? `${name}:${appName}` : name;
    profile.toolUsage[key] = (profile.toolUsage[key] ?? 0) + 1;
    saveProfile(profile);
}

/** Guarda una observación nueva sobre el estilo del usuario (sin repetir). */
export function addStyleNote(note: string): void {
    const clean = note.trim();
    if (!clean) return;
    const profile = loadProfile();
    if (profile.styleNotes.some((n) => n.toLowerCase() === clean.toLowerCase())) return;
    profile.styleNotes.push(clean);
    if (profile.styleNotes.length > MAX_STYLE_NOTES) {
        profile.styleNotes = profile.styleNotes.slice(-MAX_STYLE_NOTES);
    }
    saveProfile(profile);
}

/** Borra la primera observación que coincida (parcialmente) con el texto. */
export function removeStyleNote(matchText: string): boolean {
    const profile = loadProfile();
    const idx = profile.styleNotes.findIndex((n) => n.toLowerCase().includes(matchText.toLowerCase()));
    if (idx === -1) return false;
    profile.styleNotes.splice(idx, 1);
    saveProfile(profile);
    return true;
}

/** Borra todo lo aprendido sobre el comportamiento del usuario. */
export function resetProfile(): void {
    saveProfile(emptyProfile());
}

const PERIODS: Array<{ label: string; from: number; to: number }> = [
    { label: 'de madrugada', from: 0, to: 5 },
    { label: 'por la mañana', from: 6, to: 11 },
    { label: 'por la tarde', from: 12, to: 18 },
    { label: 'por la noche', from: 19, to: 23 },
];

/**
 * Resume el perfil en frases cortas para el prompt del sistema. Devuelve
 * una lista vacía si todavía no hay nada útil que decir.
 */
export function describeProfile(profile: UserProfile = loadProfile()): string[] {
    const lines: string[] = [];

    if (profile.messageCount >= MIN_MESSAGES_FOR_STATS) {
        const average = profile.totalChars / profile.messageCount;
        if (average < 45) {
            lines.push('Escribe mensajes muy cortos y directos: respóndele igual de breve, sin rodeos ni introducciones.');
        } else if (average > 160) {
            lines.push('Escribe mensajes largos y con detalle: puedes extenderte más y entrar en detalle cuando te escribe así.');
        }

        const total = profile.hourCounts.reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (const period of PERIODS) {
                let count = 0;
                for (let h = period.from; h <= period.to; h++) count += profile.hourCounts[h];
                if (count / total >= 0.5) {
                    lines.push(`Suele usarte sobre todo ${period.label}.`);
                    break;
                }
            }
        }
    }

    const topTools = Object.entries(profile.toolUsage)
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => `${key.replace(':', ' → ')} (${count} veces)`);
    if (topTools.length > 0) {
        lines.push(
            `Lo que más te pide (herramienta y veces): ${topTools.join(', ')}. Úsalo para interpretar pedidos cortos o ambiguos.`
        );
    }

    for (const note of profile.styleNotes) lines.push(note);

    return lines;
}