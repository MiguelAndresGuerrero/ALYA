import WebSocket from 'ws';

// --- Detalles de conexión no oficiales de Kick ---
// Esto NO es una API pública documentada — es la misma conexión Pusher
// que usa la propia web de Kick para mostrar el chat. Puede romperse si
// Kick cambia esto. Si deja de funcionar: en kick.com, abre las
// Herramientas de desarrollador (F12) → pestaña Red/Network → filtra por
// "pusher" → recarga la página → copia la URL nueva de la conexión
// WebSocket y reemplázala aquí abajo.
const KICK_PUSHER_URL =
    'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

const RECONNECT_DELAY_MS = 3000;

interface KickChatMessage {
    username: string;
    content: string;
}

/**
 * Intenta sacar el texto y el usuario del mensaje sin importar cuál de
 * las variantes de formato use Kick en este momento (esto ha cambiado
 * con el tiempo según varias fuentes, así que probamos varias formas).
 */
function parseKickMessage(rawData: string): KickChatMessage | null {
    try {
        const data = JSON.parse(rawData);

        const content: string | undefined = data.content ?? data.message?.message;
        const username: string | undefined = data.sender?.username ?? data.user?.username;

        if (!content || !username) return null;
        return { username, content };
    } catch {
        return null;
    }
}

/**
 * Se conecta al chat en vivo de Kick (solo lectura, sin necesidad de
 * cuenta ni token) y llama a onPlayCommand cada vez que alguien escribe
 * "/play <algo>" en el chat.
 */
export function startKickChatListener(
    chatroomId: string,
    onPlayCommand: (query: string, username: string) => void
): void {
    function connect(): void {
        const ws = new WebSocket(KICK_PUSHER_URL);

        ws.on('open', () => {
            console.log('[Kick] Conectado al chat en vivo.');
            ws.send(
                JSON.stringify({
                    event: 'pusher:subscribe',
                    data: { auth: '', channel: `chatrooms.${chatroomId}.v2` },
                })
            );
        });

        ws.on('message', (raw: Buffer) => {
            let outer: { event?: string; data?: string };
            try {
                outer = JSON.parse(raw.toString());
            } catch {
                return;
            }

            // Kick reenvía eventos de Laravel tal cual, con el nombre completo
            // de la clase — el nombre exacto ha variado según la fuente
            // consultada, así que aceptamos ambas variantes conocidas.
            const isChatEvent =
                outer.event === 'App\\Events\\ChatMessageEvent' ||
                outer.event === 'App\\Events\\ChatMessageSentEvent';

            if (!isChatEvent || !outer.data) return;

            const parsed = parseKickMessage(outer.data);
            if (!parsed) return;

            const match = parsed.content.match(/^\/play\s+(.+)/i);
            if (match) {
                onPlayCommand(match[1].trim(), parsed.username);
            }
        });

        ws.on('error', (err) => {
            console.warn('[Kick] Error de conexión:', err.message);
        });

        ws.on('close', () => {
            console.warn(`[Kick] Desconectado, reintentando en ${RECONNECT_DELAY_MS / 1000}s...`);
            setTimeout(connect, RECONNECT_DELAY_MS);
        });
    }

    connect();
}