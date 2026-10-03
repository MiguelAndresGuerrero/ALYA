import * as dotenv from 'dotenv';
import { app, Tray, Menu, BrowserWindow, ipcMain, Notification, nativeImage, session, globalShortcut, desktopCapturer, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';

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

// Con qué nombre se presenta ALYA ante Windows. Sin esto, las
// notificaciones salen firmadas como "electron.app.Electron".
// - Instalada: tiene que ser el mismo "appId" de package.json, que es el
//   que el instalador le pone al acceso directo del Menú Inicio — así
//   Windows muestra el nombre "ALYA" con su icono.
// - En desarrollo (npm start) no hay acceso directo registrado, y Windows
//   muestra este texto tal cual: por eso se usa directamente "ALYA".
const APP_USER_MODEL_ID = app.isPackaged ? 'com.andres.alya' : 'ALYA';

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Lo mismo para la barra de tareas: al hacer click derecho sobre el botón
// de ALYA, Windows muestra el nombre y el icono del PROGRAMA que abrió la
// ventana — y con "npm start" ese programa es electron.exe, así que salía
// "Electron" con su logo. Acá se le dice a Windows, ventana por ventana,
// qué nombre e icono mostrar y cómo volver a abrir ALYA (lo que usa
// "Anclar a la barra de tareas").
// Se aplica a TODA ventana que se cree (chat, estado, configuración,
// Spotify...), sin tener que acordarse en cada una.
app.on('browser-window-created', (_event, window) => {
  if (process.platform !== 'win32') return;
  try {
    window.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: getResourcePath('build', 'icon.ico'),
      appIconIndex: 0,
      // Instalada, ALYA es su propio .exe. En desarrollo hay que decirle a
      // electron.exe qué proyecto abrir.
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'ALYA',
    });
  } catch (err) {
    console.warn('[ALYA] No se pudo ajustar el nombre en la barra de tareas:', (err as Error).message);
  }
});

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
import {
  speak,
  startVoiceServer,
  stopVoiceServer,
  setSpeakingListener,
  setPlaybackListener,
  waitUntilQuiet,
  isMuted,
  setMuted,
  stopSpeaking,
  createSpeechStream,
} from './voice';
import {
  sendMessage,
  type ReplyStreamHandlers,
  resetChat,
  restoreChat,
  confirmPendingAction,
  cancelPendingAction,
  transcribeAudio,
  setSettingsOpener,
  getEngineInfo,
} from './ai';
import { identifySong, type SongMatch } from './songid';
import { recognizeSong, describeRecognition, setAudioListener, type ListenResult } from './songRecognition';
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
import {
  listConversations,
  getConversation,
  appendMessages,
  deleteConversation,
  setFavorite,
  type Conversation,
  type ConversationSummary,
  type StoredMessage,
} from './conversationsStore';
import { buildCard } from './cards';
import { getGuide, type Guide } from './guides';
import { DEVELOPER, TAGLINE, LINKS, CHANGELOG, PRIVACY, LICENSES, modelLabel } from './aboutInfo';
import { getFingerprintProblem } from './songid';
import * as os from 'os';
import type { SystemStatus, ChatMessage, ChatImage } from './types';

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
    width: 980,
    height: 680,
    minWidth: 440,
    minHeight: 560,
    show: false,
    resizable: true,
    frame: true,
    title: 'ALYA',
    backgroundColor: '#070B12', // mismo fondo que la interfaz: sin destello blanco al abrir
    icon: getResourcePath('build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  chatWindow.loadFile(path.join(__dirname, 'chat.html'));

  // Sin el menú de Electron ya no hay atajo para las herramientas de
  // desarrollo; en modo desarrollo (npm start) se abren con F12.
  if (!app.isPackaged) {
    chatWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') chatWindow?.webContents.toggleDevTools();
    });
  }

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

// Para escuchar una canción hace falta la ventana de chat (es la que puede
// grabar audio), aunque esté oculta. Si todavía no existe, se crea y se
// espera a que termine de cargar.
async function getLoadedChatWindow(): Promise<BrowserWindow> {
  if (!chatWindow) createChatWindow();
  const win = chatWindow!;
  if (win.webContents.isLoading()) {
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
  }
  return win;
}

// Así es como el reconocimiento de canciones (songRecognition.ts) le pide
// a la ventana de chat que escuche. El "true" marca la llamada como si
// viniera de un click del usuario: capturar el audio del sistema lo exige,
// y acá el pedido puede venir de un mensaje de voz o de texto.
setAudioListener(async (): Promise<ListenResult> => {
  // Si ALYA está diciendo algo ("Déjame escuchar…"), se espera a que
  // termine: se va a escuchar el audio del PC y su voz se mezclaría.
  await waitUntilQuiet();
  const win = await getLoadedChatWindow();
  return win.webContents.executeJavaScript('window.alyaListenForSong()', true);
});

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

/**
 * Muestra una notificación de Windows con el avatar de ALYA. El nombre
 * "ALYA" ya lo pone Windows en el encabezado, así que el título se
 * aprovecha para decir algo útil en vez de repetirlo.
 */
function notify(title: string, body: string): void {
  const icon = nativeImage.createFromPath(getResourcePath('build', 'avatar.png'));
  new Notification({ title, body, icon: icon.isEmpty() ? undefined : icon }).show();
}

function greet(): void {
  const hour = new Date().getHours();
  let saludo = 'Buenas noches';
  if (hour >= 5 && hour < 12) saludo = 'Buenos días';
  else if (hour >= 12 && hour < 20) saludo = 'Buenas tardes';

  const saludoCompleto = `${saludo}, ${loadSettings().userName}`;

  notify(saludoCompleto, 'ALYA está en línea.');
  speak(`${saludoCompleto}. ALYA está en línea.`);
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
    // Fuera el menú genérico de Electron (File / Edit / View / Window / Help):
    // ALYA trae su propio menú dentro de la ventana de chat.
    Menu.setApplicationMenu(null);

    await showFirstRunSetupIfNeeded();

    // Le avisa a la ventana de chat cuándo ALYA empieza y termina de
    // hablar, para que el avatar lo muestre.
    setSpeakingListener((speaking) => {
      if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send('alya:speaking', speaking);
    });
    // Y cuándo un audio empieza a sonar de verdad (ver "Interrumpirla con mi voz").
    setPlaybackListener(() => {
      if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send('alya:voicePlaying');
    });

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
      notify('Recordatorio', reminder.mensaje);
      speak(reminder.mensaje, undefined, { force: true }); // suena aunque la voz esté silenciada
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
// (Si la voz está silenciada lo decide voice.ts: speak() no hace nada mientras lo esté.)

// Imágenes adjuntas en el chat: llegan desde la ventana ya reducidas y en
// base64. Igual se validan acá (nunca confiar a ciegas en lo que manda una
// ventana): solo formatos de imagen que Gemini acepta, máximo 4 por
// mensaje, y con un tope de tamaño por imagen.
const MAX_CHAT_IMAGES = 4;
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024; // ~6 MB de imagen real
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function sanitizeChatImages(images: unknown): ChatImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter(
      (img): img is ChatImage =>
        !!img &&
        typeof img.mimeType === 'string' &&
        typeof img.data === 'string' &&
        ALLOWED_IMAGE_TYPES.has(img.mimeType) &&
        img.data.length > 0 &&
        img.data.length <= MAX_IMAGE_BASE64_LENGTH
    )
    .slice(0, MAX_CHAT_IMAGES)
    .map((img) => ({ mimeType: img.mimeType, data: img.data }));
}

// --- Historial: la conversación que se está teniendo ahora ---
// null = todavía no se guardó nada (se crea con el primer mensaje).
let currentConversationId: string | null = null;

/**
 * Guarda en el historial un intercambio: lo que dijo el usuario (si
 * hubo; userText null = ALYA habló sin un mensaje suyo, ej. botón 🎵) y
 * la respuesta de ALYA.
 */
function saveExchange(userText: string | null, imageCount: number, reply: ChatMessage): void {
  const now = Date.now();
  const messages: StoredMessage[] = [];

  if (userText !== null && (userText.trim() || imageCount > 0)) {
    messages.push({ role: 'user', text: userText, at: now, imageCount: imageCount || undefined });
  }
  messages.push({ role: 'assistant', text: reply.text, at: now, imageUrl: reply.imageUrl, cards: reply.cards });

  currentConversationId = appendMessages(currentConversationId, messages);
}

/** Le devuelve al modelo el contexto de la conversación actual (o empieza de cero). */
function reloadChatContext(): void {
  resetChat();
  const conversation = currentConversationId ? getConversation(currentConversationId) : null;
  if (!conversation) return;
  try {
    restoreChat(conversation.messages);
  } catch (err) {
    console.warn('[ALYA] No se pudo retomar el contexto de la conversación:', (err as Error).message);
  }
}

/**
 * Respuesta en vivo: mientras el modelo escribe, el texto se le va
 * mandando a la ventana que preguntó (para que la burbuja se vaya
 * llenando) y a la voz (que dice cada frase apenas está completa, sin
 * esperar al final). "streamId" lo pone la ventana para saber a qué
 * burbuja corresponde cada aviso; sin él, solo se habla.
 */
function openReplyStream(sender: Electron.WebContents, streamId: unknown) {
  const id = typeof streamId === 'string' && streamId.length > 0 && streamId.length <= 64 ? streamId : null;
  const speech = createSpeechStream();
  let shown = '';

  const send = (payload: { text?: string; transcript?: string }): void => {
    if (!id || sender.isDestroyed()) return;
    sender.send('alya:chatStream', { id, ...payload });
  };

  const handlers: ReplyStreamHandlers = {
    onText: (textSoFar, mood, settled) => {
      if (textSoFar !== shown) {
        shown = textSoFar;
        send({ text: textSoFar });
      }
      speech.push(textSoFar, mood, settled);
    },
  };

  return {
    handlers,
    /** Lo que se entendió de un mensaje de voz (para mostrarlo antes de la respuesta). */
    transcript: (text: string): void => send({ transcript: text }),
    /** La respuesta ya está completa: se dice lo que faltaba. */
    finish: (reply: ChatMessage): void => {
      if (reply.text) speech.end(reply.text, reply.mood);
    },
  };
}

// Callar a ALYA (tecla Esc, botón "Callar", o al empezar a grabar un
// mensaje de voz): corta lo que esté diciendo. No la deja silenciada: la
// próxima respuesta la dice normal.
ipcMain.handle('alya:stopSpeaking', async (): Promise<void> => {
  stopSpeaking();
});

ipcMain.handle(
  'alya:chat',
  async (event, userMessage: string, images?: unknown, streamId?: unknown): Promise<ChatMessage> => {
    // Mensaje nuevo: si todavía estaba diciendo la respuesta anterior, se calla.
    stopSpeaking();
    const live = openReplyStream(event.sender, streamId);
    try {
      const chatImages = sanitizeChatImages(images);
      const reply = await sendMessage(userMessage, chatImages, live.handlers);
      saveExchange(userMessage, chatImages.length, reply);
      live.finish(reply); // lo que faltaba por decir (el resto ya lo fue diciendo mientras llegaba)
      return reply;
    } catch (err) {
      const errorText = `Tuve un problema para responder: ${(err as Error).message}`;
      speak('Tuve un problema para responder.'); // versión corta, no lee el error técnico
      return { role: 'assistant', text: errorText };
    }
  }
);

ipcMain.handle('alya:getMuted', async (): Promise<boolean> => {
  return isMuted();
});

ipcMain.handle('alya:toggleMute', async (): Promise<boolean> => {
  // Silenciar corta lo que esté diciendo en ese instante y vacía lo que
  // tenía pendiente; el estado queda guardado para la próxima vez.
  setMuted(!isMuted());
  return isMuted();
});

// Ruta del avatar: las ventanas no pueden calcular esto solas de forma
// confiable (no tienen acceso a "app"), así que main.ts se las resuelve.
ipcMain.handle('alya:getAvatarUrl', async (): Promise<string> => {
  const avatarPath = getResourcePath('build', 'avatar.png');
  return `file://${avatarPath.replace(/\\/g, '/')}`;
});

// Lo mismo para la imagen de fondo de la ventana de chat. Para cambiar el
// fondo alcanza con reemplazar build\background.jpg por otra imagen.
ipcMain.handle('alya:getBackgroundUrl', async (): Promise<string> => {
  return pathToFileURL(getResourcePath('build', 'background.jpg')).href;
});

// Configuración: obtener/guardar. Al guardar, reiniciamos la conversación
// para que el nuevo nombre/personalidad se aplique de inmediato, sin
// tener que cerrar y volver a abrir toda la app.
ipcMain.handle('alya:getSettings', async (): Promise<AlyaSettings> => {
  return loadSettings();
});

ipcMain.handle('alya:saveSettings', async (_event, settings: AlyaSettings): Promise<void> => {
  // Se mezcla con lo ya guardado para no perder ningún ajuste que el
  // panel no haya mandado.
  saveSettings({ ...loadSettings(), ...settings });
  // Sesión nueva con el modelo (para que tome los ajustes), pero sin
  // perder el hilo de la conversación que está abierta.
  reloadChatContext();
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
  // Solo páginas web: una ventana nunca debería poder pedir que se abra
  // otra cosa (un programa, un archivo) por este camino.
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Guías paso a paso (ver guides.ts) para el panel de Configuración.
ipcMain.handle('alya:getGuide', async (_event, id: string): Promise<Guide | null> => {
  return getGuide(String(id));
});

// Confirmación de acciones sensibles (ej. cerrar una app)
ipcMain.handle('alya:confirmAction', async (): Promise<ChatMessage> => {
  const reply = await confirmPendingAction();
  saveExchange(null, 0, reply);
  if (reply.text) speak(reply.text, reply.mood);
  return reply;
});

ipcMain.handle('alya:cancelAction', async (): Promise<ChatMessage> => {
  const reply = cancelPendingAction();
  saveExchange(null, 0, reply);
  if (reply.text) speak(reply.text, reply.mood);
  return reply;
});

// Mensaje por voz: transcribe el audio grabado y lo procesa como si lo
// hubieras escrito (reutiliza toda la lógica de herramientas/confirmación).
ipcMain.handle(
  'alya:sendVoiceMessage',
  async (
    event,
    audioBase64: string,
    mimeType: string,
    images?: unknown,
    streamId?: unknown
  ): Promise<{ transcript: string; reply: ChatMessage }> => {
    stopSpeaking(); // le estás hablando: que no siga con lo anterior
    const transcript = await transcribeAudio(audioBase64, mimeType);

    if (!transcript || transcript === '[silencio]') {
      return {
        transcript: '',
        reply: { role: 'assistant', text: 'No alcancé a escuchar nada, ¿puedes repetirlo?' },
      };
    }

    const chatImages = sanitizeChatImages(images);
    const live = openReplyStream(event.sender, streamId);
    live.transcript(transcript); // la ventana muestra lo que entendió antes de que llegue la respuesta
    const reply = await sendMessage(transcript, chatImages, live.handlers);
    saveExchange(transcript, chatImages.length, reply);
    live.finish(reply);
    return { transcript, reply };
  }
);

// Identificar canción (botón 🎵): averigua qué está sonando — primero lo
// que reporta Windows (Spotify, YouTube en el navegador...) y, si hace
// falta, escuchando el audio — y le pasa el resultado a ALYA para que lo
// cuente de forma natural.
ipcMain.handle('alya:identifySong', async (): Promise<ChatMessage> => {
  // Quieres saber qué suena: si ALYA seguía hablando de otra cosa, se calla.
  stopSpeaking();
  try {
    const recognition = await recognizeSong();
    const userName = loadSettings().userName;
    const described = describeRecognition(recognition);

    const prompt =
      `(Sistema: ${userName} apretó el botón de identificar canción. Resultado: ` +
      `${JSON.stringify(described)}. ` +
      `Dile de forma breve y natural qué canción es y de quién. Si hay dato de audio y de Windows y no ` +
      `coinciden, la canción es la identificada por audio. Si solo hay un título de pestaña o video, ` +
      `saca de ahí la canción y el artista si se entiende. Si no se pudo identificar, dilo sin inventar nada.)`;

    const reply = await sendMessage(prompt);

    // La misma tarjeta que saldría si se lo hubieran pedido por chat.
    const songCard = buildCard('identificar_cancion', {}, described);
    if (songCard) reply.cards = [songCard, ...(reply.cards ?? [])];

    saveExchange(null, 0, reply);
    if (reply.text) speak(reply.text, reply.mood);
    return reply;
  } catch (err) {
    const errorText = `No pude identificar la canción: ${(err as Error).message}`;
    speak('No pude identificar la canción.');
    return { role: 'assistant', text: errorText };
  }
});

// Compara un clip de audio (grabado por la ventana de chat) contra la base
// de huellas de AudD. Lo usa la ventana mientras escucha: prueba con un
// clip corto y, si no hay coincidencia, con uno más largo.
ipcMain.handle(
  'alya:identifyClip',
  async (_event, audioBase64: string, mimeType: string): Promise<{ match: SongMatch | null; error?: string }> => {
    // El error vuelve como dato (no como excepción): así la ventana lo
    // recibe limpio y Electron no llena la consola con un volcado.
    try {
      return { match: await identifySong(audioBase64, mimeType) };
    } catch (err) {
      return { match: null, error: (err as Error).message };
    }
  }
);

ipcMain.handle('alya:resetChat', async (): Promise<void> => {
  currentConversationId = null; // el próximo mensaje empieza una conversación nueva en el historial
  cancelPendingAction();
  resetChat();
});

// --- Historial de conversaciones (barra lateral del chat) ---
ipcMain.handle(
  'alya:listConversations',
  async (): Promise<{ currentId: string | null; conversations: ConversationSummary[] }> => {
    return { currentId: currentConversationId, conversations: listConversations() };
  }
);

// Abre una conversación guardada y deja al modelo con ese contexto, para
// poder seguirla donde quedó.
ipcMain.handle('alya:openConversation', async (_event, id: string): Promise<Conversation | null> => {
  const conversation = getConversation(String(id));
  if (!conversation) return null;
  currentConversationId = conversation.id;
  cancelPendingAction();
  reloadChatContext();
  return conversation;
});

ipcMain.handle('alya:deleteConversation', async (_event, id: string): Promise<void> => {
  deleteConversation(String(id));
  if (currentConversationId === id) {
    currentConversationId = null;
    cancelPendingAction();
    resetChat();
  }
});

ipcMain.handle('alya:setFavorite', async (_event, id: string, favorite: boolean): Promise<void> => {
  setFavorite(String(id), favorite === true);
});

// --- Menú propio de la ventana de chat (reemplaza al de Electron) ---
function showSettingsWindow(): void {
  if (!settingsWindow) createSettingsWindow();
  settingsWindow?.show();
  settingsWindow?.focus();
}

ipcMain.handle('alya:openSettings', async (): Promise<void> => {
  showSettingsWindow();
});

// Para que ALYA pueda abrir el panel cuando le piden "llévame a configurar eso".
setSettingsOpener(showSettingsWindow);

ipcMain.handle('alya:openStatus', async (): Promise<void> => {
  if (!statusWindow) createStatusWindow();
  statusWindow?.show();
  statusWindow?.focus();
});

ipcMain.handle('alya:getAppInfo', async (): Promise<{ version: string; userName: string; voiceShortcut: string }> => {
  return { version: app.getVersion(), userName: loadSettings().userName, voiceShortcut: 'Ctrl + Shift + 1' };
});

// --- Ventana "Acerca de ALYA" ---

/** Versión instalada de una dependencia (para la lista de licencias). */
function packageVersion(name: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return String(require(`${name}/package.json`).version ?? '') || null;
  } catch {
    return null; // algunos paquetes no dejan leer su package.json: se muestra sin versión
  }
}

// Todo lo fijo de la ventana (rápido). El estado de conexión se pide aparte
// porque puede tardar unos segundos.
ipcMain.handle('alya:getAbout', async () => {
  return {
    version: app.getVersion(),
    developer: DEVELOPER,
    tagline: TAGLINE,
    links: LINKS,
    changelog: CHANGELOG,
    privacy: PRIVACY,
    licenses: LICENSES.map((entry) => ({
      name: entry.name,
      license: entry.license,
      use: entry.use,
      version:
        entry.name === 'Electron' ? process.versions.electron : entry.packageName ? packageVersion(entry.packageName) : null,
    })),
    year: new Date().getFullYear(),
  };
});

ipcMain.handle('alya:getEngineStatus', async () => {
  const engine = await getEngineInfo();
  return { model: modelLabel(engine.model), provider: 'Google', status: engine.status, detail: engine.detail };
});

/**
 * Texto para pegar en un reporte de error: versiones y equipo. A propósito
 * NO incluye nombre de usuario, rutas, claves ni nada de tus conversaciones.
 */
ipcMain.handle('alya:getSystemInfoText', async (): Promise<string> => {
  const [engine, status] = await Promise.all([
    getEngineInfo().catch(() => null),
    getStatus().catch(() => null),
  ]);
  const settings = loadSettings();

  const lines = [
    `ALYA ${app.getVersion()}${app.isPackaged ? '' : ' (desarrollo)'}`,
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `Sistema: ${os.type()} ${os.release()} (${os.arch()})`,
    status ? `CPU: ${status.cpu.model} (${status.cpu.cores} núcleos)` : null,
    status ? `RAM: ${status.ram.totalGB} GB` : null,
    status && status.gpu.length > 0 ? `GPU: ${status.gpu.map((g) => g.model).join(', ')}` : null,
    engine ? `Motor: ${modelLabel(engine.model)} — ${engine.detail}` : null,
    `Pensamiento: ${settings.thinkingMode ?? 'auto'}`,
    `Spotify por API: ${isSpotifyConnected() ? 'conectada' : 'no conectada'}`,
    `Reconocimiento por audio: ${getFingerprintProblem() ? 'no disponible' : 'disponible'}`,
    `Idioma del sistema: ${app.getLocale()}`,
  ];
  return lines.filter(Boolean).join('\n');
});

// "Buscar actualizaciones": la misma revisión que ALYA hace sola, pero a pedido.
ipcMain.handle(
  'alya:checkForUpdates',
  async (): Promise<{ status: 'dev' | 'latest' | 'available' | 'error'; version?: string; message?: string }> => {
    if (!app.isPackaged) return { status: 'dev' };
    try {
      const result = await autoUpdater.checkForUpdates();
      const latest = result?.updateInfo?.version;
      if (latest && latest !== app.getVersion()) return { status: 'available', version: latest };
      return { status: 'latest', version: app.getVersion() };
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  }
);

// Abre en el Explorador la carpeta donde ALYA guarda tus datos.
ipcMain.handle('alya:openDataFolder', async (): Promise<void> => {
  shell.openPath(app.getPath('userData'));
});

ipcMain.handle('alya:quit', async (): Promise<void> => {
  app.exit(0);
});

// Tarjeta de archivos encontrados: abre el Explorador con el archivo seleccionado.
ipcMain.handle('alya:showInFolder', async (_event, filePath: string): Promise<boolean> => {
  if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

// Mantener viva la app aunque se cierren todas las ventanas (vive en el tray)
app.on('window-all-closed', () => {
  // No hacemos nada: en Electron, no llamar a app.quit() aquí ya evita
  // que la app se cierre. ALYA sigue viva en el tray.
});