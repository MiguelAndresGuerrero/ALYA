import * as dotenv from 'dotenv';
import { app, Tray, Menu, BrowserWindow, ipcMain, Notification, nativeImage, session, globalShortcut, desktopCapturer, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// El .env vive en lugares distintos según el modo:
// - En desarrollo (npm start): en la raíz del proyecto, junto al código.
// - Ya instalada (.exe): NUNCA dentro del instalador (ahí no se meten
//   secretos personales) — vive en la carpeta de datos de la app, la
//   misma donde ya guardamos memoria/rutinas/etc. Hay que crearlo ahí
//   a mano una vez después de instalar (ver README).
const envPath = app.isPackaged
  ? path.join(app.getPath('userData'), '.env')
  : path.join(__dirname, '..', '.env');

dotenv.config({ path: envPath }); // Carga el .env ANTES de cualquier otra cosa

/**
 * Agrega o actualiza variables puntuales en el .env SIN pisar las demás
 * que ya estén ahí (a diferencia del guardado del setup inicial, que
 * sobreescribe todo el archivo porque en ese momento solo existe
 * GEMINI_API_KEY). Se usa para guardar credenciales desde el panel de
 * Configuración una vez que ALYA ya está en uso, con más variables
 * conviviendo en el mismo archivo.
 */
function upsertEnvVars(updates: Record<string, string>): void {
  let existingLines: string[] = [];
  try {
    existingLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch {
    existingLines = [];
  }

  const pending = new Map(Object.entries(updates));

  const merged = existingLines.map((line) => {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) return line;
    const key = line.slice(0, eqIndex).trim();
    if (pending.has(key)) {
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  for (const [key, value] of pending) {
    merged.push(`${key}=${value}`);
  }

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, merged.join('\n') + '\n', 'utf8');

  // Para que apliquen YA en esta misma sesión, sin reiniciar ALYA.
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

/**
 * ¿Ya hay una key de Gemini configurada? Si no, mostramos la pantalla de
 * bienvenida antes de arrancar lo demás — evita que alguien instale
 * ALYA y no sepa por qué "no piensa" hasta leer el README.
 */
function hasGeminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 0 && !key.includes('tu_key'));
}

/**
 * Muestra la pantalla de bienvenida SOLO si todavía no hay una key de
 * Gemini configurada. Se resuelve (deja seguir con el arranque normal)
 * apenas la persona guarda una key o decide saltarlo — nunca bloquea
 * arranques futuros una vez que ya hay una key guardada.
 */
function showFirstRunSetupIfNeeded(): Promise<void> {
  if (hasGeminiKey()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const setupWindow = new BrowserWindow({
      width: 460,
      height: 620,
      resizable: false,
      title: 'ALYA — Bienvenida',
      icon: getResourcePath('build', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'setupPreload.js'),
        contextIsolation: true,
      },
    });

    setupWindow.setMenu(null);
    setupWindow.loadFile(path.join(__dirname, 'setup.html'));

    function finish(): void {
      if (!setupWindow.isDestroyed()) setupWindow.close();
      resolve();
    }

    ipcMain.handleOnce('setup:saveApiKey', async (_event, apiKey: string) => {
      fs.mkdirSync(path.dirname(envPath), { recursive: true });
      fs.writeFileSync(envPath, `GEMINI_API_KEY=${apiKey}\n`, 'utf8');
      process.env.GEMINI_API_KEY = apiKey; // para que aplique YA en esta misma sesión
      finish();
    });

    ipcMain.handleOnce('setup:skip', async () => {
      finish();
    });

    ipcMain.handleOnce('setup:openLink', async (_event, url: string) => {
      shell.openExternal(url);
    });

    // Si cierran la ventana con la X sin guardar ni saltar explícitamente,
    // igual dejamos que ALYA arranque — no la dejamos encerrada ahí.
    setupWindow.on('closed', () => resolve());
  });
}

import AutoLaunch from 'auto-launch';

import { getStatus, getTopProcesses, getNetworkLatency } from './systemTools';
import { speak, startVoiceServer, stopVoiceServer } from './voice';
import { sendMessage, resetChat, confirmPendingAction, cancelPendingAction, transcribeAudio } from './ai';
import { identifySong } from './songid';
import { startReminderScheduler } from './reminders';
import { loadSettings, saveSettings, type AlyaSettings } from './settingsStore';
import { startKickChatListener } from './kickChat';
import { startTwitchChatListener } from './twitchChat';
import { startYouTubeChatListener } from './youtubeChat';
import { queueOrPlaySong, initializePlayerSession } from './webBrowser';
import { startOverlayServer } from './obsOverlay';
import { loadProjects, type Project } from './projectsStore';
import { getResourcePath } from './resourcePaths';
import { startSpotifyAuth, isSpotifyConnected } from './spotify';
import { autoUpdater } from 'electron-updater';
import type { SystemStatus, ChatMessage } from './types';

// Cambia esto por tu nombre
// El nombre ya no es una constante fija — se lee de la configuración
// guardada (panel de Configuración), con "Andrés" como valor por defecto.

let tray: Tray | null = null;
let statusWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let statusUpdateInterval: NodeJS.Timeout | null = null;

const STATUS_UPDATE_INTERVAL_MS = 3000;

function startStatusPolling(): void {
  if (statusUpdateInterval) return; // ya está corriendo

  const pushUpdate = async () => {
    if (!statusWindow || !statusWindow.isVisible()) return;
    const status = await getStatus(); // ahora siempre barato (sin procesos)
    statusWindow.webContents.send('alya:status-update', status);
  };

  pushUpdate(); // primera actualización inmediata
  statusUpdateInterval = setInterval(pushUpdate, STATUS_UPDATE_INTERVAL_MS);
}

function stopStatusPolling(): void {
  if (statusUpdateInterval) {
    clearInterval(statusUpdateInterval);
    statusUpdateInterval = null;
  }
}

// --- Auto-arranque con Windows ---
const alyaAutoLaunch = new AutoLaunch({
  name: 'ALYA',
  path: app.getPath('exe'),
});

async function ensureAutoLaunch(): Promise<void> {
  const enabled = await alyaAutoLaunch.isEnabled();
  if (!enabled) {
    await alyaAutoLaunch.enable();
  }
}

// Cada cuánto revisa si hay una versión nueva mientras sigue abierta
// (además de la revisión que ya hace apenas arranca).
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas

/**
 * Auto-actualización: revisa GitHub Releases (donde `npm run publish`
 * sube cada versión nueva), descarga en segundo plano si hay algo más
 * reciente, y muestra una ventana preguntando si instalarla ahora — solo
 * UNA vez por versión (no vuelve a molestar con la misma actualización
 * aunque se cierre sin instalarla; sí se instala sola al próximo
 * reinicio de todas formas).
 */
let ultimaVersionAvisada: string | null = null;

function setupAutoUpdater(): void {
  autoUpdater.logger = console;

  autoUpdater.on('update-available', (info) => {
    console.log(`[ALYA] Nueva versión disponible: ${info.version} — descargando en segundo plano...`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[ALYA] Ya tienes la última versión.');
  });

  autoUpdater.on('error', (err) => {
    console.warn('[ALYA] Error revisando actualizaciones:', err.message);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[ALYA] Descargando actualización: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    console.log(`[ALYA] Actualización ${info.version} lista.`);

    // Ya avisamos de ESTA versión antes (ej. otra revisión periódica
    // volvió a disparar el evento) — no repetimos la ventana.
    if (ultimaVersionAvisada === info.version) return;
    ultimaVersionAvisada = info.version;

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'ALYA — Actualización disponible',
      message: `Hay una nueva versión de ALYA (${info.version}) lista para instalar.`,
      detail: 'Se cerrará y volverá a abrir sola en unos segundos.',
      buttons: ['Instalar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
    // Si elige "Más tarde", no volvemos a preguntar por ESTA versión —
    // igual se instala sola la próxima vez que cierre ALYA por su cuenta.
  });

  autoUpdater.checkForUpdates();
  setInterval(() => autoUpdater.checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
}

// --- Ventana de estado (se abre al hacer click en el ícono) ---
function createStatusWindow(): void {
  statusWindow = new BrowserWindow({
    width: 380,
    height: 480,
    show: false,
    resizable: false,
    frame: true,
    title: 'ALYA',
    icon: getResourcePath('build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  statusWindow.loadFile(path.join(__dirname, 'status.html'));

  // Solo consultamos CPU/RAM/procesos mientras la ventana está VISIBLE.
  // Antes esto corría cada 3s sin parar aunque la ventana estuviera oculta
  // — eso era un consumo de CPU innecesario todo el tiempo que ALYA
  // estuviera abierta, aunque no estuvieras mirando el panel.
  statusWindow.on('show', startStatusPolling);
  statusWindow.on('hide', stopStatusPolling);

  statusWindow.on('close', (e) => {
    // No cerrar de verdad: solo ocultar, para que ALYA siga viva en el tray
    e.preventDefault();
    statusWindow?.hide();
  });
}

function toggleStatusWindow(): void {
  if (!statusWindow) createStatusWindow();
  if (!statusWindow) return;

  if (statusWindow.isVisible()) {
    statusWindow.hide();
  } else {
    statusWindow.show();
    statusWindow.focus();
  }
}

// --- Ventana de chat (el "cerebro" de ALYA) ---
function createChatWindow(): void {
  chatWindow = new BrowserWindow({
    width: 420,
    height: 620,
    show: false,
    resizable: true,
    frame: true,
    title: 'ALYA',
    icon: getResourcePath('build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  chatWindow.loadFile(path.join(__dirname, 'chat.html'));

  chatWindow.on('close', (e) => {
    e.preventDefault();
    chatWindow?.hide();
  });
}

function toggleChatWindow(): void {
  if (!chatWindow) createChatWindow();
  if (!chatWindow) return;

  if (chatWindow.isVisible()) {
    chatWindow.hide();
  } else {
    chatWindow.show();
    chatWindow.focus();
  }
}

// --- Atajo de teclado global: abre ALYA y arranca a grabar, desde
// cualquier lugar de Windows, sin tener que hacer click en nada. ---
function triggerVoiceCapture(): void {
  if (!chatWindow) {
    createChatWindow();
    chatWindow!.webContents.once('did-finish-load', () => {
      chatWindow?.show();
      chatWindow?.focus();
      chatWindow?.webContents.send('alya:trigger-voice');
    });
  } else {
    chatWindow.show();
    chatWindow.focus();
    chatWindow.webContents.send('alya:trigger-voice');
  }
}

// --- Ventana de configuración ---
function createSettingsWindow(): void {
  settingsWindow = new BrowserWindow({
    width: 380,
    height: 500,
    show: false,
    resizable: false,
    frame: true,
    title: 'ALYA — Configuración',
    icon: getResourcePath('build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('close', (e) => {
    e.preventDefault();
    settingsWindow?.hide();
  });
}

function toggleSettingsWindow(): void {
  if (!settingsWindow) createSettingsWindow();
  if (!settingsWindow) return;

  if (settingsWindow.isVisible()) {
    settingsWindow.hide();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

// --- Tray (ícono en la barra de tareas) ---
function createTray(): void {
  const iconPath = getResourcePath('build', 'icon.ico');
  let image = nativeImage.createFromPath(iconPath);

  // Si el ícono falta o está corrupto, usar uno vacío en vez de tronar la app
  if (image.isEmpty()) {
    console.warn(`No se pudo cargar el ícono en ${iconPath}, usando ícono vacío temporal.`);
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  tray.setToolTip('ALYA');

  const menu = Menu.buildFromTemplate([
    { label: 'Hablar con ALYA', click: toggleChatWindow },
    { label: 'Ver estado del sistema', click: toggleStatusWindow },
    { label: 'Configuración', click: toggleSettingsWindow },
    { type: 'separator' },
    { label: 'Salir', click: () => app.exit(0) },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', toggleChatWindow);
}

function greet(): void {
  const hour = new Date().getHours();
  let saludo = 'Buenas noches';
  if (hour >= 5 && hour < 12) saludo = 'Buenos días';
  else if (hour >= 12 && hour < 20) saludo = 'Buenas tardes';

  const mensaje = `${saludo}, ${loadSettings().userName}. ALYA está en línea.`;

  new Notification({ title: 'ALYA', body: mensaje }).show();
  speak(mensaje);
}

// --- Evitar que ALYA se abra dos veces a la vez ---
// Si ya hay una instancia corriendo y intentas abrir otra (ej. corriste
// "npm start" de nuevo sin cerrar la anterior), la nueva se cierra sola
// en vez de crear un duplicado con su propio ícono, su propio saludo,
// y su propio proceso de audio compitiendo por el mismo dispositivo.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Alguien intentó abrir otra copia: en vez de ignorarlo, mostramos
    // la ventana de estado de la instancia que ya existía.
    if (statusWindow) {
      statusWindow.show();
      statusWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Primera vez que se abre ALYA sin una key de Gemini configurada:
    // mostramos la pantalla de bienvenida y esperamos a que termine
    // antes de seguir con el resto del arranque normal.
    await showFirstRunSetupIfNeeded();

    createTray();
    await ensureAutoLaunch();
    startVoiceServer(); // arranca el proceso de voz persistente antes del saludo
    greet();

    // Auto-actualización: solo tiene sentido en la versión INSTALADA
    // (.exe) — en modo desarrollo (npm start) no hay nada que descargar,
    // y electron-updater ni siquiera funciona ahí.
    if (app.isPackaged) {
      setupAutoUpdater();
    }

    // Bloqueo de anuncios + extensiones sideloaded para la ventana de
    // música — se prepara ANTES de que exista cualquier ventana, para
    // que ya esté todo listo desde el primer video, no solo el segundo.
    await initializePlayerSession();

    // Overlay para OBS: un servidor local mostrando "Sonando ahora: X".
    // Pega esta URL en una Fuente de navegador de OBS.
    const overlayPort = startOverlayServer();
    console.log(`[ALYA] Overlay de OBS disponible en: http://localhost:${overlayPort}/`);

    // Recordatorios: si algo quedó pendiente de cuando la app estaba
    // cerrada (ej. "avísame en 10 minutos" y cerraste antes), suena en
    // cuanto vuelve a abrir. Siempre avisa por notificación + voz, sin
    // importar el estado de silencio del chat (es un aviso importante).
    startReminderScheduler((reminder) => {
      new Notification({ title: 'ALYA — Recordatorio', body: reminder.mensaje }).show();
      speak(reminder.mensaje);
    });

    // Reacción a "!play <canción>" en el chat en vivo — misma lógica sin
    // importar de qué plataforma venga. Ya no hay fila real (YouTube abre
    // en el navegador real, fuera del control de ALYA) — cada pedido
    // simplemente abre su propia pestaña.
    async function handlePlayCommand(query: string, username: string, plataforma: string): Promise<void> {
      console.log(`[${plataforma}] ${username} pidió: ${query}`);
      try {
        await queueOrPlaySong(query);
        speak(`Abriendo "${query}", pedida por ${username}.`);
      } catch {
        speak(`No logré encontrar "${query}", pedida por ${username}.`);
      }
    }

    // Kick: solo necesita el chatroom_id (número público de tu canal).
    const kickChatroomId = process.env.KICK_CHATROOM_ID;
    if (kickChatroomId) {
      startKickChatListener(kickChatroomId, (query, username) =>
        handlePlayCommand(query, username, 'Kick')
      );
    }

    // Twitch: solo necesita tu nombre de canal — lectura anónima, sin cuenta ni token.
    const twitchChannel = process.env.TWITCH_CHANNEL;
    if (twitchChannel) {
      startTwitchChatListener(twitchChannel, (query, username) =>
        handlePlayCommand(query, username, 'Twitch')
      );
    }

    // YouTube: necesita tu channel_id y una API key de Google Cloud (gratis).
    const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID;
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (youtubeChannelId && youtubeApiKey) {
      startYouTubeChatListener(youtubeChannelId, youtubeApiKey, (query, username) =>
        handlePlayCommand(query, username, 'YouTube')
      );
    }

    // Autorizar micrófono Y captura de pantalla/audio del sistema. Sin
    // esto, Electron bloquea getUserMedia/getDisplayMedia en silencio
    // (sin error visible) por defecto.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media' || permission === 'display-capture');
    });

    // Captura de audio DEL SISTEMA (lo que suena en la PC, no el
    // micrófono) — para identificar canciones de forma confiable, sin
    // depender de que el micrófono capte el sonido rebotando en el aire.
    // Soporte nativo de Electron en Windows, sin paquetes externos.
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      });
    });

    // Atajo global: funciona desde cualquier parte de Windows, no hace
    // falta tener ALYA abierta ni enfocada.
    const VOICE_SHORTCUT = 'CommandOrControl+Shift+1';
    const registered = globalShortcut.register(VOICE_SHORTCUT, triggerVoiceCapture);
    if (!registered) {
      console.warn(
        `No se pudo registrar el atajo ${VOICE_SHORTCUT} — probablemente otro programa ya lo está usando.`
      );
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('before-quit', () => {
    stopVoiceServer();
  });
}

// IPC: la ventana de estado pide datos del sistema
ipcMain.handle('alya:getStatus', async (): Promise<SystemStatus> => {
  return getStatus();
});

// Procesos con más consumo: consulta CARA, solo bajo demanda (botón en el
// panel), nunca automática. Seguro simple para que un doble-click no
// dispare dos consultas pesadas al mismo tiempo.
let isFetchingProcesses = false;
ipcMain.handle('alya:getTopProcesses', async () => {
  if (isFetchingProcesses) return null; // ya hay una en camino, ignorar
  isFetchingProcesses = true;
  try {
    return await getTopProcesses();
  } finally {
    isFetchingProcesses = false;
  }
});

// Latencia de red: también bajo demanda (tarda ~1s por el ping real).
let isFetchingLatency = false;
ipcMain.handle('alya:getNetworkLatency', async (): Promise<number | null> => {
  if (isFetchingLatency) return null;
  isFetchingLatency = true;
  try {
    return await getNetworkLatency();
  } finally {
    isFetchingLatency = false;
  }
});

// Proyectos: barato (solo lee un archivo local), se puede pedir seguido.
ipcMain.handle('alya:getProjects', async (): Promise<Project[]> => {
  return loadProjects();
});

// Chat con ALYA (el cerebro, vía Gemini)
let isMuted = false;

ipcMain.handle('alya:chat', async (_event, userMessage: string): Promise<ChatMessage> => {
  try {
    const reply = await sendMessage(userMessage);
    if (reply.text && !isMuted) speak(reply.text); // ALYA lee su respuesta en voz alta
    return reply;
  } catch (err) {
    const errorText = `Tuve un problema para responder: ${(err as Error).message}`;
    if (!isMuted) speak('Tuve un problema para responder.'); // versión corta, no lee el error técnico
    return { role: 'assistant', text: errorText };
  }
});

ipcMain.handle('alya:toggleMute', async (): Promise<boolean> => {
  isMuted = !isMuted;
  return isMuted;
});

// Ruta del avatar: las ventanas no pueden calcular esto solas de forma
// confiable (no tienen acceso a "app"), así que main.ts se las resuelve.
ipcMain.handle('alya:getAvatarUrl', async (): Promise<string> => {
  const avatarPath = getResourcePath('build', 'avatar.png');
  return `file://${avatarPath.replace(/\\/g, '/')}`;
});

// Configuración: obtener/guardar. Al guardar, reiniciamos la conversación
// para que el nuevo nombre/personalidad se aplique de inmediato, sin
// tener que cerrar y volver a abrir toda la app.
ipcMain.handle('alya:getSettings', async (): Promise<AlyaSettings> => {
  return loadSettings();
});

ipcMain.handle('alya:saveSettings', async (_event, settings: AlyaSettings): Promise<void> => {
  saveSettings(settings);
  resetChat();
});

// Credenciales de Spotify: se guardan en el .env (no en configuracion.json,
// porque spotify.ts las lee de process.env, igual que el resto de keys) y
// aplican de inmediato sin reiniciar ALYA. Después de guardarlas, arranca
// el login de Spotify de una vez para no obligar a pedírselo por chat.
ipcMain.handle(
  'alya:saveSpotifyCredentials',
  async (_event, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> => {
    const id = clientId.trim();
    const secret = clientSecret.trim();

    if (!id || !secret) {
      return { ok: false, error: 'Faltan el Client ID o el Client Secret.' };
    }

    upsertEnvVars({ SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret });

    try {
      await startSpotifyAuth();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
);

ipcMain.handle('alya:getSpotifyStatus', async (): Promise<{ hasCredentials: boolean; connected: boolean }> => {
  const hasCredentials = Boolean(
    process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim()
  );
  return { hasCredentials, connected: isSpotifyConnected() };
});

// Para abrir links externos (ej. el dashboard de Spotify) desde ventanas
// que no son la de bienvenida — esa ya tenía su propio setup:openLink.
ipcMain.handle('alya:openLink', async (_event, url: string): Promise<void> => {
  shell.openExternal(url);
});

// Confirmación de acciones sensibles (ej. cerrar una app)
ipcMain.handle('alya:confirmAction', async (): Promise<ChatMessage> => {
  const reply = await confirmPendingAction();
  if (reply.text && !isMuted) speak(reply.text);
  return reply;
});

ipcMain.handle('alya:cancelAction', async (): Promise<ChatMessage> => {
  const reply = cancelPendingAction();
  if (reply.text && !isMuted) speak(reply.text);
  return reply;
});

// Mensaje por voz: transcribe el audio grabado y lo procesa como si lo
// hubieras escrito (reutiliza toda la lógica de herramientas/confirmación).
ipcMain.handle(
  'alya:sendVoiceMessage',
  async (_event, audioBase64: string, mimeType: string): Promise<{ transcript: string; reply: ChatMessage }> => {
    const transcript = await transcribeAudio(audioBase64, mimeType);

    if (!transcript || transcript === '[silencio]') {
      return {
        transcript: '',
        reply: { role: 'assistant', text: 'No alcancé a escuchar nada, ¿puedes repetirlo?' },
      };
    }

    const reply = await sendMessage(transcript);
    if (reply.text && !isMuted) speak(reply.text);
    return { transcript, reply };
  }
);

// Identificar canción (tipo Shazam): graba un clip, lo manda a AudD, y le
// pasamos el resultado a ALYA para que lo cuente de forma natural.
ipcMain.handle(
  'alya:identifySong',
  async (_event, audioBase64: string, mimeType: string): Promise<ChatMessage> => {
    try {
      const match = await identifySong(audioBase64, mimeType);
      const userName = loadSettings().userName;

      const prompt = match
        ? `(Sistema: identifiqué esta canción con una herramienta externa: "${match.title}" de ` +
        `${match.artist}${match.album ? `, del álbum "${match.album}"` : ''}${match.releaseDate ? ` (${match.releaseDate})` : ''}. ` +
        `Cuéntaselo a ${userName} de forma breve y natural.)`
        : '(Sistema: intenté identificar la canción que está sonando pero no encontré ' +
        `ninguna coincidencia. Avísale a ${userName} brevemente, sin inventar un resultado.)`;

      const reply = await sendMessage(prompt);
      if (reply.text && !isMuted) speak(reply.text);
      return reply;
    } catch (err) {
      const errorText = `No pude identificar la canción: ${(err as Error).message}`;
      if (!isMuted) speak('No pude identificar la canción.');
      return { role: 'assistant', text: errorText };
    }
  }
);

ipcMain.handle('alya:resetChat', async (): Promise<void> => {
  resetChat();
});

// Mantener viva la app aunque se cierren todas las ventanas (vive en el tray)
app.on('window-all-closed', () => {
  // No hacemos nada: en Electron, no llamar a app.quit() aquí ya evita
  // que la app se cierre. ALYA sigue viva en el tray.
});