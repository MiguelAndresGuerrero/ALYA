import WebSocket from 'ws';

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const RECONNECT_DELAY_MS = 3000;

/**
 * Se conecta al chat en vivo de Twitch en modo lectura anónima (sin
 * cuenta ni token — Twitch lo soporta oficialmente para bots de solo
 * lectura, usando un nick tipo "justinfan12345"). Llama a onPlayCommand
 * cada vez que alguien escribe "!play <algo>" en el chat.
 */
export function startTwitchChatListener(
    channelName: string,
    onPlayCommand: (query: string, username: string) => void
): void {
    const channel = channelName.toLowerCase().replace(/^#/, '');
    const anonNick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`;

    function connect(): void {
        const ws = new WebSocket(TWITCH_IRC_URL);

        ws.on('open', () => {
            console.log('[Twitch] Conectado al chat en vivo.');
            ws.send(`NICK ${anonNick}`);
            ws.send(`JOIN #${channel}`);
        });

        ws.on('message', (raw: Buffer) => {
            const lines = raw.toString().split('\r\n').filter(Boolean);

            for (const line of lines) {
                // Twitch manda PING de vez en cuando — hay que contestar PONG o te desconecta.
                if (line.startsWith('PING')) {
                    ws.send('PONG :tmi.twitch.tv');
                    continue;
                }

                // Formato típico: :usuario!usuario@usuario.tmi.twitch.tv PRIVMSG #canal :el mensaje
                const match = line.match(/^:(\w+)!.*PRIVMSG #\w+ :(.+)$/);
                if (!match) continue;

                const [, username, content] = match;
                const playMatch = content.match(/^!play\s+(.+)/i);
                if (playMatch) {
                    onPlayCommand(playMatch[1].trim(), username);
                }
            }
        });

        ws.on('error', (err) => {
            console.warn('[Twitch] Error de conexión:', err.message);
        });

        ws.on('close', () => {
            console.warn(`[Twitch] Desconectado, reintentando en ${RECONNECT_DELAY_MS / 1000}s...`);
            setTimeout(connect, RECONNECT_DELAY_MS);
        });
    }

    connect();
}