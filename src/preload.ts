import { contextBridge, ipcRenderer } from 'electron';
import type { SystemStatus, ProcessInfo, ChatMessage, ChatImage } from './types';
import type { AlyaSettings } from './settingsStore';
import type { Project } from './projectsStore';
import type { SongMatch } from './songid';
import type { Guide } from './guides';
import type { Conversation, ConversationSummary } from './conversationsStore';

contextBridge.exposeInMainWorld('alya', {
  getStatus: (): Promise<SystemStatus> => ipcRenderer.invoke('alya:getStatus'),
  onStatusUpdate: (callback: (status: SystemStatus) => void): void => {
    ipcRenderer.on('alya:status-update', (_event, status: SystemStatus) => callback(status));
  },
  // Bajo demanda: solo se pide cuando el usuario aprieta el botón en el
  // panel. Devuelve null si ya había una consulta en camino (evita
  // solapamientos si se aprieta el botón varias veces seguidas).
  getTopProcesses: (): Promise<ProcessInfo[] | null> => ipcRenderer.invoke('alya:getTopProcesses'),
  getNetworkLatency: (): Promise<number | null> => ipcRenderer.invoke('alya:getNetworkLatency'),
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('alya:getProjects'),

  // Chat con el cerebro de ALYA
  // "images" es opcional: imágenes adjuntas (ya reducidas y en base64).
  // "streamId" identifica la respuesta para ir recibiéndola en vivo (onChatStream).
  sendChatMessage: (text: string, images?: ChatImage[], streamId?: string): Promise<ChatMessage> =>
    ipcRenderer.invoke('alya:chat', text, images ?? [], streamId),
  // La respuesta mientras se escribe: "text" es TODO el texto hasta ahora
  // (no solo lo nuevo); "transcript", lo que se entendió de un mensaje de voz;
  // "notice", un aviso mientras se espera (ej. el modelo está saturado).
  onChatStream: (callback: (update: { id: string; text?: string; transcript?: string; notice?: string }) => void): void => {
    ipcRenderer.on('alya:chatStream', (_event, update: { id: string; text?: string; transcript?: string; notice?: string }) =>
      callback(update)
    );
  },
  // Captura de pantalla para adjuntar a un mensaje: una imagen por pantalla.
  captureScreen: (): Promise<{ images: ChatImage[]; error?: string }> => ipcRenderer.invoke('alya:captureScreen'),
  // Lo mismo, pero disparado por el atajo global (Ctrl+Shift+2).
  onScreenCaptured: (callback: (capture: { images: ChatImage[]; error?: string }) => void): void => {
    ipcRenderer.on('alya:screen-captured', (_event, capture: { images: ChatImage[]; error?: string }) =>
      callback(capture)
    );
  },
  // Corta lo que ALYA esté diciendo (no la deja silenciada).
  stopSpeaking: (): Promise<void> => ipcRenderer.invoke('alya:stopSpeaking'),
  resetChat: (): Promise<void> => ipcRenderer.invoke('alya:resetChat'),
  toggleMute: (): Promise<boolean> => ipcRenderer.invoke('alya:toggleMute'),
  getMuted: (): Promise<boolean> => ipcRenderer.invoke('alya:getMuted'),
  getSettings: (): Promise<AlyaSettings> => ipcRenderer.invoke('alya:getSettings'),
  getAvatarUrl: (): Promise<string> => ipcRenderer.invoke('alya:getAvatarUrl'),
  getBackgroundUrl: (): Promise<string> => ipcRenderer.invoke('alya:getBackgroundUrl'),
  saveSettings: (settings: AlyaSettings): Promise<void> =>
    ipcRenderer.invoke('alya:saveSettings', settings),
  confirmAction: (): Promise<ChatMessage> => ipcRenderer.invoke('alya:confirmAction'),
  cancelAction: (): Promise<ChatMessage> => ipcRenderer.invoke('alya:cancelAction'),
  sendVoiceMessage: (
    audioBase64: string,
    mimeType: string,
    images?: ChatImage[],
    streamId?: string
  ): Promise<{ transcript: string; reply: ChatMessage }> =>
    ipcRenderer.invoke('alya:sendVoiceMessage', audioBase64, mimeType, images ?? [], streamId),
  onTriggerVoice: (callback: () => void): void => {
    ipcRenderer.on('alya:trigger-voice', () => callback());
  },
  // Botón 🎵: ALYA averigua qué está sonando (venga de donde venga) y responde.
  identifySong: (): Promise<ChatMessage> => ipcRenderer.invoke('alya:identifySong'),
  // Compara un clip de audio contra la base de huellas (AudD). match null = sin coincidencia.
  identifyClip: (audioBase64: string, mimeType: string): Promise<{ match: SongMatch | null; error?: string }> =>
    ipcRenderer.invoke('alya:identifyClip', audioBase64, mimeType),

  getSpotifyStatus: (): Promise<{ hasCredentials: boolean; connected: boolean }> =>
    ipcRenderer.invoke('alya:getSpotifyStatus'),
  saveSpotifyCredentials: (
    clientId: string,
    clientSecret: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('alya:saveSpotifyCredentials', clientId, clientSecret),
  openLink: (url: string): Promise<void> => ipcRenderer.invoke('alya:openLink', url),
  getGuide: (id: string): Promise<Guide | null> => ipcRenderer.invoke('alya:getGuide', id),

  // Historial de conversaciones (barra lateral)
  listConversations: (): Promise<{ currentId: string | null; conversations: ConversationSummary[] }> =>
    ipcRenderer.invoke('alya:listConversations'),
  openConversation: (id: string): Promise<Conversation | null> => ipcRenderer.invoke('alya:openConversation', id),
  deleteConversation: (id: string): Promise<void> => ipcRenderer.invoke('alya:deleteConversation', id),
  setFavorite: (id: string, favorite: boolean): Promise<void> =>
    ipcRenderer.invoke('alya:setFavorite', id, favorite),

  // Menú propio de la ventana de chat
  openSettings: (): Promise<void> => ipcRenderer.invoke('alya:openSettings'),
  openStatus: (): Promise<void> => ipcRenderer.invoke('alya:openStatus'),
  getAppInfo: (): Promise<{ version: string; userName: string; voiceShortcut: string; screenShortcut: string }> =>
    ipcRenderer.invoke('alya:getAppInfo'),
  quit: (): Promise<void> => ipcRenderer.invoke('alya:quit'),

  // Ventana "Acerca de ALYA"
  getAbout: (): Promise<unknown> => ipcRenderer.invoke('alya:getAbout'),
  getEngineStatus: (): Promise<{ model: string; provider: string; status: string; detail: string }> =>
    ipcRenderer.invoke('alya:getEngineStatus'),
  getSystemInfoText: (): Promise<string> => ipcRenderer.invoke('alya:getSystemInfoText'),
  checkForUpdates: (): Promise<{ status: string; version?: string; message?: string }> =>
    ipcRenderer.invoke('alya:checkForUpdates'),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('alya:openDataFolder'),
  showInFolder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('alya:showInFolder', filePath),

  // ALYA empezó / terminó de hablar (para animar el avatar)
  onSpeaking: (callback: (speaking: boolean) => void): void => {
    ipcRenderer.on('alya:speaking', (_event, speaking: boolean) => callback(speaking));
  },
  // Un audio de ALYA empezó a sonar de verdad (no solo a prepararse).
  onVoicePlaying: (callback: () => void): void => {
    ipcRenderer.on('alya:voicePlaying', () => callback());
  },
});