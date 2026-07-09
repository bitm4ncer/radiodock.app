// One listen-ping per minute of audible playback. Ping count per station
// in Umami equals listening minutes. `audible` gates out stall/rebuffer
// phases ('loading') that would otherwise count as listening because the
// element isn't paused while it rebuffers.

import { track } from './umami.js';

export function attachListenHeartbeat(player, { intervalMs = 60_000 } = {}) {
  let timer = null;
  let audible = false;

  const tick = () => {
    if (!audible || !player.isPlaying()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    track('listen-ping', {
      station: station.name ?? '',
      country: station.countrycode ?? '',
      background: document.visibilityState === 'hidden' ? 'yes' : 'no',
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
}
