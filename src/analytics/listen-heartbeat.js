// One listen-ping per minute of audible playback. Ping count per station
// in Umami equals listening minutes. `audible` gates out stall/rebuffer
// phases ('loading') that would otherwise count as listening because the
// element isn't paused while it rebuffers.
//
// Each ping also refreshes anonymous session data (umami.identify) with
// cumulative listening totals, so the Sessions view shows how long and
// what a session listened to without opening its event log.

import { track, identifySession } from './umami.js';

export function attachListenHeartbeat(player, { intervalMs = 60_000 } = {}) {
  let timer = null;
  let audible = false;
  let currentShow = null;
  let minutes = 0;
  let backgroundMinutes = 0;
  const stationsHeard = new Set();

  const tick = () => {
    if (!audible || !player.isPlaying()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    const background = document.visibilityState === 'hidden';
    minutes += 1;
    if (background) backgroundMinutes += 1;
    stationsHeard.add(station.name ?? '');
    track('listen-ping', {
      station: station.name ?? '',
      country: station.countrycode ?? '',
      background: background ? 'yes' : 'no',
      ...(currentShow ? { show: currentShow } : {}),
    });
    identifySession({
      listenMinutes: minutes,
      backgroundMinutes,
      stationsPlayed: stationsHeard.size,
      lastStation: station.name ?? '',
      ...(currentShow ? { lastShow: currentShow } : {}),
    });
  };

  const start = () => {
    audible = true;
    if (!timer) timer = setInterval(tick, intervalMs);
  };

  const stop = () => {
    audible = false;
    if (timer) clearInterval(timer);
    timer = null;
  };

  player.on('playing', start);
  player.on('loading', () => {
    audible = false;
  });
  player.on('paused', stop);
  player.on('stopped', stop);
  player.on('error', stop);

  // Show/track names arrive via the metadata poller (and HLS ID3). Reset on
  // station change so a ping never attributes the previous station's show to
  // the new one while its first metadata response is still in flight.
  player.on('stationchange', () => {
    currentShow = null;
  });
  player.on('metadata', (evt) => {
    const d = evt.detail ?? {};
    if (d.source === 'placeholder') return;
    const display = d.nowPlaying || [d.artist, d.title].filter(Boolean).join(' – ');
    currentShow = display ? String(display).slice(0, 120) : null;
  });
}
