// Electron native-feature bridge for the RadioDock PWA.
//
// Detects window.electronAPI (injected by Electron's preload script).
// When running inside the desktop wrapper, this module:
//   1. Syncs playback state → tray icon + context menu
//   2. Listens for tray menu actions (play/pause, previous/next station)
//   3. Exposes always-on-top toggle
//   4. Manages auto-start preference
//
// When running in a regular browser, this module is a no-op.

const api = window.electronAPI;

export function isElectron() {
  return !!api?.isElectron;
}

/**
 * Wire the Electron bridge to the app player and state.
 * @param {{ player: import('../player/audio.js').player, getActiveStation: () => object }} deps
 */
export function mountElectronBridge({ player, getActiveStation }) {
  if (!isElectron()) return null;

  // Stamp the body so CSS can show/hide Electron-only UI.
  document.body.classList.add('is-electron');

  let playing = false;
  let currentStation = null;

  function syncPlaybackState() {
    api.updatePlayback({ playing, station: currentStation });
    updateTrayIcon();
  }

  function updateTrayIcon() {
    if (!playing) {
      api.setTrayIcon(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/icons/icon-192.png';
    img.onload = () => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);
      const cx = 50, cy = 50, r = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4444';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      api.setTrayIcon(canvas.toDataURL());
    };
  }

  // --- Player events → Electron ---
  player.on('stationchange', (evt) => {
    currentStation = evt.detail?.station ?? null;
    syncPlaybackState();
  });

  player.on('playing', () => {
    playing = true;
    syncPlaybackState();
  });

  player.on('pause', () => {
    playing = false;
    syncPlaybackState();
  });

  player.on('ended', () => {
    playing = false;
    syncPlaybackState();
  });

  // --- Electron tray menu → Player ---
  const unsubPlayPause = api.onTrayPlayPause(() => {
    if (player.isPlaying()) {
      player.pause();
    } else {
      player.resume();
    }
  });

  const unsubPrevious = api.onTrayPrevious(() => {
    window.dispatchEvent(new CustomEvent('electron:trayPrevious'));
  });

  const unsubNext = api.onTrayNext(() => {
    window.dispatchEvent(new CustomEvent('electron:trayNext'));
  });

  return {
    setAlwaysOnTop: (onTop) => api.setAlwaysOnTop(onTop),
    getAlwaysOnTop: () => api.getAlwaysOnTop(),
    setAutoStart: (enabled) => api.setAutoStart(enabled),
    getAutoStart: () => api.getAutoStart(),
    cleanup: () => {
      unsubPlayPause();
      unsubPrevious();
      unsubNext();
    },
  };
}
