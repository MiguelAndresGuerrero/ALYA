import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('alyaSetup', {
    saveApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('setup:saveApiKey', apiKey),
    skip: (): Promise<void> => ipcRenderer.invoke('setup:skip'),
    openLink: (url: string): Promise<void> => ipcRenderer.invoke('setup:openLink', url),
    getAvatarUrl: (): Promise<string> => ipcRenderer.invoke('alya:getAvatarUrl'),
});