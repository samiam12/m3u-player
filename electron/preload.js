const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('m3uPlayerDesktop', {
  fetchText: async (url, options = {}) => {
    return ipcRenderer.invoke('m3uPlayer.fetchText', url, options);
  },
  fetchStatus: async (url, options = {}) => {
    return ipcRenderer.invoke('m3uPlayer.fetchStatus', url, options);
  },
  openExternal: async (url) => {
    return ipcRenderer.invoke('m3uPlayer.openExternal', url);
  },
  isDesktopApp: true
});
