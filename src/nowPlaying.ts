import { spawn } from 'child_process';
import * as os from 'os';

// --- Qué está sonando según Windows ---
// Casi todo lo que reproduce música en el PC (Spotify, YouTube o cualquier
// otra página en Chrome/Brave/Edge/Firefox, VLC, el reproductor de
// Windows...) le avisa a Windows qué está sonando — es lo mismo que
// aparece en el panelito de volumen con el título y los botones de
// play/pausa. Leer eso es instantáneo y exacto: no hace falta "escuchar"
// nada ni gastar consultas de AudD.
//
// Lo que NO avisa a Windows (una canción en una llamada de Discord, la
// música de un juego, la música de fondo de un video) se identifica
// escuchando el audio — ver songRecognition.ts.

export type MediaAppKind = 'musica' | 'navegador' | 'otra';

export interface NowPlayingSession {
    /** Identificador crudo que da Windows (ej. "Spotify.exe", "Brave"). */
    appId: string;
    /** Nombre legible (ej. "Spotify", "Brave"). */
    appName: string;
    /** 'musica' = app dedicada a música (el título ES la canción); 'navegador' = puede ser cualquier video. */
    kind: MediaAppKind;
    playing: boolean;
    title: string;
    artist: string;
    album: string | null;
}

// El orden importa: se usa la primera regla que coincida.
const KNOWN_APPS: Array<{ pattern: RegExp; name: string; kind: MediaAppKind }> = [
    { pattern: /spotify/i, name: 'Spotify', kind: 'musica' },
    { pattern: /applemusic|itunes/i, name: 'Apple Music', kind: 'musica' },
    { pattern: /amazon.*music/i, name: 'Amazon Music', kind: 'musica' },
    { pattern: /deezer/i, name: 'Deezer', kind: 'musica' },
    { pattern: /tidal/i, name: 'TIDAL', kind: 'musica' },
    { pattern: /youtube.*music|ytmusic/i, name: 'YouTube Music', kind: 'musica' },
    { pattern: /zunemusic/i, name: 'Reproductor multimedia de Windows', kind: 'musica' },
    { pattern: /foobar|aimp|musicbee|winamp/i, name: 'Reproductor de música', kind: 'musica' },
    { pattern: /brave/i, name: 'Brave', kind: 'navegador' },
    { pattern: /msedge|microsoftedge/i, name: 'Edge', kind: 'navegador' },
    { pattern: /chrome/i, name: 'Chrome', kind: 'navegador' },
    { pattern: /firefox|308046B0AF4A39CB/i, name: 'Firefox', kind: 'navegador' },
    { pattern: /opera/i, name: 'Opera', kind: 'navegador' },
    { pattern: /vivaldi/i, name: 'Vivaldi', kind: 'navegador' },
    { pattern: /vlc/i, name: 'VLC', kind: 'otra' },
];

export function classifyApp(appId: string): { name: string; kind: MediaAppKind } {
    for (const app of KNOWN_APPS) {
        if (app.pattern.test(appId)) return { name: app.name, kind: app.kind };
    }
    // Desconocida: se limpia el identificador para que al menos sea legible
    // ("Algo.exe" -> "Algo", "Editor.Paquete_abc123!App" -> "Editor.Paquete").
    const name = appId.replace(/\.exe$/i, '').replace(/_[a-z0-9]+!.*$/i, '').trim();
    return { name: name || 'una aplicación', kind: 'otra' };
}

/**
 * Convierte la salida del script de PowerShell (un JSON con las sesiones
 * de medios) en la lista ya ordenada: primero lo que está sonando ahora.
 * Tolera basura alrededor del JSON; si no se puede leer, devuelve [].
 */
export function parseSessions(raw: string): NowPlayingSession[] {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end <= start) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const sessions: Array<NowPlayingSession & { current: boolean }> = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const title = String(entry.title ?? '').trim();
        if (!title) continue; // sin título no sirve para identificar nada

        const appId = String(entry.app ?? '');
        const { name, kind } = classifyApp(appId);
        const status = String(entry.status ?? '');
        const album = String(entry.album ?? '').trim();

        sessions.push({
            appId,
            appName: name,
            kind,
            playing: status === 'Playing' || status === '4',
            title,
            artist: String(entry.artist ?? '').trim(),
            album: album || null,
            current: entry.current === true,
        });
    }

    sessions.sort((a, b) => Number(b.playing) - Number(a.playing) || Number(b.current) - Number(a.current));
    return sessions.map(({ current: _current, ...session }) => session);
}

// Script de PowerShell: le pregunta a Windows por todas las "sesiones de
// medios" (cada app que está reproduciendo o tiene algo en pausa) y las
// imprime como JSON. Usa la misma API de Windows que el panel de volumen.
const NOW_PLAYING_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    'function Await($WinRtTask, $ResultType) {',
    '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
    '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
    '  $netTask.Wait(5000) | Out-Null',
    '  $netTask.Result',
    '}',
    '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null',
    '$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
    '$current = $manager.GetCurrentSession()',
    "$currentId = if ($current) { $current.SourceAppUserModelId } else { '' }",
    '$result = @()',
    'foreach ($session in $manager.GetSessions()) {',
    '  try {',
    '    $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
    '    $result += [PSCustomObject]@{',
    '      app = [string]$session.SourceAppUserModelId',
    '      status = [string]$session.GetPlaybackInfo().PlaybackStatus',
    '      title = [string]$props.Title',
    '      artist = [string]$props.Artist',
    '      album = [string]$props.AlbumTitle',
    '      current = ($session.SourceAppUserModelId -eq $currentId)',
    '    }',
    '  } catch { }',
    '}',
    'ConvertTo-Json -InputObject @($result) -Compress',
].join('\n');

const NOW_PLAYING_TIMEOUT_MS = 8000;

/**
 * Devuelve lo que Windows reporta como reproduciéndose (o en pausa) en
 * este momento. NUNCA rechaza: si algo falla (Windows viejo, PowerShell
 * bloqueado, etc.) devuelve una lista vacía y el reconocimiento sigue
 * por el camino de escuchar el audio.
 */
export function getNowPlaying(): Promise<NowPlayingSession[]> {
    return new Promise((resolve) => {
        if (os.platform() !== 'win32') return resolve([]);

        // -EncodedCommand (el script en base64 UTF-16) evita cualquier
        // problema de comillas al pasarle un script largo a PowerShell.
        const encoded = Buffer.from(NOW_PLAYING_SCRIPT, 'utf16le').toString('base64');
        const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (sessions: NowPlayingSession[]): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(sessions);
        };

        const timeout = setTimeout(() => {
            ps.kill();
            console.warn('[ALYA] Consultar qué está sonando en Windows tardó demasiado — se omite.');
            finish([]);
        }, NOW_PLAYING_TIMEOUT_MS);

        ps.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
        ps.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
        ps.on('error', (err) => {
            console.warn('[ALYA] No se pudo consultar qué está sonando en Windows:', err.message);
            finish([]);
        });
        ps.on('close', (code) => {
            if (code !== 0) {
                console.warn(`[ALYA] Consultar qué está sonando en Windows falló (código ${code}): ${stderr.trim().slice(0, 300)}`);
                return finish([]);
            }
            finish(parseSessions(stdout));
        });
    });
}