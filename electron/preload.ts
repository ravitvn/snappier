import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize: () => ipcRenderer.invoke('minimize-window'),
  close: () => ipcRenderer.invoke('close-window'),
  captureScreen: (): Promise<string | null> => ipcRenderer.invoke('capture-screen'),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  downloadUpdate: (url: string): Promise<{ ok: boolean } | { error: string }> =>
    ipcRenderer.invoke('download-update', url),
  onTriggerScreenshot: (cb: () => void) =>
    ipcRenderer.on('trigger-screenshot', cb),
  onDownloadProgress: (cb: (pct: number) => void) =>
    ipcRenderer.on('download-progress', (_, pct) => cb(pct)),
})
