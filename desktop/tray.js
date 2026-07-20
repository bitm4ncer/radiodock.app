const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let mainWindow = null;

function createTray(win) {
  mainWindow = win;

  const iconPath = path.join(__dirname, 'icons', 'icon-tray.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('RadioDock');

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(buildMenu());
  });

  updateTrayMenu({ playing: false, station: null });
}

function buildMenu(state = { playing: false, station: null }) {
  const template = [
    {
      label: state.station?.name ?? 'No station playing',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: state.playing ? 'Pause' : 'Play',
      click: () => {
        mainWindow?.webContents.send('rd:tray:playPause');
      },
    },
    {
      label: 'Previous Station',
      click: () => {
        mainWindow?.webContents.send('rd:tray:previous');
      },
    },
    {
      label: 'Next Station',
      click: () => {
        mainWindow?.webContents.send('rd:tray:next');
      },
    },
    { type: 'separator' },
    {
      label: 'Show RadioDock',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Run on Startup',
      type: 'checkbox',
      // Read live from the OS each time the menu is built, so the tick always
      // reflects the real login-item state even if it changed elsewhere.
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        // Electron flips item.checked before firing click, so it already holds
        // the desired new state.
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit RadioDock',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ];

  return Menu.buildFromTemplate(template);
}

function updateTrayMenu(state) {
  if (!tray) return;
  tray.setContextMenu(buildMenu(state));
}

function updateTrayIcon(playing) {
  if (!tray) return;
  const iconName = playing ? 'icon-tray-playing.png' : 'icon-tray.png';
  const iconPath = path.join(__dirname, 'icons', iconName);
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      tray.setImage(img);
    }
  } catch {
    // Icon file missing — tray keeps last known icon.
  }
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function getTray() {
  return tray;
}

module.exports = { createTray, updateTrayIcon, updateTrayMenu, destroyTray, getTray };
