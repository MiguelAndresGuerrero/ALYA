// --- Expresión de ALYA ---
// Acá vive todo lo que decide CÓMO suena una frase (no QUÉ dice):
// el "ánimo" de cada respuesta y cómo ese ánimo, junto con el control
// de "Tono de la voz" del panel de Configuración, se traduce a números
// para la síntesis de voz.

export type Mood = 'neutral' | 'alegre' | 'calmada' | 'seria' | 'apenada' | 'sorprendida';

export const MOODS: Mood[] = ['neutral', 'alegre', 'calmada', 'seria', 'apenada', 'sorprendida'];

/**
 * Cómo modifica la voz cada ánimo, RELATIVO a lo que esté configurado
 * en el panel (no son valores absolutos).
 */
export interface MoodShape {
    semitones: number; // sube/baja el tono (+ = más aguda, - = más grave)
    noiseDelta: number; // sube/baja la expresividad (altibajos al hablar)
    rhythm: number; // multiplicador del ritmo de las palabras (1 = igual)
    pauseSeconds: number; // pausa entre frases
}

export const MOOD_SHAPES: Record<Mood, MoodShape> = {
    neutral: { semitones: 0, noiseDelta: 0, rhythm: 1, pauseSeconds: 0.2 },
    alegre: { semitones: 1.0, noiseDelta: 0.1, rhythm: 0.96, pauseSeconds: 0.15 },
    sorprendida: { semitones: 1.5, noiseDelta: 0.15, rhythm: 0.97, pauseSeconds: 0.18 },
    calmada: { semitones: -0.8, noiseDelta: -0.1, rhythm: 1.05, pauseSeconds: 0.35 },
    seria: { semitones: -1.2, noiseDelta: -0.18, rhythm: 1.0, pauseSeconds: 0.3 },
    apenada: { semitones: -1.0, noiseDelta: -0.08, rhythm: 1.06, pauseSeconds: 0.32 },
};

// Rango del control "Tono de la voz" del panel de Configuración.
export const TONE_MIN = 0.1;
export const TONE_MAX = 2.0;
export const TONE_DEFAULT = 1.0;

/**
 * Traduce el control "Tono de la voz" (0.1 a 2.0, donde 1.0 es la voz
 * tal cual) a cómo cambia la voz. Bajarlo NO estira las palabras: la
 * vuelve más grave y serena. Subirlo la vuelve más aguda y animada.
 */
export function toneToShape(tone: number): MoodShape {
    const t = Math.max(TONE_MIN, Math.min(TONE_MAX, Number.isFinite(tone) ? tone : TONE_DEFAULT));

    if (t < 1) {
        const amount = (1 - t) / (1 - TONE_MIN); // 0 (normal) a 1 (lo más bajo)
        return {
            semitones: -3.5 * amount,
            noiseDelta: -0.18 * amount,
            rhythm: 1,
            pauseSeconds: 0.15 * amount, // se SUMA a la pausa del ánimo
        };
    }

    const amount = (t - 1) / (TONE_MAX - 1); // 0 (normal) a 1 (lo más alto)
    return {
        semitones: 3.0 * amount,
        noiseDelta: 0.1 * amount,
        rhythm: 1,
        pauseSeconds: 0,
    };
}

const MOOD_TAG_REGEX = new RegExp(`\\[\\s*(${MOODS.join('|')})\\s*\\]\\s*`, 'gi');

/**
 * El modelo empieza cada respuesta con una etiqueta tipo "[alegre]".
 * Esta función la saca del texto (nunca se muestra ni se lee en voz
 * alta) y devuelve el ánimo que indicaba. Si no vino ninguna etiqueta,
 * mood queda undefined.
 */
export function extractMood(text: string): { text: string; mood: Mood | undefined } {
    let mood: Mood | undefined;
    const clean = text.replace(MOOD_TAG_REGEX, (_match, tag: string) => {
        if (!mood) mood = tag.toLowerCase() as Mood;
        return '';
    });
    return { text: clean.trim(), mood };
}

/**
 * Respaldo para cuando no hay etiqueta (ej. recordatorios, avisos del
 * sistema, o si el modelo se la saltó): adivina el ánimo mirando el texto.
 */
export function guessMood(text: string): Mood {
    const t = text.toLowerCase();

    if (/(lo siento|perd[oó]n|disculpa|lamento|no pude|no logr[eé]|tuve un problema|algo fall[oó])/.test(t)) {
        return 'apenada';
    }
    if (/(cuidado|advertencia|peligro|atenci[oó]n|riesgo|amenaza|virus|cr[ií]tic|urgente)/.test(t)) {
        return 'seria';
    }
    if (/(tranquil|no te preocupes|con calma|descansa|respira|buenas noches)/.test(t)) {
        return 'calmada';
    }
    if (/(¡(vaya|wow|guau|uy|no puede ser|incre[ií]ble)|¿en serio\?|¿de verdad\?)/.test(t)) {
        return 'sorprendida';
    }
    if (
        /[¡!]/.test(t) &&
        /(hola|genial|perfecto|excelente|claro|me alegra|qu[eé] bien|buen[ií]simo|felicidades|jaja|me encanta|bienvenid)/.test(t)
    ) {
        return 'alegre';
    }
    return 'neutral';
}