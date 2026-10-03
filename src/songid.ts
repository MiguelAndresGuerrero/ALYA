export interface SongMatch {
    artist: string;
    title: string;
    album: string | null;
    releaseDate: string | null;
    songLink: string | null;
}

/**
 * Identifica una canción a partir de un clip de audio — del audio que
 * suena en el PC o, si por el PC no suena nada, del micrófono (ver
 * songRecognition.ts para cuándo se usa cada uno). Usa AudD, que
 * hace comparación real contra una base de huellas de audio (algo que
 * un modelo de lenguaje como Gemini no puede hacer de forma confiable).
 *
 * Devuelve null si no encontró ninguna coincidencia (no es un error,
 * simplemente no la reconoció).
 */
interface AuddResponse {
    status: 'success' | 'error';
    error?: { error_code: number; error_message: string };
    result: {
        artist: string;
        title: string;
        album?: string;
        release_date?: string;
        song_link?: string;
    } | null;
}

// Si AudD rechaza el token (vencido, sin suscripción, mal copiado), no
// tiene sentido seguir grabando y mandando clips en cada pedido: se anota
// el motivo acá y el reconocimiento por audio queda apagado hasta
// reiniciar ALYA (que es cuando se vuelve a leer el .env).
let fingerprintUnavailableReason: string | null = null;

/** null = el reconocimiento por audio funciona; si no, por qué no. */
export function getFingerprintProblem(): string | null {
    const apiToken = process.env.AUDD_API_TOKEN;
    if (!apiToken || apiToken.includes('pega_tu_key')) {
        return 'Falta configurar AUDD_API_TOKEN en el archivo .env.';
    }
    return fingerprintUnavailableReason;
}

export async function identifySong(
    audioBase64: string,
    mimeType: string
): Promise<SongMatch | null> {
    const apiToken = process.env.AUDD_API_TOKEN;
    if (!apiToken || apiToken.includes('pega_tu_key')) {
        throw new Error('Falta configurar AUDD_API_TOKEN en el archivo .env (ver .env.example).');
    }
    if (fingerprintUnavailableReason) throw new Error(fingerprintUnavailableReason);

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const extension = mimeType.includes('webm') ? 'webm' : 'audio';
    const audioBlob = new Blob([audioBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('api_token', apiToken);
    formData.append('return', 'spotify,apple_music');
    formData.append('file', audioBlob, `clip.${extension}`);

    const response = await fetch('https://api.audd.io/', {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`AudD respondió con código ${response.status}`);
    }

    const data = (await response.json()) as AuddResponse;

    if (data.status !== 'success') {
        const detail = data.error?.error_message || 'AudD devolvió un error desconocido.';
        // Códigos 900/901 de AudD, o el texto de "token inválido/inactivo".
        const isTokenProblem =
            data.error?.error_code === 900 || data.error?.error_code === 901 || /api_token|authorization failed/i.test(detail);
        if (isTokenProblem) {
            fingerprintUnavailableReason =
                'El token de AudD (AUDD_API_TOKEN) no es válido o su cuenta ya no está activa: AudD pide una ' +
                'prueba vigente o una suscripción. Hay que revisarlo en dashboard.audd.io y reiniciar ALYA.';
            console.warn(`[ALYA] Reconocimiento por audio desactivado en esta sesión. ${fingerprintUnavailableReason}`);
            throw new Error(fingerprintUnavailableReason);
        }
        throw new Error(detail);
    }

    if (!data.result) {
        return null; // no hubo coincidencia, no es un error
    }

    return {
        artist: data.result.artist,
        title: data.result.title,
        album: data.result.album ?? null,
        releaseDate: data.result.release_date ?? null,
        songLink: data.result.song_link ?? null,
    };
}