const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  shell,
  screen,
} = require('electron');
const path = require('path');
const { createTray, updateTrayIcon, updateTrayMenu, destroyTray } = require('./tray');

const isDev = process.env.NODE_ENV === 'development';
const APP_URL = isDev ? 'http://localhost:5173' : 'https://radiodock.app';

let mainWindow = null;
let alwaysOnTop = false;
let playbackState = { playing: false, station: null };
let autoStart = false;
// Saved window state so tiny-player mode can restore the full window.
let preTinyBounds = null;
let preTinyMinSize = null;

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
    // Frameless: the in-app Electron title bar (src/ui/electron-window-controls.js)
    // provides drag + minimize + always-on-top + close. Without this the native
    // OS frame sat on top of the compact mobile layout.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Remote content gets the full sandbox; the preload only uses
      // ipcRenderer/contextBridge, so nothing here needs an unsandboxed renderer.
      sandbox: true,
    },
  });

  mainWindow.loadURL(APP_URL);

  // Lock navigation to our own origin — remote content must not be able to
  // navigate the shell elsewhere or spawn windows with shell privileges.
  const APP_ORIGIN = new URL(APP_URL).origin;
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });

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
    // (The Windows taskbar overlay badge was removed — it was built from an
    // SVG data URL, which nativeImage cannot decode, so it never rendered.
    // The tray icon swap is the real playing indicator.)
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

  ipcMain.handle('rd:window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('rd:window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  // --- Tiny player: shrink to a mini window docked bottom-right, or restore ---
  ipcMain.handle('rd:window:tinyPlayer', (_, enabled) => {
    if (!mainWindow) return false;
    if (enabled) {
      // Remember the full-size state to restore later.
      preTinyBounds = mainWindow.getBounds();
      preTinyMinSize = mainWindow.getMinimumSize();

      const W = 360, H = 132, MARGIN = 12;
      // workArea excludes the taskbar, so this docks just above/left of it.
      const wa = screen.getPrimaryDisplay().workArea;
      // Relax the min size (the full window's 380×480 floor would clamp us).
      mainWindow.setMinimumSize(240, 96);
      mainWindow.setResizable(false);
      mainWindow.setBounds({
        width: W,
        height: H,
        x: wa.x + wa.width - W - MARGIN,
        y: wa.y + wa.height - H - MARGIN,
      });
    } else {
      mainWindow.setResizable(true);
      if (preTinyMinSize) mainWindow.setMinimumSize(preTinyMinSize[0], preTinyMinSize[1]);
      if (preTinyBounds) mainWindow.setBounds(preTinyBounds);
    }
    return enabled;
  });

  // --- External links ---
  ipcMain.handle('rd:shell:openExternal', (_, url) => {
    // Only ever hand real web URLs to the OS — never arbitrary protocol
    // handlers, in case the remote origin is ever compromised.
    try {
      if (/^https?:$/.test(new URL(url).protocol)) return shell.openExternal(url);
    } catch { /* malformed URL → ignore */ }
    return false;
  });

  // --- App info ---
  ipcMain.handle('rd:app:getInfo', () => ({
    platform: process.platform,
    version: app.getVersion(),
    autoStart,
    alwaysOnTop,
  }));
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
