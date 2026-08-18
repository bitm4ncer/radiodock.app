// Player card: station logo/initials, name, country, now-playing line,
// favorite heart, visit-station link, play/pause button, volume dots.

import { renderLogoSlot, mountLogoBehavior } from './station-logo.js';
import { trackStationPlay } from '../analytics/umami.js';

// Volume buckets — 11 steps in 10% increments (one per dot).
const VOLUME_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function mountPlayerCard({ player }) {
  const logoBtn = document.getElementById('stationLogoBtn');
  const nameEl = document.getElementById('stationName');
  const nowPlayingTextEl = document.getElementById('nowPlayingText');
  const countryEl = document.getElementById('stationCountry');
  const visitBtn = document.getElementById('visitStationBtn');
  const infoBtn = document.getElementById('stationInfoBtn');
  const favBtn = document.getElementById('addToFavoritesBtn');
  const actionBar = document.getElementById('playerActionBar');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = playPauseBtn.querySelector('.play-icon');
  const pauseIcon = playPauseBtn.querySelector('.pause-icon');
  const bufferingIcon = playPauseBtn.querySelector('.buffering-icon');
  const volumeWrap = document.getElementById('volumeControls');
  const muteBtn = document.getElementById('volumeMuteBtn');

  let currentStation = null;
  let favoriteCallback = null;
  let infoCallback = null;

  // Now-playing scroll state. Hover devices get the extension's
  // single hover-transition; touch devices get one auto-pass per new
  // title plus tap-to-replay. lastNowPlaying dedupes the metadata
  // poller so an unchanged title never restarts the slide mid-flight.
  const canHover = window.matchMedia?.('(hover: hover)').matches ?? false;
  let lastNowPlaying = '';
  let autoPassTimer = null;

  // Tiny haptic tap on the main interactions. navigator.vibrate is
  // Android/Chromium only — iOS Safari ignores it silently — so this is
  // gracefully no-op on iOS without needing a UA check.
  function haptic(ms = 10) {
    try { navigator.vibrate?.(ms); } catch {}
  }

  // Wire the long-press / hover-to-cycle behaviour for the big logo.
  // Player-card uses the large logo classnames so size-specific rules
  // (visualizer.css minimised state, player-card.css :hover scale) keep
  // applying as before.
  mountLogoBehavior(logoBtn, {
    imgClass: 'station-logo',
    initialsClass: 'station-initials',
  });

  function setPlayState(state /* 'play' | 'pause' | 'buffering' */) {
    playIcon.style.display = state === 'play' ? '' : 'none';
    pauseIcon.style.display = state === 'pause' ? '' : 'none';
    bufferingIcon.style.display = state === 'buffering' ? '' : 'none';
    playPauseBtn.setAttribute('aria-label', state === 'pause' ? 'Pause' : 'Play');
  }

  function setStation(station) {
    currentStation = station;
    // Reset the now-playing line on every station swap. Without this the
    // .show class lingers across stations and a blank metadata line
    // wedges between the title and the country / URL row instead of
    // collapsing flat under the title like the extension does.
    nowPlayingTextEl.textContent = '';
    lastNowPlaying = '';
    nowPlayingTextEl.closest('.now-playing')?.classList.remove('show');
    resetScroll();
    if (!station) {
      nameEl.textContent = 'No station selected';
      countryEl.textContent = '';
      logoBtn.innerHTML = '';
      visitBtn.style.display = 'none';
      infoBtn.style.display = 'none';
      favBtn.style.display = 'none';
      if (actionBar) actionBar.style.display = 'none';
      return;
    }
    nameEl.textContent = station.name ?? '';
    countryEl.textContent = station.countrycode ?? '';

    // The MutationObserver in mountLogoBehavior picks the new slot up
    // and runs the fallback chain (override → original → DDG → initials).
    logoBtn.innerHTML = renderLogoSlot(station, {
      imgClass: 'station-logo',
      initialsClass: 'station-initials',
      size: 'lg',
    });

    if (station.homepage) {
      visitBtn.href = station.homepage;
      // Show the bare hostname (stripped of www.) so the row reads like
      // the Chrome extension's player card — looks intentional even
      // before any now-playing metadata lands.
      visitBtn.textContent = hostnameFor(station.homepage);
      visitBtn.style.display = '';
    } else {
      visitBtn.style.display = 'none';
    }
    infoBtn.style.display = '';
    favBtn.style.display = '';
    if (actionBar) actionBar.style.display = '';
  }

  function hostnameFor(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function setNowPlaying(text) {
    const value = text ?? '';
    const changed = value !== lastNowPlaying;
    lastNowPlaying = value;
    nowPlayingTextEl.textContent = value;
    // The .now-playing parent uses max-height: 0 by default so an empty
    // line doesn't take vertical space; flip on .show only when we have
    // actual text. Without this the metadata text was set in the DOM but
    // visually clipped to zero height on the mobile player.
    const wrap = nowPlayingTextEl.closest('.now-playing');
    wrap?.classList.toggle('show', value.length > 0);
    // Only re-measure / re-trigger when the title actually changed. The
    // metadata poller re-sends the same string every few seconds; without
    // this guard that restarts the slide mid-flight (the visible "jump").
    if (changed) updateScroll();
  }

  function resetScroll() {
    clearTimeout(autoPassTimer);
    nowPlayingTextEl.classList.remove('can-scroll', 'scroll-once');
    nowPlayingTextEl.style.removeProperty('--scroll-distance');
    nowPlayingTextEl.style.removeProperty('--scroll-duration');
    nowPlayingTextEl.style.removeProperty('--pass-duration');
  }

  // Restart the touch one-shot pass from the top. Removing the class and
  // forcing a reflow before re-adding is what makes the animation replay.
  function runOnePass() {
    if (canHover) return;
    if (!nowPlayingTextEl.style.getPropertyValue('--scroll-distance')) return;
    nowPlayingTextEl.classList.remove('scroll-once');
    void nowPlayingTextEl.offsetWidth;
    nowPlayingTextEl.classList.add('scroll-once');
  }

  // Measure the now-playing line and, if it overflows the card, arm the
  // right scroll behaviour for the device: a hover-transition on desktop
  // (see .player-card:hover CSS) or a single auto-pass on touch.
  function updateScroll() {
    // Strip prior state first so scrollWidth / clientWidth are measured
    // in the truncated layout — gives the true overflow regardless of
    // whether a scroll was already armed.
    resetScroll();
    if (!nowPlayingTextEl.textContent) return;

    // Defer one frame so the .show transition has applied + layout is
    // stable. Without this the .now-playing parent's max-height collapse
    // can still be in flight and scrollWidth reads 0.
    requestAnimationFrame(() => {
      if (!nowPlayingTextEl.textContent) return;
      const overflow = nowPlayingTextEl.scrollWidth - nowPlayingTextEl.clientWidth;
      if (overflow <= 4) return; // Fits, no scroll needed.

      // ~50 px/s outbound feels readable and matches the extension.
      const distance = overflow + 12; // small trailing gap past the last glyph
      const legDur = Math.max(2.5, distance / 50);
      nowPlayingTextEl.style.setProperty('--scroll-distance', `-${distance}px`);
      nowPlayingTextEl.style.setProperty('--scroll-duration', `${legDur}s`);

      if (canHover) {
        nowPlayingTextEl.classList.add('can-scroll');
      } else {
        // The keyframe's outbound leg spans 10%→50% (40% of the run), so
        // total = legDur / 0.4 keeps the outbound speed at ~50 px/s.
        nowPlayingTextEl.style.setProperty('--pass-duration', `${(legDur / 0.4).toFixed(2)}s`);
        autoPassTimer = setTimeout(runOnePass, 1500);
      }
    });
  }

  // Touch: settle back to ellipsis once a pass finishes, and let a tap on
  // the line replay it. Registered once — mountPlayerCard runs once.
  if (!canHover) {
    nowPlayingTextEl.addEventListener('animationend', (e) => {
      if (e.animationName === 'now-playing-scroll-once') {
        nowPlayingTextEl.classList.remove('scroll-once');
      }
    });
    nowPlayingTextEl.addEventListener('click', () => {
      clearTimeout(autoPassTimer);
      runOnePass();
    });
  }

  function setVolumePct(pct) {
    const clamped = Math.max(0, Math.min(100, pct | 0));
    // Snap to nearest 10% bucket (matches the dot grid).
    const bucket = Math.round(clamped / 10) * 10;
    volumeWrap.setAttribute('aria-valuenow', String(bucket));
    // Light up every dot whose data-volume ≤ current bucket.
    for (const dot of volumeWrap.querySelectorAll('.volume-dot')) {
      const dv = parseInt(dot.dataset.volume, 10);
      dot.classList.toggle('is-filled', dv <= bucket);
    }
  }

  // Wire interactions
  function togglePlayPause() {
    if (!currentStation) return;
    if (player.isPlaying()) {
      player.pause();
      return;
    }
    // If the audio module's current station doesn't match the UI's current
    // station, we don't have a stream loaded yet — e.g. just after page
    // reload, where main.js restored the station from prefs into the player
    // card UI but never actually called playStation. Start it fresh.
    const audioStation = player.getCurrentStation();
    if (!audioStation || audioStation.id !== currentStation.id) {
      // A real station start, not a resume: without this the most common case of
      // all (reload, press play on the restored station) recorded listening
      // minutes with zero plays.
      trackStationPlay(currentStation, 'player-card');
      player.playStation(currentStation);
      return;
    }
    // Audio is loaded and paused — just unpause.
    player.resume();
  }

  playPauseBtn.addEventListener('click', () => {
    haptic();
    togglePlayPause();
  });

  // Volume "slider but as separate dots": pointer drag picks the dot
  // under (or closest to) the pointer and sets volume continuously.
  // Mobile hides .volume-controls via display:none (hardware volume +
  // MediaSession take over), so skip wiring entirely on small viewports —
  // the listeners would never fire on a hidden element and the dot lookup
  // is wasted work.
  if (matchMedia('(min-width: 700px)').matches) (() => {
    const dots = Array.from(volumeWrap.querySelectorAll('.volume-dot'));
    let dragging = false;

    function dotAtPoint(x, y) {
      // First try the element directly under the pointer.
      const hit = document.elementFromPoint(x, y);
      const direct = hit?.closest?.('.volume-dot');
      if (direct && dots.includes(direct)) return direct;
      // Fall back to the closest dot by centre distance — keeps the drag
      // tracking the cursor even between dots.
      let best = null;
      let bestDist = Infinity;
      for (const dot of dots) {
        const r = dot.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestDist) { bestDist = d; best = dot; }
      }
      return best;
    }

    function setFromPoint(x, y) {
      const dot = dotAtPoint(x, y);
      if (!dot) return;
      const pct = parseInt(dot.dataset.volume, 10);
      player.setVolume(pct / 100);
      setVolumePct(pct);
    }

    function onDown(evt) {
      // Ignore non-primary mouse buttons.
      if (evt.button !== undefined && evt.button !== 0) return;
      // Presses on the mute button belong to its click handler, not the drag.
      if (evt.target.closest('.volume-mute-btn')) return;
      dragging = true;
      volumeWrap.classList.add('is-dragging');
      document.documentElement.classList.add('volume-dragging');
      try { volumeWrap.setPointerCapture?.(evt.pointerId); } catch {}
      setFromPoint(evt.clientX, evt.clientY);
      evt.preventDefault();
    }
    function onMove(evt) {
      if (!dragging) return;
      setFromPoint(evt.clientX, evt.clientY);
    }
    function onUp(evt) {
      if (!dragging) return;
      dragging = false;
      volumeWrap.classList.remove('is-dragging');
      document.documentElement.classList.remove('volume-dragging');
      try { volumeWrap.releasePointerCapture?.(evt.pointerId); } catch {}
    }

    volumeWrap.addEventListener('pointerdown', onDown);
    volumeWrap.addEventListener('pointermove', onMove);
    volumeWrap.addEventListener('pointerup', onUp);
    volumeWrap.addEventListener('pointercancel', onUp);
    volumeWrap.addEventListener('pointerleave', onUp);

    volumeWrap.addEventListener(
      'wheel',
      (evt) => {
        evt.preventDefault();
        const step = evt.deltaY < 0 ? 0.1 : -0.1;
        const next = Math.max(0, Math.min(1, player.getVolume() + step));
        player.setVolume(Math.round(next * 10) / 10);
      },
      { passive: false },
    );
  })();

  logoBtn.addEventListener('click', () => {
    if (currentStation?.homepage) {
      window.open(currentStation.homepage, '_blank', 'noopener');
    }
  });

  favBtn.addEventListener('click', () => {
    haptic();
    favoriteCallback?.(currentStation);
  });

  muteBtn?.addEventListener('click', () => {
    haptic();
    player.toggleMute();
  });

  infoBtn.addEventListener('click', () => {
    if (!currentStation) return;
    haptic();
    infoCallback?.(currentStation);
  });

  // Subscribe to player events
  player.on('stationchange', (evt) => setStation(evt.detail.station));
  player.on('playing', () => setPlayState('pause'));
  player.on('paused', () => setPlayState('play'));
  player.on('loading', () => setPlayState('buffering'));
  player.on('metadata', (evt) => {
    const { artist, title, nowPlaying } = evt.detail;
    // Prefer the structured artist + title; fall back to the proxy's free-form
    // `display` string (e.g. "Offline", station-specific show name).
    const structured = [artist, title].filter(Boolean).join(' – ');
    const text = structured || nowPlaying || '';
    setNowPlaying(text);
  });
  player.on('error', () => setPlayState('play'));
  player.on('volumechange', (evt) => {
    const muted = evt.detail.volume === 0;
    muteBtn?.classList.toggle('is-muted', muted);
    muteBtn?.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    muteBtn?.setAttribute('title', muted ? 'Unmute (M)' : 'Mute (M)');
  });

  // Initial state
  setPlayState('play');
  setStation(null);

  return {
    setStation,
    setNowPlaying,
    setVolumePct,
    togglePlayPause,
    onFavoriteClick(cb) {
      favoriteCallback = cb;
    },
    onInfoClick(cb) {
      infoCallback = cb;
    },
    setFavoriteState(isFavorited) {
      favBtn.classList.toggle('is-favorited', !!isFavorited);
    },
  };
}
