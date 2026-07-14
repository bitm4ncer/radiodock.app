const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, namespaced API to the renderer (PWA).
// The PWA checks `window.electronAPI` — if it exists, native features
// are available. If not (browser, mobile PWA), they degrade silently.
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Always on Top ---
  setAlwaysOnTop: (onTop) => ipcRenderer.invoke('rd:alwaysOnTop:set', onTop),
  getAlwaysOnTop: () => ipcRenderer.invoke('rd:alwaysOnTop:get'),

  // --- Playback state (triggers tray icon + menu update) ---
  updatePlayback: (state) => ipcRenderer.invoke('rd:playback:update', state),

  // --- Auto-start ---
  setAutoStart: (enabled) => ipcRenderer.invoke('rd:autoStart:set', enabled),
  getAutoStart: () => ipcRenderer.invoke('rd:autoStart:get'),

  // --- Tray icon (Canvas-generated data URL from renderer) ---
  setTrayIcon: (dataUrl) => ipcRenderer.invoke('rd:trayIcon:set', dataUrl),

  // --- Window controls ---
  minimize: () => ipcRenderer.invoke('rd:window:minimize'),
  close: () => ipcRenderer.invoke('rd:window:close'),
  isMaximized: () => ipcRenderer.invoke('rd:window:isMaximized'),

  // --- Tiny player: shrink + dock bottom-right, or restore ---
  setTinyPlayer: (enabled) => ipcRenderer.invoke('rd:window:tinyPlayer', enabled),
  // Main → renderer: the context-menu "Exit tiny player" was chosen.
  onTinyExit: (callback) => {
    ipcRenderer.on('rd:tiny:exit', () => callback());
    return () => ipcRenderer.removeAllListeners('rd:tiny:exit');
  },

  // --- Shell ---
  openExternal: (url) => ipcRenderer.invoke('rd:shell:openExternal', url),

  // --- App info ---
  getAppInfo: () => ipcRenderer.invoke('rd:app:getInfo'),

  // --- Tray menu actions (main → renderer) ---
  onTrayPlayPause: (callback) => {
    ipcRenderer.on('rd:tray:playPause', () => callback());
    return () => ipcRenderer.removeAllListeners('rd:tray:playPause');
  },
  onTrayNext: (callback) => {
    ipcRenderer.on('rd:tray:next', () => callback());
    return () => ipcRenderer.removeAllListeners('rd:tray:next');
  },
  onTrayPrevious: (callback) => {
    ipcRenderer.on('rd:tray:previous', () => callback());
    return () => ipcRenderer.removeAllListeners('rd:tray:previous');
  },

  // --- Platform check ---
  isElectron: true,
});
