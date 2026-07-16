// Wires the OS MediaSession (lock-screen / notification-shade controls) to
// the audio player. When this is attached, iOS Safari and Android Chrome
// surface a play/pause card showing the station + now-playing, and let the
// user control playback from headphones, AirPods, Apple Watch, car
// Bluetooth, etc.
//
// MediaSession is a no-op on browsers that don't implement it
// (e.g. Firefox Mobile prior to 130).

import { getLogoUrl } from '../data/logo-resolver.js';

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
    // Single-origin artwork: our logo CDN (re-encoded, immutable-cached), keyed
    // by UUID — not the station's third-party favicon. No `type` hint: the CDN
    // serves webp and the OS sniffs the real bytes.
    const logo = getLogoUrl(station, 512);
    if (logo) {
      out.push({ src: logo, sizes: '96x96 192x192 256x256 512x512' });
    }
    // Fallback to the RadioDock app icons so the lock screen never goes blank
    // (also covers a CDN 404 for stations with no cached logo).
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
