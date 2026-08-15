const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Cada cuánto revisamos si ya empezó una transmisión en vivo (cuando NO
// estamos en vivo todavía) — buscar cuesta más cuota que leer mensajes,
// así que no lo hacemos muy seguido.
const CHECK_IF_LIVE_INTERVAL_MS = 120000; // 2 minutos

interface YouTubeSearchResponse {
    items?: Array<{ id?: { videoId?: string } }>;
}

interface YouTubeVideosResponse {
    items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
}

interface YouTubeLiveChatResponse {
    items?: Array<{
        snippet?: { displayMessage?: string };
        authorDetails?: { displayName?: string };
    }>;
    nextPageToken?: string;
    pollingIntervalMillis?: number;
    offlineAt?: string; // presente cuando el chat ya terminó
}

/** Busca si el canal tiene una transmisión en vivo AHORA, y si sí, su liveChatId. */
async function findActiveLiveChatId(channelId: string, apiKey: string): Promise<string | null> {
    try {
        const searchUrl =
            `${YOUTUBE_API_BASE}/search?part=id&channelId=${channelId}` +
            `&eventType=live&type=video&key=${apiKey}`;
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) return null;

        const searchData = (await searchRes.json()) as YouTubeSearchResponse;
        const videoId = searchData.items?.[0]?.id?.videoId;
        if (!videoId) return null;

        const videosUrl = `${YOUTUBE_API_BASE}/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`;
        const videosRes = await fetch(videosUrl);
        if (!videosRes.ok) return null;

        const videosData = (await videosRes.json()) as YouTubeVideosResponse;
        return videosData.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
    } catch {
        return null;
    }
}

/**
 * Se conecta al chat en vivo de YouTube y llama a onPlayCommand cada vez
 * que alguien escribe "!play <algo>". A diferencia de Kick/Twitch, YouTube
 * no tiene conexión en tiempo real para esto — hay que ir preguntando
 * cada tanto (como indica la propia API en cada respuesta).
 */
export function startYouTubeChatListener(
    channelId: string,
    apiKey: string,
    onPlayCommand: (query: string, username: string) => void
): void {
    let liveChatId: string | null = null;
    let nextPageToken: string | undefined;

    async function waitForLiveStream(): Promise<void> {
        liveChatId = await findActiveLiveChatId(channelId, apiKey);

        if (liveChatId) {
            console.log('[YouTube] Transmisión en vivo detectada, escuchando el chat.');
            nextPageToken = undefined;
            pollMessages();
        } else {
            setTimeout(waitForLiveStream, CHECK_IF_LIVE_INTERVAL_MS);
        }
    }

    async function pollMessages(): Promise<void> {
        if (!liveChatId) return;

        try {
            const url =
                `${YOUTUBE_API_BASE}/liveChat/messages?liveChatId=${liveChatId}` +
                `&part=snippet,authorDetails&key=${apiKey}` +
                (nextPageToken ? `&pageToken=${nextPageToken}` : '');

            const res = await fetch(url);

            if (!res.ok) {
                // Puede que la transmisión haya terminado — volvemos a esperar una nueva.
                console.warn('[YouTube] El chat dejó de responder, volviendo a esperar transmisión.');
                liveChatId = null;
                setTimeout(waitForLiveStream, CHECK_IF_LIVE_INTERVAL_MS);
                return;
            }

            const data = (await res.json()) as YouTubeLiveChatResponse;

            for (const item of data.items ?? []) {
                const content = item.snippet?.displayMessage;
                const username = item.authorDetails?.displayName ?? 'alguien';
                if (!content) continue;

                const match = content.match(/^!play\s+(.+)/i);
                if (match) {
                    onPlayCommand(match[1].trim(), username);
                }
            }

            nextPageToken = data.nextPageToken;

            if (data.offlineAt) {
                // La transmisión terminó — volvemos a esperar una nueva.
                console.log('[YouTube] La transmisión terminó.');
                liveChatId = null;
                setTimeout(waitForLiveStream, CHECK_IF_LIVE_INTERVAL_MS);
                return;
            }

            const waitMs = data.pollingIntervalMillis ?? 5000;
            setTimeout(pollMessages, waitMs);
        } catch (err) {
            console.warn('[YouTube] Error consultando el chat:', (err as Error).message);
            setTimeout(pollMessages, 10000);
        }
    }

    waitForLiveStream();
}