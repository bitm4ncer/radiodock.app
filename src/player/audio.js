// Single-instance audio player.
// Wraps a <audio> element + dynamic hls.js for HLS streams.
// Emits events via a private EventTarget; consumers subscribe with on(event, handler).

const events = new EventTarget();
const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

let element = null;
let currentStation = null;
let hls = null;
let hlsModulePromise = null;
let playToken = 0;

function getElement() {
  if (element) return element;
  element = document.createElement('audio');
  element.id = 'radiodock-audio';
  element.preload = 'none';
  element.playsInline = true;
  document.body.append(element);

  element.addEventListener('playing', () => emit('playing'));
  element.addEventListener('pause', () => emit('paused'));
  element.addEventListener('waiting', () => emit('loading'));
  element.addEventListener('canplay', () => emit('canplay'));
  element.addEventListener('volumechange', () => emit('volumechange', { volume: element.volume }));

  return element;
}

async function loadHls() {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js').then((m) => m.default);
  }
  return hlsModulePromise;
}

function destroyHls() {
  if (!hls) return;
  try {
    hls.destroy();
  } catch (err) {
    console.warn('hls.destroy failed:', err);
  }
  hls = null;
}

function isHlsUrl(url) {
  return /\.m3u8(\?|$)/i.test(url);
}

// On https origins, http:// stream URLs are blocked as mixed content.
// Try the https variant first; if it fails, the recovery layer retries with
// the original (which will only succeed on http origins like localhost).
function preferHttps(url) {
  if (typeof window !== 'undefined' && window.isSecureContext && url.startsWith('http://')) {
    return 'https://' + url.slice('http://'.length);
  }
  return url;
}

async function playStation(station) {
  if (!station || !station.url) {
    emit('error', { message: 'Invalid station' });
    return;
  }

  const token = ++playToken;
  currentStation = station;
  emit('stationchange', { station });
  emit('loading');

  const audio = getElement();
  destroyHls();

  try {
    audio.pause();
  } catch {}

  try {
    const streamUrl = preferHttps(station.url);

    if (isHlsUrl(streamUrl)) {
      const Hls = await loadHls();
      if (token !== playToken) return; // station changed during dynamic import

      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, maxBufferLength: 10 });

        hls.on(Hls.Events.FRAG_PARSING_METADATA, (_evt, data) => {
          const samples = data?.samples ?? [];
          for (const sample of samples) {
            const frames = sample?.data;
            if (!frames || typeof frames !== 'object') continue;
            const title = frames.TIT2?.data ?? null;
            const artist = frames.TPE1?.data ?? null;
            if (title || artist) {
              emit('metadata', { artist, title, source: 'hls-id3' });
            }
          }
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data?.fatal) return;
          console.warn('hls fatal error, falling back to native src', data);
          destroyHls();
          audio.src = streamUrl;
          audio.load();
          audio.play().catch((err) => emit('error', { message: err.message }));
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(audio);
      } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        // iOS Safari native HLS
        audio.src = streamUrl;
        audio.load();
      } else {
        throw new Error('HLS not supported in this browser');
      }
    } else {
      audio.src = streamUrl;
      audio.load();
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
  } catch (err) {
    if (token !== playToken) return; // superseded by a newer call
    console.warn('playStation failed:', err);
    emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
  }
}

function pause() {
  const audio = getElement();
  audio.pause();
}

function resume() {
  const audio = getElement();
  if (!audio.src && !hls && currentStation) {
    // Lost source (e.g. after an error reset). Re-load.
    return playStation(currentStation);
  }
  return audio.play().catch((err) => emit('error', { message: err.message, name: err.name }));
}

function stop() {
  playToken++;
  destroyHls();
  const audio = getElement();
  try {
    audio.pause();
  } catch {}
  audio.removeAttribute('src');
  audio.load();
  currentStation = null;
  emit('stopped');
}

function setVolume(level) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  getElement().volume = v;
}

function getVolume() {
  return getElement().volume;
}

function getCurrentStation() {
  return currentStation;
}

function isPlaying() {
  return Boolean(element) && !element.paused;
}

function on(type, handler) {
  events.addEventListener(type, handler);
  return () => events.removeEventListener(type, handler);
}

export const player = {
  playStation,
  pause,
  resume,
  stop,
  setVolume,
  getVolume,
  getCurrentStation,
  isPlaying,
  on,
  // exposed for recovery + metadata-poller modules
  _element: getElement,
  events,
};
