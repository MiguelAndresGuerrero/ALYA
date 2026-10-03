import { getNowPlaying, type NowPlayingSession } from './nowPlaying';
import { getFingerprintProblem, type SongMatch } from './songid';

// --- Reconocer la canción que está sonando, venga de donde venga ---
// Se combinan tres caminos, del más exacto y rápido al más general:
//
// 1. Lo que Windows reporta (nowPlaying.ts): Spotify, YouTube y demás
//    páginas en el navegador, reproductores... Instantáneo.
// 2. Escuchar el audio del sistema y compararlo contra una base de
//    huellas de audio (AudD): sirve para TODO lo que suene por los
//    parlantes/audífonos — Discord, juegos, la música de fondo de un
//    video, un directo.
// 3. Si por el sistema no suena nada, escuchar por el micrófono: la
//    canción viene de afuera del PC (el celular, la tele, la radio).
//
// Los pasos 2 y 3 los hace la ventana de chat (es la que puede grabar
// audio); acá solo se decide cuándo hacen falta.

export type AudioSource = 'sistema' | 'microfono';

/** Lo que devuelve la ventana de chat después de escuchar. */
export interface ListenResult {
    match: SongMatch | null;
    source: AudioSource | null;
    error?: string;
}

type AudioListener = () => Promise<ListenResult>;

let audioListener: AudioListener | null = null;

/** main.ts registra acá cómo pedirle a la ventana de chat que escuche. */
export function setAudioListener(listener: AudioListener): void {
    audioListener = listener;
}

export interface SongRecognition {
    /** Lo que Windows dice que está SONANDO ahora (sin lo que está en pausa). */
    sessions: NowPlayingSession[];
    /** Si se llegó a escuchar el audio. */
    listened: boolean;
    audioMatch: SongMatch | null;
    audioSource: AudioSource | null;
    audioError: string | null;
}

/**
 * Identifica lo que está sonando.
 *
 * - Si una app de música (Spotify y similares) está reproduciendo, su
 *   título ES la canción: se responde al instante, sin escuchar.
 * - Si lo que suena viene de un navegador u otra app, el título puede ser
 *   el de un video cualquiera, así que ADEMÁS se escucha el audio — se
 *   devuelven las dos cosas y ALYA arma la respuesta.
 * - Si Windows no reporta nada, se escucha el audio.
 *
 * forceListen = true escucha siempre (ej. "¿qué canción suena de fondo en
 * este video?", o cuando el título no era lo que el usuario buscaba).
 */
export async function recognizeSong(forceListen = false): Promise<SongRecognition> {
    const sessions = (await getNowPlaying()).filter((session) => session.playing);
    const musicAppPlaying = sessions.some((session) => session.kind === 'musica');

    const recognition: SongRecognition = {
        sessions,
        listened: false,
        audioMatch: null,
        audioSource: null,
        audioError: null,
    };

    if (musicAppPlaying && !forceListen) return recognition;

    // Sin un token de AudD que funcione no hay con qué comparar el audio:
    // grabar sería perder 8-16 segundos para nada.
    const fingerprintProblem = getFingerprintProblem();
    if (fingerprintProblem) {
        recognition.audioError = fingerprintProblem;
        return recognition;
    }

    recognition.listened = true;

    if (!audioListener) {
        recognition.audioError = 'La ventana de chat no está lista para escuchar.';
        return recognition;
    }

    try {
        const heard = await audioListener();
        recognition.audioMatch = heard.match;
        recognition.audioSource = heard.source;
        recognition.audioError = heard.error ?? null;
    } catch (err) {
        recognition.audioError = (err as Error).message;
    }

    return recognition;
}

/**
 * Pasa el resultado a un objeto simple y en español para dárselo al
 * modelo (como resultado de herramienta o dentro de un mensaje de sistema).
 */
export function describeRecognition(recognition: SongRecognition): Record<string, unknown> {
    const segunWindows = recognition.sessions.map((session) => ({
        app: session.appName,
        titulo: session.title,
        artista_o_canal: session.artist || null,
        album: session.album,
        confiable:
            session.kind === 'musica'
                ? 'sí: es una app de música, el título es la canción'
                : 'a medias: es el título de la pestaña o video, puede no ser el nombre exacto de la canción',
    }));

    const match = recognition.audioMatch;
    const porAudio = match
        ? {
            titulo: match.title,
            artista: match.artist,
            album: match.album,
            fecha_lanzamiento: match.releaseDate,
            link: match.songLink,
        }
        : null;

    const escuchadoDesde =
        recognition.audioSource === 'sistema'
            ? 'el audio que suena en el PC'
            : recognition.audioSource === 'microfono'
                ? 'el micrófono (por el PC no sonaba nada)'
                : null;

    const encontrado = segunWindows.length > 0 || porAudio !== null;

    return {
        ok: encontrado,
        sonando_segun_windows: segunWindows,
        identificada_por_audio: porAudio,
        se_escucho_el_audio: recognition.listened,
        escuchado_desde: escuchadoDesde,
        problema_al_escuchar: recognition.audioError,
        ...(encontrado
            ? {}
            : {
                error: recognition.listened
                    ? 'No se pudo identificar: Windows no reporta nada sonando y la huella de audio no encontró coincidencia.'
                    : 'No se pudo identificar: Windows no reporta nada sonando y el reconocimiento por audio no está disponible.',
            }),
    };
}