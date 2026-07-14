// Electron native-feature bridge for the RadioDock PWA.
//
// Detects window.electronAPI (injected by Electron's preload script).
// When running inside the desktop wrapper, this module:
//   1. Syncs playback state → tray icon + context menu
//   2. Listens for tray menu actions (play/pause, next station)
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

  let playing = false;
  let currentStation = null;

  function syncPlaybackState() {
    api.updatePlayback({ playing, station: currentStation });
    updateTrayIcon();
  }

  function updateTrayIcon() {
    if (!playing) {
      api.setTrayIcon(null); // fall back to static tray icon
      return;
    }
    // Draw tray icon with playback indicator using Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Use the app's icon as base
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = '/icons/icon-192.png';
    img.onload = () => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(img, 0, 0, 64, 64);
      // Red indicator dot (bottom-right)
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
    player.togglePlayPause();
  });

  const unsubNext = api.onTrayNext(() => {
    // Jump to next station in the active list — delegated to main.js
    // via a custom event that main.js listens for.
    window.dispatchEvent(new CustomEvent('electron:trayNext'));
  });

  // --- Always-on-top control ---
  async function setAlwaysOnTop(onTop) {
    const result = await api.setAlwaysOnTop(onTop);
    return result;
  }

  async function getAlwaysOnTop() {
    return api.getAlwaysOnTop();
  }

  // --- Auto-start control ---
  async function setAutoStart(enabled) {
    return api.setAutoStart(enabled);
  }

  async function getAutoStart() {
    return api.getAutoStart();
  }

  const cleanup = () => {
    unsubPlayPause();
    unsubNext();
  };

  return {
    setAlwaysOnTop,
    getAlwaysOnTop,
    setAutoStart,
    getAutoStart,
    cleanup,
  };
}
