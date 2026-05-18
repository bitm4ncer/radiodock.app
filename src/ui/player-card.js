// Player card: station logo/initials, name, country, now-playing line,
// favorite heart, visit-station link, play/pause button, volume dots.

import { renderLogoSlot, mountLogoBehavior } from './station-logo.js';

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
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = playPauseBtn.querySelector('.play-icon');
  const pauseIcon = playPauseBtn.querySelector('.pause-icon');
  const bufferingIcon = playPauseBtn.querySelector('.buffering-icon');
  const volumeWrap = document.getElementById('volumeControls');

  let currentStation = null;
  let favoriteCallback = null;
  let infoCallback = null;

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
    if (!station) {
      nameEl.textContent = 'No station selected';
      nowPlayingTextEl.textContent = '';
      countryEl.textContent = '';
      logoBtn.innerHTML = '';
      visitBtn.style.display = 'none';
      infoBtn.style.display = 'none';
      favBtn.style.display = 'none';
      return;
    }
    nameEl.textContent = station.name ?? '';
    nowPlayingTextEl.textContent = '';
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
      visitBtn.style.display = '';
    } else {
      visitBtn.style.display = 'none';
    }
    infoBtn.style.display = '';
    favBtn.style.display = '';
  }

  function setNowPlaying(text) {
    const value = text ?? '';
    nowPlayingTextEl.textContent = value;
    // The .now-playing parent uses max-height: 0 by default so an empty
    // line doesn't take vertical space; flip on .show only when we have
    // actual text. Without this the metadata text was set in the DOM but
    // visually clipped to zero height on the mobile player.
    const wrap = nowPlayingTextEl.closest('.now-playing');
    wrap?.classList.toggle('show', value.length > 0);
    updateMarquee();
  }

  // Toggle the auto-scrolling marquee on the now-playing line when the
  // text is wider than the card can show. The default ellipsis state
  // stays for short text; once .is-marquee flips on, CSS runs the
  // keyframe animation that uses --marquee-shift + --marquee-duration
  // (set here from the measured overflow). Mobile has no hover, so an
  // automatic loop is the only way the full title is ever readable.
  function updateMarquee() {
    // Strip the state first so scrollWidth / clientWidth are measured
    // in the truncated layout — gives the actual overflow regardless
    // of whether the marquee was already running.
    nowPlayingTextEl.classList.remove('is-marquee');
    nowPlayingTextEl.style.removeProperty('--marquee-shift');
    nowPlayingTextEl.style.removeProperty('--marquee-duration');

    if (!nowPlayingTextEl.textContent) return;

    // Defer one frame so the .show transition has applied + layout
    // is stable. Without this the .now-playing parent's max-height
    // collapse can still be in flight and scrollWidth reads 0.
    requestAnimationFrame(() => {
      if (!nowPlayingTextEl.textContent) return;
      const overflow = nowPlayingTextEl.scrollWidth - nowPlayingTextEl.clientWidth;
      if (overflow <= 4) return; // Fits, no marquee needed.

      // Roughly 40 px/s scroll feels comfortable to read — matches the
      // iOS lock-screen now-playing marquee. Floor at 7 s so very short
      // overflows don't whip past, ceiling at 16 s for very long titles.
      const dur = Math.max(7, Math.min(16, 4 + overflow / 40));
      nowPlayingTextEl.style.setProperty('--marquee-shift', `-${overflow}px`);
      nowPlayingTextEl.style.setProperty('--marquee-duration', `${dur}s`);
      nowPlayingTextEl.classList.add('is-marquee');
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
  playPauseBtn.addEventListener('click', () => {
    if (!currentStation) return;
    haptic();
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
      player.playStation(currentStation);
      return;
    }
    // Audio is loaded and paused — just unpause.
    player.resume();
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
      dragging = true;
      volumeWrap.classList.add('is-dragging');
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
      try { volumeWrap.releasePointerCapture?.(evt.pointerId); } catch {}
    }

    volumeWrap.addEventListener('pointerdown', onDown);
    volumeWrap.addEventListener('pointermove', onMove);
    volumeWrap.addEventListener('pointerup', onUp);
    volumeWrap.addEventListener('pointercancel', onUp);
    volumeWrap.addEventListener('pointerleave', onUp);
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

  // Initial state
  setPlayState('play');
  setStation(null);

  return {
    setStation,
    setNowPlaying,
    setVolumePct,
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
