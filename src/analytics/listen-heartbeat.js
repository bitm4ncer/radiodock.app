// One listen-ping per minute of audible playback. Ping count per station
// in Umami equals listening minutes. `audible` gates out stall/rebuffer
// phases ('loading') that would otherwise count as listening because the
// element isn't paused while it rebuffers.
//
// Each ping also refreshes anonymous session data (umami.identify) with
// cumulative listening totals, so the Sessions view shows how long and
// what a session listened to without opening its event log.
//
// `track` and `identify` are injected rather than imported so this module
// stays loadable outside a Vite build (the analytics wrapper reads
// import.meta.env at module scope), which is what makes it testable.

// `capBackgroundMinutes`: a page left playing in a background tab pings forever
// (unattended) and would dominate listening stats. Once continuous background
// minutes exceed the cap, we stop counting; playback keeps going.
//
// What counts as attention is deliberately narrow: the page being foregrounded,
// or the user switching to a different station. A rebuffer is not attention, and
// neither is the recovery module re-playing the same station after a stall, even
// though both look like a fresh 'playing' + 'stationchange' from here. Treating
// them as attention is what previously kept the cap from ever tripping.
export function attachListenHeartbeat(player, {
  intervalMs = 60_000,
  capBackgroundMinutes = 480,
  track = () => {},
  identify = () => {},
} = {}) {
  let timer = null;
  let audible = false;
  let currentShow = null;
  let minutes = 0;
  let backgroundMinutes = 0;
  let continuousBackground = 0;
  let lastStationId = null;
  const stationsHeard = new Set();

  const tick = () => {
    if (!audible || !player.isPlaying()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    const background = document.visibilityState === 'hidden';
    // Foregrounding is the one unambiguous sign someone is there.
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
    identify({
      listenMinutes: minutes,
      backgroundMinutes,
      stationsPlayed: stationsHeard.size,
      lastStation: station.name ?? '',
      ...(currentShow ? { lastShow: currentShow } : {}),
    });
  };

  const start = () => {
    audible = true;
    // A rebuffer emits 'loading' then 'playing' again without ever clearing the
    // timer, so only reach for the timer when there isn't one. Nothing here
    // resets the background counter: starting playback is not evidence that
    // anyone is watching, and recovery restarts look identical from here.
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
  player.on('stationchange', (evt) => {
    currentShow = null;
    // playStation() emits stationchange on every call, including recovery's own
    // retries of the SAME station after a stall. Only an actual switch is a user
    // action (mirrors the same guard in player/recovery.js).
    const id = evt?.detail?.station?.id ?? null;
    if (lastStationId !== null && id !== lastStationId) continuousBackground = 0;
    lastStationId = id;
  });
  player.on('metadata', (evt) => {
    const d = evt.detail ?? {};
    if (d.source === 'placeholder') return;
    const display = d.nowPlaying || [d.artist, d.title].filter(Boolean).join(' – ');
    currentShow = display ? String(display).slice(0, 120) : null;
  });
}
