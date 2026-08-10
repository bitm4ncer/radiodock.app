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
let preTinyAlwaysOnTop = false;
let tinyMode = false;

// The pill window, and the full window's floor / default. FULL_MIN_* mirror the
// minWidth/minHeight below and are the authority when restoring: a size recorded
// while the relaxed tiny floor was active must never win.
const TINY_W = 384, TINY_H = 132, TINY_MARGIN = 12;
const FULL_MIN_W = 380, FULL_MIN_H = 480;
const FULL_DEFAULT_W = 380, FULL_DEFAULT_H = 760;

function enterTinyWindow() {
  // Re-entering while already tiny would record the PILL as the full size, so
  // every later expand would restore a 384x132 window and the app would render
  // its full layout clipped inside it. Enter is idempotent instead.
  if (!mainWindow || tinyMode) return;
  preTinyBounds = mainWindow.getBounds();
  preTinyMinSize = mainWindow.getMinimumSize();
  preTinyAlwaysOnTop = mainWindow.isAlwaysOnTop();

  // The window is taller than the pill itself: the CSS centers the pill and the
  // extra vertical space is transparent margin, so the pill's drop shadow
  // renders instead of being clipped by the window frame.
  // workArea excludes the taskbar, so this docks just above/left of it.
  const wa = screen.getPrimaryDisplay().workArea;
  // Relax the min size (the full window's 380×480 floor would clamp us).
  mainWindow.setMinimumSize(200, 72);
  mainWindow.setResizable(false);
  // Default to always-on-top in tiny mode (toggleable via context menu).
  mainWindow.setAlwaysOnTop(true, 'floating');
  alwaysOnTop = true;
  mainWindow.setBounds({
    width: TINY_W,
    height: TINY_H,
    x: wa.x + wa.width - TINY_W - TINY_MARGIN,
    y: wa.y + wa.height - TINY_H - TINY_MARGIN,
  });
  tinyMode = true;
}

function exitTinyWindow() {
  if (!mainWindow) return;
  tinyMode = false;
  mainWindow.setResizable(true);
  // Clamp to the real floor: a min size captured while tiny (200×72) would
  // otherwise let the window stay pill-sized.
  const minW = Math.max(preTinyMinSize?.[0] ?? 0, FULL_MIN_W);
  const minH = Math.max(preTinyMinSize?.[1] ?? 0, FULL_MIN_H);
  mainWindow.setMinimumSize(minW, minH);
  mainWindow.setAlwaysOnTop(!!preTinyAlwaysOnTop);
  alwaysOnTop = !!preTinyAlwaysOnTop;
  // Expanding must never leave the window at pill size: with no usable record
  // the app would switch back to its full layout inside a 384x132 window —
  // clipped, with no room for a page like station info.
  const b = preTinyBounds;
  if (b && b.width >= minW && b.height >= minH) {
    mainWindow.setBounds(b);
  } else {
    const wa = screen.getPrimaryDisplay().workArea;
    const width = Math.min(Math.max(FULL_DEFAULT_W, minW), wa.width);
    const height = Math.min(Math.max(FULL_DEFAULT_H, minH), wa.height);
    mainWindow.setBounds({
      width,
      height,
      x: wa.x + Math.round((wa.width - width) / 2),
      y: wa.y + Math.round((wa.height - height) / 2),
    });
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icons', 'icon.png');

  mainWindow = new BrowserWindow({
    // Opens at its narrowest — the compact column IS the desktop app, and it's
    // what the app layout is tuned for. Capped one pixel below the desktop
    // breakpoint (app-desktop.css takes over at min-width: 700px, and Electron
    // reports display-mode: browser, so it would): the wide desktop regime
    // belongs to the browser, not to this window.
    width: 380,
    height: 760,
    minWidth: 380,
    // Linux tiling compositors (niri, sway) stretch windows to fill their
    // column and ignore a max-width range, tripping the desktop breakpoint.
    // Lock the width there (min === max) so the window stays a fixed mobile
    // column; the app also forces the mobile layout via the is-standalone
    // class, so a compositor that ignores this hint still renders correctly.
    maxWidth: process.platform === 'linux' ? 380 : 699,
    minHeight: 480,
    icon: iconPath,
    alwaysOnTop,
    title: 'RadioDock',
    show: false,
    // Frameless: the in-app Electron title bar (src/ui/electron-window-controls.js)
    // provides drag + minimize + always-on-top + close. Without this the native
    // OS frame sat on top of the compact mobile layout.
    frame: false,
    // Transparent so tiny-player mode can be a true pill shape (the window is
    // always a rectangle; the corners must be see-through to reveal the pill).
    // In full mode the app's opaque body (background: var(--bg)) fills the whole
    // window, so it still looks like a normal solid window. hasShadow off so a
    // rectangular OS shadow doesn't trace the pill's transparent corners.
    transparent: true,
    // macOS renders an explicit backgroundColor (even fully-transparent
    // '#00000000') as opaque, which kills the tiny-player see-through corners —
    // omit it there. Windows keeps it (verified working with it).
    ...(process.platform === 'darwin' ? {} : { backgroundColor: '#00000000' }),
    hasShadow: false,
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

  // A reload restarts the renderer in full mode (nothing persists the tiny
  // class), and a service-worker update after a deploy reloads on its own. If
  // the window were left at pill size the app would paint its full layout
  // clipped inside 384x132, so snap the window back to match the fresh page.
  mainWindow.webContents.on('did-finish-load', () => {
    if (tinyMode) exitTinyWindow();
  });

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

  // Right-click in tiny-player mode: toggle always-on-top or leave tiny mode.
  mainWindow.webContents.on('context-menu', () => {
    if (!tinyMode) return;
    Menu.buildFromTemplate([
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: mainWindow.isAlwaysOnTop(),
        click: () => {
          const v = !mainWindow.isAlwaysOnTop();
          mainWindow.setAlwaysOnTop(v, 'floating');
          alwaysOnTop = v;
        },
      },
      { type: 'separator' },
      { label: 'Exit tiny player', click: () => mainWindow.webContents.send('rd:tiny:exit') },
    ]).popup();
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

  // --- Tiny player: a pill-sized always-on-top mini window docked bottom-right,
  // or restore. Just the player pill (no title bar); exit via the in-pill
  // maximize button or the right-click context menu. ---
  ipcMain.handle('rd:window:tinyPlayer', (_, enabled) => {
    if (!mainWindow) return false;
    if (enabled) enterTinyWindow();
    else exitTinyWindow();
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
