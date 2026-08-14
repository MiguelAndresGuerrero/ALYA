import * as dotenv from 'dotenv';
import { app, Tray, Menu, BrowserWindow, ipcMain, Notification, nativeImage, session, globalShortcut, desktopCapturer } from 'electron';
import * as path from 'path';

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

import AutoLaunch from 'auto-launch';

import { getStatus, getTopProcesses, getNetworkLatency } from './systemTools';
import { openApp } from './appLauncher';
import { speak, startVoiceServer, stopVoiceServer } from './voice';
import { sendMessage, resetChat, confirmPendingAction, cancelPendingAction, transcribeAudio } from './ai';
import { identifySong } from './songid';
import { startReminderScheduler } from './reminders';
import { loadSettings, saveSettings, type AlyaSettings } from './settingsStore';
import { startKickChatListener } from './kickChat';
import { queueOrPlaySong } from './webBrowser';
import { startOverlayServer } from './obsOverlay';
import { loadProjects, type Project } from './projectsStore';
import { getResourcePath } from './resourcePaths';
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

// --- Ventana de estado (se abre al hacer click en el ícono) ---
function createStatusWindow(): void {
  statusWindow = new BrowserWindow({
    width: 380,
    height: 480,
    show: false,
    resizable: false,
    frame: true,
    title: 'ALYA',
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
    { label: 'Abrir Discord', click: () => openApp('discord').catch(console.error) },
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
    createTray();
    await ensureAutoLaunch();
    startVoiceServer(); // arranca el proceso de voz persistente antes del saludo
    greet();

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

    // Integración con Kick: si configuraste KICK_CHATROOM_ID en el .env,
    // ALYA escucha el chat en vivo y reacciona a "/play <canción>".
    const kickChatroomId = process.env.KICK_CHATROOM_ID;
    if (kickChatroomId) {
      startKickChatListener(kickChatroomId, async (query, username) => {
        console.log(`[Kick] ${username} pidió: ${query}`);
        try {
          const { playedNow, queuePosition } = await queueOrPlaySong(query);
          const mensaje = playedNow
            ? `Reproduciendo ahora: ${query}, pedida por ${username}.`
            : `Canción agregada a la fila, posición ${queuePosition}: ${query}, pedida por ${username}.`;
          speak(mensaje);
        } catch {
          speak(`No logré encontrar "${query}", pedida por ${username}.`);
        }
      });
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