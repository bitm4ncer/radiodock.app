// Wires the OS MediaSession (lock-screen / notification-shade controls) to
// the audio player. When this is attached, iOS Safari and Android Chrome
// surface a play/pause card showing the station + now-playing, and let the
// user control playback from headphones, AirPods, Apple Watch, car
// Bluetooth, etc.
//
// MediaSession is a no-op on browsers that don't implement it
// (e.g. Firefox Mobile prior to 130).

export function attachMediaSession(player) {
  if (!('mediaSession' in navigator)) return;

  let currentStation = null;
  let currentNowPlaying = '';

  function update() {
    if (!currentStation) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    const title = currentNowPlaying || currentStation.name || 'RadioDock';
    const artist = currentNowPlaying ? currentStation.name : (currentStation.countrycode || 'RadioDock');
    const artwork = buildArtwork(currentStation);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album: 'RadioDock',
        artwork,
      });
    } catch (err) {
      console.warn('MediaSession metadata failed:', err);
    }
  }

  function buildArtwork(station) {
    const out = [];
    if (station.favicon) {
      // Most station favicons are small (16-128px). Browsers will scale, but
      // having one entry at multiple advertised sizes keeps them happy.
      out.push({ src: station.favicon, sizes: '96x96 192x192 256x256 512x512', type: 'image/png' });
    }
    // Fallback to the RadioDock app icons so the lock screen never goes blank.
    out.push({ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' });
    out.push({ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' });
    return out;
  }

  player.on('stationchange', (evt) => {
    currentStation = evt.detail.station;
    currentNowPlaying = '';
    update();
  });

  player.on('metadata', (evt) => {
    const { artist, title, nowPlaying } = evt.detail;
    const structured = [artist, title].filter(Boolean).join(' – ');
    currentNowPlaying = structured || nowPlaying || '';
    update();
  });

  player.on('playing', () => {
    navigator.mediaSession.playbackState = 'playing';
  });
  player.on('paused', () => {
    navigator.mediaSession.playbackState = 'paused';
  });
  player.on('stopped', () => {
    currentStation = null;
    currentNowPlaying = '';
    update();
  });

  // Action handlers — what happens when the user taps headphone buttons or
  // the lock-screen controls. previoustrack/nexttrack are wired in main.js
  // via the optional callbacks below; if not provided, the buttons are still
  // surfaced but do nothing (some platforms hide them in that case).
  navigator.mediaSession.setActionHandler('play', () => player.resume());
  navigator.mediaSession.setActionHandler('pause', () => player.pause());
  navigator.mediaSession.setActionHandler('stop', () => player.stop());

  let prevCb = null;
  let nextCb = null;

  return {
    setPreviousTrack(cb) {
      prevCb = cb;
      navigator.mediaSession.setActionHandler('previoustrack', cb ? () => cb() : null);
    },
    setNextTrack(cb) {
      nextCb = cb;
      navigator.mediaSession.setActionHandler('nexttrack', cb ? () => cb() : null);
    },
  };
}
