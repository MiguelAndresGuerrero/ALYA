// --- Cuánto "piensa" ALYA antes de responder ---
// Pensar más da mejores respuestas en preguntas difíciles, pero tarda
// más. Para un asistente de voz eso importa: "pon música" tiene que ser
// instantáneo, y "¿por qué falla este código?" merece que lo piense bien.
// Acá se decide, mensaje por mensaje, qué tanto razonamiento pedirle al
// modelo.

/** Modo elegido en Configuración. */
export type ThinkingMode = 'auto' | 'rapido' | 'profundo';

/** Profundidad de razonamiento para UN mensaje (de menos a más). */
export type ThinkingDepth = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

// Pedidos que piden razonar a fondo, dicho explícitamente o por el tipo de tarea.
const DEEP_PATTERN =
    /(pi[eé]nsalo|piensa (bien|con calma|a fondo)|razona|anal[ií]za|a fondo|paso a paso|con cuidado|detalladamente|en detalle|estrategia|planifica|plan[eé]a|arquitectura|optimiza|demuestra|depura|debug|refactor|pros y contras|eval[uú]a)/;

// Preguntas que necesitan pensar algo: explicar, comparar, decidir, resolver.
const REASONING_PATTERN =
    /(por qu[eé]|c[oó]mo (puedo|hago|funciona|se hace|lo hago|deber[ií]a)|expl[ií]ca|compara|diferencia|qu[eé] opinas|qu[eé] (me )?recomiendas|recomi[eé]ndame|me conviene|deber[ií]a|mejor (opci[oó]n|forma|manera)|ventajas|desventajas|calcula|cu[aá]nto (es|ser[ií]a|cuesta|tarda)|resume|traduce|c[oó]digo|error|bug|falla|no (me )?funciona|problema|soluciona|arregla|script|funci[oó]n|ay[uú]dame a|idea|plan\b)/;

// Órdenes directas y saludos: no hay nada que pensar, que salga rápido.
const SIMPLE_PATTERN =
    /^(abre|abrir|cierra|cerrar|pon|ponme|reproduce|pausa|para|sigue|contin[uú]a|siguiente|anterior|sube|baja|silencia|mutea|busca|hola|buenas|buenos|gracias|ok|okay|vale|listo|dale|s[ií]|no|adi[oó]s|chao)\b/;

/**
 * Decide la profundidad de razonamiento para un mensaje. Devuelve
 * undefined cuando no hay que pedir nada especial (el modelo usa su
 * nivel por defecto, el más rápido).
 */
export function pickThinkingDepth(
    message: string,
    hasImages: boolean,
    mode: ThinkingMode = 'auto'
): ThinkingDepth | undefined {
    if (mode === 'rapido') return undefined;
    if (mode === 'profundo') return 'HIGH';

    const text = message.toLowerCase().trim();

    // Mensajes internos (ej. "cuéntale qué canción es"): no son preguntas reales.
    if (text.startsWith('(sistema:')) return undefined;

    if (DEEP_PATTERN.test(text) || text.length > 600) return 'HIGH';
    if (REASONING_PATTERN.test(text) || text.length > 220 || hasImages) return 'MEDIUM';
    if (SIMPLE_PATTERN.test(text) && text.length < 80) return 'MINIMAL';
    return 'LOW';
}