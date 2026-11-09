// Wires the OS MediaSession (lock-screen / notification-shade controls) to
// the audio player. When this is attached, iOS Safari and Android Chrome
// surface a play/pause card showing the station + now-playing, and let the
// user control playback from headphones, AirPods, Apple Watch, car
// Bluetooth, etc.
//
// MediaSession is a no-op on browsers that don't implement it
// (e.g. Firefox Mobile prior to 130).

import { getLogoUrl } from '../data/logo-resolver.js';
import { decodeHtmlEntities } from '../data/html-entities.js';
import { recallMetadata } from '../data/metadata-cache.js';

export function attachMediaSession(player) {
  if (!('mediaSession' in navigator)) return;

  let currentStation = null;
  let currentNowPlaying = '';

  function formatNowPlaying(data) {
    if (!data) return '';
    const structured = [data.artist, data.title].filter(Boolean).join(' - ');
    return structured || data.nowPlaying || '';
  }

  function update() {
    if (!currentStation) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    const stationName = decodeHtmlEntities(currentStation.name || 'RadioDock');
    const nowPlaying = decodeHtmlEntities(currentNowPlaying);
    const title = nowPlaying || stationName || 'RadioDock';
    // Never put the country code on the lock screen; before the first metadata
    // response it reads as "station / country" and never changes while the app
    // is backgrounded. The brand is a stable placeholder and the real
    // now-playing line replaces it as soon as the poller answers.
    const artist = nowPlaying ? stationName : 'RadioDock';
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
    // Read the memo synchronously: a lock-screen next/previous switch has no
    // chance to wait for a fresh proxy response before iOS paints the card.
    currentNowPlaying = formatNowPlaying(recallMetadata(currentStation.id));
    update();
  });

  player.on('metadata', (evt) => {
    const { artist, title, nowPlaying } = evt.detail;
    const structured = [artist, title].filter(Boolean).join(' - ');
    currentNowPlaying = decodeHtmlEntities(structured || nowPlaying || '');
    update();
  });

  player.on('playing', () => {
    navigator.mediaSession.playbackState = 'playing';
    // Re-apply the metadata after the audio session transitions; iOS otherwise
    // keeps the pre-switch card in some background hand-offs.
    update();
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
  // iOS only honours handlers registered after the media element has become
  // the Now Playing item; handlers set at startup are ignored and iOS falls
  // back to its default ±10 s skip buttons. Re-registering on every `playing`
  // event (and after an app switch) makes the previous/next arrows appear.
  // The seek actions are explicitly cleared because live radio cannot seek.
  let prevCb = null;
  let nextCb = null;

  function setActionHandler(action, handler) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Unsupported action in this browser — ignore it rather than losing the
      // handlers that do exist.
    }
  }

  function registerActionHandlers() {
    setActionHandler('play', () => player.resume());
    setActionHandler('pause', () => player.pause());
    setActionHandler('stop', () => player.stop());
    setActionHandler('previoustrack', () => { prevCb?.(); });
    setActionHandler('nexttrack', () => { nextCb?.(); });
    setActionHandler('seekbackward', null);
    setActionHandler('seekforward', null);
    setActionHandler('seekto', null);
  }

  registerActionHandlers();
  // A short delayed refresh matters on iOS: the Now Playing item can be
  // established just after `playing`, and handlers registered in the same tick
  // are then discarded again. 250 ms is enough to land after it.
  let refreshTimer = null;
  const refreshActionHandlers = () => {
    registerActionHandlers();
    if (typeof setTimeout !== 'function') return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(registerActionHandlers, 250);
  };
  player.on('playing', refreshActionHandlers);
  player.on('stationchange', refreshActionHandlers);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshActionHandlers();
    });
  }

  return {
    setPreviousTrack(cb) {
      prevCb = cb;
      registerActionHandlers();
    },
    setNextTrack(cb) {
      nextCb = cb;
      registerActionHandlers();
    },
  };
}
