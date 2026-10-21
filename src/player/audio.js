// Single-instance audio player.
// Wraps a <audio> element + dynamic hls.js for HLS streams.
// Emits events via a private EventTarget; consumers subscribe with on(event, handler).
import { relayHlsUrl, relayUrl } from '../data/relay.js';

const events = new EventTarget();
const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

const MEDIA_ERR_NAMES = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

let element = null;
let currentStation = null;
let hls = null;
let hlsModulePromise = null;
let playToken = 0;
let lastAudibleVolume = 0.8;
// Per-selection escalation state: after the direct source fails once, the
// server relay (uuid-only, stream URL resolved server-side) takes over —
// that is what rescues http-only streams on https origins, where the https
// upgrade silently fails on hosts that serve no TLS.
let currentUuid = '';
let currentIsHls = false;
let assignedSrc = '';
let relayTried = false;
let directFailed = false;
let escalationGraceUntil = 0;

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
  // Analytics-only signal. Recovery listens on the element directly and the
  // UI error state keys off playStation failures, so nothing else reacts.
  element.addEventListener('error', () => {
    const err = element.error;
    if (!err) return;
    emit('mediaerror', {
      code: err.code,
      name: MEDIA_ERR_NAMES[err.code] ?? `MEDIA_ERR_${err.code}`,
      message: err.message ?? '',
    });
    // A direct (non-relay) source that dies mid-play escalates to the relay
    // once. HLS errors arrive through the hls.js handler instead — the
    // element keeps a MediaSource blob here, so the src guard skips them.
    if (assignedSrc && element.getAttribute('src') === assignedSrc && !assignedSrc.includes('/api/relay')) {
      escalateThroughRelay(playToken);
    }
  });

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
  return /\.m3u8(\?|#|$)/i.test(url);
}

function isPlaylistUrl(url) {
  return /\.(?:pls|m3u|asx)(\?|#|$)/i.test(url);
}

// On https origins, http:// stream URLs are blocked as mixed content.
// Try the https variant first; hosts that serve no TLS on that port fail
// here and the relay escalation (below) takes the load over server-side.
function preferHttps(url) {
  if (typeof window !== 'undefined' && window.isSecureContext && url.startsWith('http://')) {
    return 'https://' + url.slice('http://'.length);
  }
  return url;
}

function relayFor(station) {
  const uuid = String(station?.stationuuid || station?.id || '');
  if (!uuid || typeof window === 'undefined' || !window.isSecureContext) return null;
  return relayUrl(uuid);
}

function relayHlsFor(station) {
  const uuid = String(station?.stationuuid || station?.id || '');
  if (!uuid || typeof window === 'undefined' || !window.isSecureContext) return null;
  return relayHlsUrl(uuid);
}

// hls.js setup for one source URL. Network and media fatals get one local
// recovery each before the ladder escalates. The relay HLS URL is a signed
// manifest proxy, so relative segment and key URIs work as well as absolute
// ones. Native HLS remains the Safari fallback.
async function startHlsSource(token, url) {
  const Hls = await loadHls();
  if (token !== playToken) return; // station changed during dynamic import

  const audio = getElement();
  if (Hls.isSupported()) {
    const instance = new Hls({
      enableWorker: true,
      maxBufferLength: 10,
      liveSyncDurationCount: 3,
      manifestLoadingTimeOut: 8000,
      levelLoadingTimeOut: 8000,
      fragLoadingTimeOut: 12000,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 2,
    });
    hls = instance;

    instance.on(Hls.Events.FRAG_PARSING_METADATA, (_evt, data) => {
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

    let recoveredNetwork = false;
    let recoveredMedia = false;
    instance.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data?.fatal || hls !== instance) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveredNetwork) {
        recoveredNetwork = true;
        instance.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
        recoveredMedia = true;
        instance.recoverMediaError();
        return;
      }
      if (escalateThroughRelay(token)) return;
      console.warn('hls fatal error, falling back to native src', data);
      destroyHls();
      assignedSrc = url;
      audio.src = url;
      audio.load();
      audio.play().catch((err) => {
        if (token !== playToken) return;
        emit('error', { message: err.message, name: err.name });
      });
    });

    instance.loadSource(url);
    instance.attachMedia(audio);
  } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    // iOS Safari native HLS
    assignedSrc = url;
    audio.src = url;
    audio.load();
  } else {
    throw new Error('HLS not supported in this browser');
  }
}

// One-shot escalation of the current load to the server relay. HLS uses the
// manifest proxy so relative segment URIs resolve server-side; native audio
// uses the byte relay. The grace window tells the recovery layer not to race
// this handoff with its own playStation retry.
function escalateThroughRelay(token) {
  if (token !== playToken) return false;
  const relay = currentIsHls ? relayHlsFor(currentStation) : relayFor(currentStation);
  if (!relay || relayTried) return false;
  relayTried = true;
  directFailed = true;
  escalationGraceUntil = Date.now() + 1500;
  destroyHls();
  const audio = getElement();
  if (currentIsHls) {
    startHlsSource(token, relay).catch((err) => {
      if (token !== playToken) return;
      emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
    });
  } else {
    assignedSrc = relay;
    audio.src = relay;
    audio.load();
    audio.play().catch((err) => {
      if (token !== playToken) return;
      emit('error', { message: err.message, name: err.name });
    });
  }
  return true;
}

async function playStation(station) {
  if (!station || !station.url) {
    emit('error', { message: 'Invalid station' });
    return;
  }

  const token = ++playToken;
  const uuid = String(station.stationuuid || station.id || '');
  if (uuid !== currentUuid || station.url !== currentStation?.url) {
    relayTried = false;
    directFailed = false;
    escalationGraceUntil = 0;
  }
  currentStation = station;
  currentUuid = uuid;
  emit('stationchange', { station });
  emit('loading');

  const audio = getElement();
  destroyHls();

  try {
    audio.pause();
  } catch {}

  try {
    const streamUrl = preferHttps(station.url);
    currentIsHls = isHlsUrl(station.url) || isHlsUrl(streamUrl);
    const relay = currentIsHls ? relayHlsFor(station) : relayFor(station);
    // A previous attempt for this station already died on the direct source
    // (this load or a recovery retry) — go straight to the relay instead of
    // burning another round on a known-dead URL. Playlist files are not audio
    // either, so let the relay resolve those first.
    const useRelayFirst = Boolean(relay && (directFailed || isPlaylistUrl(station.url)));
    const source = useRelayFirst ? relay : streamUrl;
    relayTried = relayTried || useRelayFirst;

    if (currentIsHls) {
      await startHlsSource(token, source);
    } else {
      assignedSrc = source;
      audio.src = source;
      audio.load();
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
  } catch (err) {
    if (token !== playToken) return; // superseded by a newer call
    // One immediate escalation before surfacing the error, so an http-only
    // host without TLS still starts on the first tap.
    if (escalateThroughRelay(token)) return;
    console.warn('playStation failed:', err);
    emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
  }
}

function pause() {
  const audio = getElement();
  audio.pause();
}

function resume() {
  // Live radio has no meaningful "paused position". While paused, the <audio>
  // element keeps the buffer captured at pause time, so audio.play() would
  // replay that stale audio and then glitch as the browser scrambles back to
  // the live edge. Always reconnect so play rejoins the live stream — a fresh
  // load() drops the old buffer and refetches from now. Covers both the plain
  // HTTP branch and HLS (playStation tears down and recreates hls.js).
  if (currentStation) {
    return playStation(currentStation);
  }
  return getElement().play().catch((err) => emit('error', { message: err.message, name: err.name }));
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
  currentUuid = '';
  assignedSrc = '';
  relayTried = false;
  directFailed = false;
  escalationGraceUntil = 0;
  emit('stopped');
}

function setVolume(level) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  if (v > 0) lastAudibleVolume = v;
  getElement().volume = v;
}

function getVolume() {
  return getElement().volume;
}

function toggleMute() {
  const el = getElement();
  el.volume = el.volume > 0 ? 0 : lastAudibleVolume;
}

function getCurrentStation() {
  return currentStation;
}

function isPlaying() {
  return Boolean(element) && !element.paused;
}

function isEscalating() {
  return Date.now() < escalationGraceUntil;
}

function on(type, handler) {
  events.addEventListener(type, handler);
  return () => events.removeEventListener(type, handler);
}

// Warm the hls.js dynamic import without playing anything, so the ~520 kB
// download doesn't sit between the user's tap and the first audio.
function prefetchHls() {
  loadHls().catch(() => {});
}

export const player = {
  playStation,
  pause,
  resume,
  stop,
  setVolume,
  toggleMute,
  getVolume,
  getCurrentStation,
  isPlaying,
  isEscalating,
  on,
  prefetchHls,
  isHlsUrl,
  // exposed for recovery + metadata-poller modules
  _element: getElement,
  events,
};
