import { contextBridge, ipcRenderer } from 'electron'
import type { PortlightApi } from '../shared/types'

const api: PortlightApi = {
  isDesktop: true,
  scan: () => ipcRenderer.invoke('ports:scan'),
  stop: (request) => ipcRenderer.invoke('ports:stop', request),
  openUrl: (id) => ipcRenderer.invoke('ports:open-url', id),
  openFolder: (id) => ipcRenderer.invoke('ports:open-folder', id),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  exportSnapshot: () => ipcRenderer.invoke('ports:export'),
  windowAction: (action) => ipcRenderer.send('window:action', action),
}
contextBridge.exposeInMainWorld('portlight', api)
