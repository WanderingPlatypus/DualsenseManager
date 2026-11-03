const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('padbench', {
  desktop: true,
  net: (url, opts) => ipcRenderer.invoke('net', url, opts),
  checkUpdate: (server, token) => ipcRenderer.invoke('update:check', server, token),
  version: () => ipcRenderer.invoke('app:version'),
  restart: () => ipcRenderer.invoke('app:restart'),
  openBluetoothSettings: () => ipcRenderer.invoke('open:bluetooth'),
});
