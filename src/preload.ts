import { contextBridge, ipcRenderer } from 'electron';
import type { SystemStatus, ProcessInfo, ChatMessage } from './types';
import type { AlyaSettings } from './settingsStore';
import type { Project } from './projectsStore';

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
  sendChatMessage: (text: string): Promise<ChatMessage> => ipcRenderer.invoke('alya:chat', text),
  resetChat: (): Promise<void> => ipcRenderer.invoke('alya:resetChat'),
  toggleMute: (): Promise<boolean> => ipcRenderer.invoke('alya:toggleMute'),
  getSettings: (): Promise<AlyaSettings> => ipcRenderer.invoke('alya:getSettings'),
  getAvatarUrl: (): Promise<string> => ipcRenderer.invoke('alya:getAvatarUrl'),
  saveSettings: (settings: AlyaSettings): Promise<void> =>
    ipcRenderer.invoke('alya:saveSettings', settings),
  confirmAction: (): Promise<ChatMessage> => ipcRenderer.invoke('alya:confirmAction'),
  cancelAction: (): Promise<ChatMessage> => ipcRenderer.invoke('alya:cancelAction'),
  sendVoiceMessage: (
    audioBase64: string,
    mimeType: string
  ): Promise<{ transcript: string; reply: ChatMessage }> =>
    ipcRenderer.invoke('alya:sendVoiceMessage', audioBase64, mimeType),
  onTriggerVoice: (callback: () => void): void => {
    ipcRenderer.on('alya:trigger-voice', () => callback());
  },
  identifySong: (audioBase64: string, mimeType: string): Promise<ChatMessage> =>
    ipcRenderer.invoke('alya:identifySong', audioBase64, mimeType),

  getSpotifyStatus: (): Promise<{ hasCredentials: boolean; connected: boolean }> =>
    ipcRenderer.invoke('alya:getSpotifyStatus'),
  saveSpotifyCredentials: (
    clientId: string,
    clientSecret: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('alya:saveSpotifyCredentials', clientId, clientSecret),
  openLink: (url: string): Promise<void> => ipcRenderer.invoke('alya:openLink', url),
});