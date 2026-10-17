export type WakeSensitivity = 'baja' | 'normal' | 'alta';

export const DEFAULT_WAKE_PHRASES = 'oye alya, hola alya';

const MAX_PHRASES = 5;
const MAX_WORDS_PER_PHRASE = 4;

// Cuántas letras de diferencia se aceptan entre lo que se oyó y la frase
// (solo en el modo libre, cuando la frase tiene palabras que el modelo no conoce).
const TOLERANCE: Record<WakeSensitivity, number> = { baja: 0, normal: 1, alta: 2 };

// Seguridad mínima del reconocedor en cada palabra de la frase (modo gramática).
const MIN_CONFIDENCE: Record<WakeSensitivity, number> = { baja: 0.85, normal: 0.6, alta: 0.4 };

function stripAccents(text: string): string {
    return text
        .replace(/ñ/g, '\u0000')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\u0000/g, 'ñ');
}

/**
 * Escribe un texto en español "como suena": sin tildes, sin signos, y con
 * las letras que se pronuncian igual unificadas (ll/y/i, v/b, z/s, c/k...).
 * Así "oye alya", "oye alia" y "oye allía" quedan iguales.
 */
export function phonetic(text: string): string {
    return stripAccents(text.toLowerCase())
        .replace(/[^a-zñ\s]/g, ' ')
        .replace(/ll/g, 'y')
        .replace(/y/g, 'i')
        .replace(/h/g, '')
        .replace(/v/g, 'b')
        .replace(/z/g, 's')
        .replace(/c([ei])/g, 's$1')
        .replace(/qu/g, 'k')
        .replace(/c/g, 'k')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Las frases que escribió el usuario (separadas por coma), limpias: minúsculas, sin signos. */
export function parseWakePhrases(raw: unknown): string[] {
    const source = typeof raw === 'string' && raw.trim() ? raw : DEFAULT_WAKE_PHRASES;
    const seen = new Set<string>();
    const phrases: string[] = [];
    for (const part of source.split(/[,\n;]/)) {
        const phrase = part
            .toLowerCase()
            .replace(/[^a-zñáéíóúü\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, MAX_WORDS_PER_PHRASE)
            .join(' ');
        const sound = phonetic(phrase);
        if (sound.replace(/ /g, '').length < 4 || seen.has(sound)) continue;
        seen.add(sound);
        phrases.push(phrase);
        if (phrases.length === MAX_PHRASES) break;
    }
    return phrases.length > 0 ? phrases : parseWakePhrases(DEFAULT_WAKE_PHRASES);
}

/** La primera frase que sirve, tal como la escribió el usuario, para mostrarla. */
export function displayWakePhrase(raw: unknown): string {
    const parts = typeof raw === 'string' ? raw.split(/[,\n;]/).map((part) => part.trim().slice(0, 40)) : [];
    return parts.find((part) => phonetic(part).replace(/ /g, '').length >= 4) || 'Oye ALYA';
}

export function normalizeSensitivity(value: unknown): WakeSensitivity {
    return value === 'baja' || value === 'alta' ? value : 'normal';
}

/**
 * Formas de escribir una palabra que suenan igual, para encontrar la que
 * el modelo de voz conoce ("alya" no está en su diccionario, "alia" sí).
 */
export function wordVariants(word: string): string[] {
    const plain = stripAccents(word.toLowerCase());
    const y = plain.replace(/ll/g, 'y');
    return [
        word.toLowerCase(),
        plain,
        plain.replace(/y/g, 'i'),
        y,
        y.replace(/y/g, 'i'),
        plain.replace(/i/g, 'y'),
        plain.replace(/y/g, 'll'),
        plain.replace(/v/g, 'b'),
        plain.replace(/b/g, 'v'),
        plain.replace(/z/g, 's'),
        plain.replace(/s/g, 'z'),
        plain.replace(/k/g, 'c'),
        plain.replace(/^h/, ''),
        `h${plain}`,
    ].filter((variant, index, all) => variant && all.indexOf(variant) === index);
}

/**
 * Pasa cada frase a palabras que el modelo conoce. Si alguna palabra no
 * tiene ninguna forma conocida, devuelve null y se usa el modo libre.
 */
export function resolvePhrases(phrases: string[], knows: (word: string) => boolean): string[] | null {
    const resolved: string[] = [];
    for (const phrase of phrases) {
        const words: string[] = [];
        for (const word of phrase.split(' ')) {
            const known = wordVariants(word).find(knows);
            if (!known) return null;
            words.push(known);
        }
        resolved.push(words.join(' '));
    }
    return resolved;
}

export interface HeardWord {
    word: string;
    conf?: number;
}

/**
 * Modo gramática: el reconocedor solo puede devolver las palabras de las
 * frases y unas cuantas parecidas, así que basta con que aparezcan seguidas.
 * Si trae la seguridad de cada palabra, también tiene que alcanzar el mínimo.
 */
export function findGrammarPhrase(heard: HeardWord[], phrases: string[], sensitivity: WakeSensitivity): string | null {
    const minimum = MIN_CONFIDENCE[sensitivity];
    for (const phrase of phrases) {
        const words = phrase.split(' ');
        for (let start = 0; start + words.length <= heard.length; start++) {
            const slice = heard.slice(start, start + words.length);
            const same = slice.every((item, i) => item.word === words[i]);
            const sure = slice.every((item) => item.conf === undefined || item.conf >= minimum);
            if (same && sure) return phrase;
        }
    }
    return null;
}

function levenshtein(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = previous[j];
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
            );
            diagonal = above;
        }
    }
    return previous[b.length];
}

/**
 * Modo libre: busca alguna de las frases dentro de lo que se oyó, por cómo
 * suena. Compara grupos de palabras seguidas sin espacios, porque el
 * reconocedor a veces corta una palabra en dos ("alia" puede salir como
 * "a lia"). Devuelve la frase encontrada o null.
 */
export function findWakePhrase(heard: string, phrases: string[], sensitivity: WakeSensitivity): string | null {
    const words = phonetic(heard).split(' ').filter(Boolean);
    if (words.length === 0) return null;

    for (const phrase of phrases) {
        const sound = phonetic(phrase);
        const target = sound.replace(/ /g, '');
        const phraseWords = sound.split(' ').length;
        // Una frase corta con mucha tolerancia se confundiría con cualquier palabra.
        const tolerance = Math.min(TOLERANCE[sensitivity], Math.floor(target.length / 5));

        for (let start = 0; start < words.length; start++) {
            for (let size = Math.max(1, phraseWords - 1); size <= phraseWords + 2; size++) {
                if (start + size > words.length) break;
                const candidate = words.slice(start, start + size).join('');
                if (Math.abs(candidate.length - target.length) > tolerance) continue;
                if (levenshtein(candidate, target) <= tolerance) return phrase;
            }
        }
    }
    return null;
}