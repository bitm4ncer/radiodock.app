// Player card: station logo/initials, name, country, now-playing line,
// favorite heart, visit-station link, play/pause button, volume dots.

const VOLUME_LEVELS = [100, 80, 60, 40, 20, 0];

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
    volumeWrap.classList.remove(
      'volume-0',
      'volume-20',
      'volume-40',
      'volume-60',
      'volume-80',
      'volume-100',
    );
    // Find nearest VOLUME_LEVELS bucket
    const bucket = VOLUME_LEVELS.reduce((best, level) =>
      Math.abs(level - clamped) < Math.abs(best - clamped) ? level : best,
    );
    volumeWrap.classList.add(`volume-${bucket}`);
    volumeWrap.setAttribute('aria-valuenow', String(bucket));
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

  for (const dot of volumeWrap.querySelectorAll('.volume-dot')) {
    dot.addEventListener('click', (evt) => {
      const pct = parseInt(evt.currentTarget.dataset.volume, 10);
      player.setVolume(pct / 100);
      setVolumePct(pct);
    });
  }

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
    const { artist, title } = evt.detail;
    const text = [artist, title].filter(Boolean).join(' – ');
    if (text) setNowPlaying(text);
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
