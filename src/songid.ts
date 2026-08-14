export interface SongMatch {
    artist: string;
    title: string;
    album: string | null;
    releaseDate: string | null;
    songLink: string | null;
}

/**
 * Identifica una canción a partir de un clip de audio (grabado del
 * micrófono, escuchando el ambiente — igual que Shazam). Usa AudD, que
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

export async function identifySong(
    audioBase64: string,
    mimeType: string
): Promise<SongMatch | null> {
    const apiToken = process.env.AUDD_API_TOKEN;
    if (!apiToken || apiToken.includes('pega_tu_key')) {
        throw new Error('Falta configurar AUDD_API_TOKEN en el archivo .env (ver .env.example).');
    }

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
        throw new Error(data.error?.error_message || 'AudD devolvió un error desconocido.');
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