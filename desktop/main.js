const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  shell,
} = require('electron');
const path = require('path');
const { createTray, updateTrayIcon, updateTrayMenu, destroyTray } = require('./tray');

const isDev = process.env.NODE_ENV === 'development';
const APP_URL = isDev ? 'http://localhost:5173' : 'https://radiodock.app';

let mainWindow = null;
let alwaysOnTop = false;
let playbackState = { playing: false, station: null };
let autoStart = false;

function createWindow() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 480,
    icon: iconPath,
    alwaysOnTop,
    title: 'RadioDock',
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Persist alwaysOnTop across window recreations
  mainWindow.on('close', (e) => {
    // On macOS, hide instead of quit when closing window (unless Cmd+Q)
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  setupIPC();
  createTray(mainWindow);
}

function setupIPC() {
  // --- Always on Top ---
  ipcMain.handle('rd:alwaysOnTop:set', (_, onTop) => {
    alwaysOnTop = onTop;
    if (mainWindow) mainWindow.setAlwaysOnTop(onTop);
    return alwaysOnTop;
  });

  ipcMain.handle('rd:alwaysOnTop:get', () => alwaysOnTop);

  // --- Playback state (for tray icon + context menu) ---
  ipcMain.handle('rd:playback:update', (_, state) => {
    playbackState = { ...playbackState, ...state };
    updateTrayIcon(playbackState.playing);
    updateTrayMenu(playbackState);
    // Badge on Windows taskbar
    if (mainWindow && process.platform === 'win32') {
      mainWindow.setOverlayIcon(
        playbackState.playing
          ? nativeImage.createFromDataURL(createDotDataUrl())
          : null,
        'Playing',
      );
    }
  });

  // --- Auto-start ---
  ipcMain.handle('rd:autoStart:set', (_, enabled) => {
    autoStart = enabled;
    app.setLoginItemSettings({ openAtLogin: enabled });
    return enabled;
  });

  ipcMain.handle('rd:autoStart:get', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  // --- Tray icon generator ---
  // The renderer (PWA) draws a Canvas with the current icon state and
  // sends it as a data URL. The main process converts it to a NativeImage
  // and sets it on the tray. This lets the PWA control exactly how the
  // icon looks (colors, indicator dot, animations) without native deps.
  ipcMain.handle('rd:trayIcon:set', (_, dataUrl) => {
    if (!dataUrl) return false;
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      const tray = require('./tray').getTray();
      if (tray) {
        const resized = img.resize({ width: 16, height: 16 });
        tray.setImage(resized);
      }
      return true;
    } catch (err) {
      console.error('Tray icon update failed:', err);
      return false;
    }
  });

  // --- Window controls ---
  ipcMain.handle('rd:window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('rd:window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // --- External links ---
  ipcMain.handle('rd:shell:openExternal', (_, url) => {
    return shell.openExternal(url);
  });

  // --- App info ---
  ipcMain.handle('rd:app:getInfo', () => ({
    platform: process.platform,
    version: app.getVersion(),
    autoStart,
    alwaysOnTop,
  }));
}

// Tiny 16×16 red dot as data URL for the Windows taskbar overlay icon.
function createDotDataUrl() {
  // 1×1 pixel red dot — nativeImage will scale it, but Windows overlays
  // work best with at least a 16×16 icon. We draw a simple circle.
  const size = 16;
  const r = 6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#ff4444"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  createWindow();

  // Restore auto-start preference
  autoStart = app.getLoginItemSettings().openAtLogin;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  destroyTray();
});
