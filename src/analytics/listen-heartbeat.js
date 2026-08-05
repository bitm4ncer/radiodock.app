// One listen-ping per minute of audible playback. Ping count per station
// in Umami equals listening minutes. `audible` gates out stall/rebuffer
// phases ('loading') that would otherwise count as listening because the
// element isn't paused while it rebuffers.
//
// Each ping also refreshes anonymous session data (umami.identify) with
// cumulative listening totals, so the Sessions view shows how long and
// what a session listened to without opening its event log.

import { track, identifySession } from './umami.js';

// `capBackgroundMinutes`: a page left playing in a background tab pings forever
// (unattended) and would dominate listening stats. Once continuous background
// minutes (no foregrounding, no station change) exceed the cap, we stop
// counting — playback keeps going. Foregrounding or switching station resets
// the counter, so normal minimized-tab radio listening is unaffected.
export function attachListenHeartbeat(player, { intervalMs = 60_000, capBackgroundMinutes = 480 } = {}) {
  let timer = null;
  let audible = false;
  let currentShow = null;
  let minutes = 0;
  let backgroundMinutes = 0;
  let continuousBackground = 0;
  const stationsHeard = new Set();

  const tick = () => {
    if (!audible || !player.isPlaying()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    const background = document.visibilityState === 'hidden';
    continuousBackground = background ? continuousBackground + 1 : 0;
    // Unattended background tab past the cap: stop counting (keep playing).
    if (background && continuousBackground > capBackgroundMinutes) return;
    minutes += 1;
    if (background) backgroundMinutes += 1;
    stationsHeard.add(station.name ?? '');
    track('listen-ping', {
      station: station.name ?? '',
      uuid: station.id ?? '',
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
    continuousBackground = 0; // fresh playback is attended
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
    continuousBackground = 0; // switching station is an attended action
  });
  player.on('metadata', (evt) => {
    const d = evt.detail ?? {};
    if (d.source === 'placeholder') return;
    const display = d.nowPlaying || [d.artist, d.title].filter(Boolean).join(' – ');
    currentShow = display ? String(display).slice(0, 120) : null;
  });
}
