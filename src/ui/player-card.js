// Player card: station logo/initials, name, country, now-playing line,
// favorite heart, visit-station link, play/pause button, volume dots.

// Volume buckets — 11 steps in 10% increments (one per dot).
const VOLUME_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
}

export function mountPlayerCard({ player }) {
  const logoBtn = document.getElementById('stationLogoBtn');
  const logoImg = document.getElementById('stationLogo');
  const initialsEl = document.getElementById('stationInitials');
  const nameEl = document.getElementById('stationName');
  const nowPlayingTextEl = document.getElementById('nowPlayingText');
  const countryEl = document.getElementById('stationCountry');
  const visitBtn = document.getElementById('visitStationBtn');
  const favBtn = document.getElementById('addToFavoritesBtn');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const playIcon = playPauseBtn.querySelector('.play-icon');
  const pauseIcon = playPauseBtn.querySelector('.pause-icon');
  const bufferingIcon = playPauseBtn.querySelector('.buffering-icon');
  const volumeWrap = document.getElementById('volumeControls');

  let currentStation = null;
  let favoriteCallback = null;

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
      logoImg.style.display = 'none';
      initialsEl.textContent = '';
      visitBtn.style.display = 'none';
      favBtn.style.display = 'none';
      return;
    }
    nameEl.textContent = station.name ?? '';
    nowPlayingTextEl.textContent = '';
    countryEl.textContent = station.countrycode ?? '';

    if (station.favicon) {
      logoImg.src = station.favicon;
      logoImg.alt = station.name ?? '';
      logoImg.style.display = '';
      initialsEl.style.display = 'none';
      logoImg.onerror = () => {
        logoImg.style.display = 'none';
        initialsEl.style.display = '';
        initialsEl.textContent = getInitials(station.name);
      };
    } else {
      logoImg.style.display = 'none';
      initialsEl.style.display = '';
      initialsEl.textContent = getInitials(station.name);
    }

    if (station.homepage) {
      visitBtn.href = station.homepage;
      visitBtn.style.display = '';
    } else {
      visitBtn.style.display = 'none';
    }
    favBtn.style.display = '';
  }

  function setNowPlaying(text) {
    nowPlayingTextEl.textContent = text ?? '';
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
    if (player.isPlaying()) {
      player.pause();
    } else {
      player.resume();
    }
  });

  // Volume "slider but as separate dots": pointer drag picks the dot
  // under (or closest to) the pointer and sets volume continuously.
  (() => {
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
    favoriteCallback?.(currentStation);
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
    setFavoriteState(isFavorited) {
      favBtn.classList.toggle('is-favorited', !!isFavorited);
    },
  };
}
