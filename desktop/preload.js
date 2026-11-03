const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('padbench', {
  desktop: true,
  net: (url, opts) => ipcRenderer.invoke('net', url, opts),
});
