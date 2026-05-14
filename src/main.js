import './styles/index.css';
import { player } from './player/audio.js';
import { attachRecovery } from './player/recovery.js';

const app = document.getElementById('app');

app.innerHTML = `
  <section class="dev-shell">
    <header class="dev-shell__header">
      <h1>RadioDock</h1>
      <p class="dev-shell__status" id="status">Idle</p>
      <p class="dev-shell__now" id="now-playing"></p>
    </header>

    <div class="dev-shell__controls">
      <button id="play-pause" type="button" class="dev-shell__btn">Play</button>
      <input id="volume" type="range" min="0" max="1" step="0.05" value="0.7" />
    </div>

    <ul class="dev-shell__stations" id="stations" aria-label="Community stations">
      <li class="dev-shell__hint">Loading community stations…</li>
    </ul>
  </section>
`;

const statusEl = document.getElementById('status');
const nowEl = document.getElementById('now-playing');
const stationsEl = document.getElementById('stations');
const playPauseBtn = document.getElementById('play-pause');
const volumeEl = document.getElementById('volume');

attachRecovery(player);

player.on('loading', () => (statusEl.textContent = 'Loading…'));
player.on('playing', () => {
  statusEl.textContent = 'Playing';
  playPauseBtn.textContent = 'Pause';
});
player.on('paused', () => {
  statusEl.textContent = 'Paused';
  playPauseBtn.textContent = 'Play';
});
player.on('error', (evt) => {
  statusEl.textContent = `Error: ${evt.detail.message}`;
});
player.on('stationchange', (evt) => {
  nowEl.textContent = `${evt.detail.station.name}${evt.detail.station.countrycode ? ` · ${evt.detail.station.countrycode}` : ''}`;
});
player.on('metadata', (evt) => {
  const { artist, title } = evt.detail;
  const text = [artist, title].filter(Boolean).join(' – ');
  if (text) nowEl.textContent = text;
});

player.setVolume(parseFloat(volumeEl.value));
volumeEl.addEventListener('input', () => player.setVolume(parseFloat(volumeEl.value)));

playPauseBtn.addEventListener('click', () => {
  if (player.isPlaying()) {
    player.pause();
  } else {
    const station = player.getCurrentStation();
    if (station) player.resume();
  }
});

async function loadCommunityStations() {
  try {
    const res = await fetch('/community-radios.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStations(data.stations ?? []);
  } catch (err) {
    stationsEl.innerHTML = `<li class="dev-shell__hint dev-shell__hint--error">Failed to load stations: ${err.message}</li>`;
  }
}

function renderStations(stations) {
  if (!stations.length) {
    stationsEl.innerHTML = `<li class="dev-shell__hint">No stations.</li>`;
    return;
  }
  stationsEl.innerHTML = stations
    .map(
      (s) => `
        <li>
          <button type="button" class="dev-shell__station" data-id="${s.id}">
            <strong>${escapeHtml(s.name)}</strong>
            <span>${escapeHtml(s.countrycode ?? '')}</span>
          </button>
        </li>`,
    )
    .join('');

  stationsEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('[data-id]');
    if (!btn) return;
    const station = stations.find((s) => s.id === btn.dataset.id);
    if (station) player.playStation(station);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

loadCommunityStations();

// Expose for ad-hoc devtools tinkering during M1.
window.__radiodock = { player };
