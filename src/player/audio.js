// Single-instance audio player.
// Wraps a <audio> element + dynamic hls.js for HLS streams.
// Emits events via a private EventTarget; consumers subscribe with on(event, handler).
import { relayHlsUrl, relayUrl } from '../data/relay.js';
import { getStationInfo } from '../data/stations-api.js';
import { lowestBitrateLevelIndex } from './hls-levels.js';
import { nextStreamTransport } from './transport-ladder.js';
import { decodeHtmlEntities } from '../data/html-entities.js';

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
// A live stream that never produces audio must not leave playStation() pending
// forever: no element event is guaranteed when a server accepts the connection
// and then stays silent. 12 s triggers the same one-shot relay escalation as
// an explicit media error, and recovery takes over from there.
const PLAY_START_TIMEOUT_MS = 12000;
// A mixed-content URL refresh is an optimisation (it can turn a relay load
// into a direct one), never a precondition for playback. The station API can
// be slow exactly when the network is bad, and waiting its full 12 s default
// left the previous station audible and the UI unchanged after a tap.
const MIXED_CONTENT_REFRESH_TIMEOUT_MS = 1500;
// A native relay failure surfaces as an element error almost immediately; an
// HLS relay handoff needs to load a manifest and usually several segments
// before audio starts. Recovery must not pre-empt that work (the old fixed
// 1.5 s grace killed a healthy HLS start after ~2.6 s).
const HLS_ESCALATION_GRACE_MS = 12000;
// iOS resumes the previously interrupted audio app (e.g. a podcast) when the
// main <audio> element pauses during a station switch. Keep a silent looping
// element playing while the app is supposed to be playing, so the web audio
// session never goes inactive in the gap between teardown and the next
// station's first frame. Real zero samples (not volume 0) keep iOS from
// treating the element as inactive.
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let keepAlive = null;
let keepAliveWanted = false;
// Per-selection escalation state: after the direct source fails once, the
// server relay (uuid-only, stream URL resolved server-side) takes over —
// that is what rescues http-only streams on https origins, where the https
// upgrade silently fails on hosts that serve no TLS.
let currentUuid = '';
let currentIsHls = false;
// User intent, not element state. The OS may pause the element when the app
// goes to the background, and that pause must not be mistaken for the user
// tapping pause. Only pause()/media-session pause sets this; playStation(),
// resume() and stop() clear it.
let userPaused = false;
let assignedSrc = '';
let relayTried = false;
let directFailed = false;
let escalationGraceUntil = 0;
// The HLS relay answered with a manifest for this selection. Once confirmed,
// every retry of this station must use the HLS proxy again instead of paying
// the direct/native relay rounds first.
let hlsConfirmed = false;
// The HLS proxy has been tried for this selection. Reset when the probe fails
// without a manifest, so a later recovery attempt may probe it again.
let hlsProbeTried = false;

function getElement() {
  if (element) return element;
  element = document.createElement('audio');
  element.id = 'radiodock-audio';
  element.preload = 'none';
  element.playsInline = true;
  document.body.append(element);

  element.addEventListener('playing', () => {
    // The transport that just started is healthy; recovery may arm its stall
    // detection again and any escalation grace is obsolete.
    escalationGraceUntil = 0;
    emit('playing');
    // If iOS suspended the silent session keeper while we were in the
    // background, bring it back alongside the real stream.
    if (keepAliveWanted) startSessionKeepAlive();
  });
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
    // A source that dies mid-play escalates along the transport ladder once
    // per step. HLS errors arrive through the hls.js handler instead — the
    // element keeps a MediaSource blob here, so the src guard skips them.
    if (assignedSrc && element.getAttribute('src') === assignedSrc) {
      escalateThroughRelay(playToken);
    }
  });

  return element;
}

function ensureKeepAlive() {
  if (keepAlive || typeof document === 'undefined') return keepAlive;
  keepAlive = document.createElement('audio');
  keepAlive.src = SILENT_WAV_DATA_URI;
  keepAlive.loop = true;
  keepAlive.preload = 'auto';
  keepAlive.volume = 0.001;
  keepAlive.setAttribute('playsinline', '');
  keepAlive.setAttribute('aria-hidden', 'true');
  keepAlive.style.display = 'none';
  (document.body || document.documentElement).append(keepAlive);
  return keepAlive;
}

function startSessionKeepAlive() {
  keepAliveWanted = true;
  const el = ensureKeepAlive();
  if (!el || !el.paused) return;
  const p = el.play();
  if (p?.catch) p.catch(() => {});
}

function stopSessionKeepAlive() {
  keepAliveWanted = false;
  if (!keepAlive) return;
  try {
    keepAlive.pause();
    keepAlive.currentTime = 0;
  } catch {
    // Element already gone.
  }
}

events.addEventListener('recoveryfailed', stopSessionKeepAlive);

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

function withStartTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('Playback did not start in time'), { name: 'StartTimeoutError' }));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

// Export for tests and for callers that need the same mixed-content rule.
export function isMixedContentStream(station, secureContext = typeof window !== 'undefined' && window.isSecureContext) {
  return Boolean(secureContext && /^http:\/\//i.test(String(station?.url || '')));
}

// Local lists are self-contained snapshots. A station's stream URL can be
// repaired in the database (e.g. Funky SX moved to an official HLS endpoint)
// while the favorite still carries the old http:// address. Refresh once, only
// for the mixed-content case that would otherwise fall through to a broken
// relay decode, before choosing the transport.
const refreshedMixedContent = new Map();

export async function refreshMixedContentStation(station, {
  secureContext = typeof window !== 'undefined' && window.isSecureContext,
  fetchInfo = getStationInfo,
  timeoutMs = MIXED_CONTENT_REFRESH_TIMEOUT_MS,
} = {}) {
  const id = String(station?.stationuuid || station?.id || '');
  if (!id || id.startsWith('custom-') || !isMixedContentStream(station, secureContext)) return station;
  const key = `${id}|${station.url}`;
  if (refreshedMixedContent.has(key)) return refreshedMixedContent.get(key) ?? station;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  try {
    // Race the lookup against a short deadline. On a bad network the refresh
    // must yield to the relay path rather than hold the tap hostage; the relay
    // resolves the current URL from the database anyway.
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        try { controller?.abort(); } catch { /* already aborted */ }
        resolve(null);
      }, Math.max(0, timeoutMs));
    });
    const fresh = await Promise.race([
      fetchInfo(id, controller ? { signal: controller.signal } : undefined),
      deadline,
    ]);
    if (fresh?.url) {
      const merged = { ...station, ...fresh, id: station.id ?? id };
      refreshedMixedContent.set(key, merged);
      return merged;
    }
  } catch {
    // Keep the snapshot; the relay path below is still a valid fallback.
  } finally {
    if (timer) clearTimeout(timer);
  }
  refreshedMixedContent.set(key, null);
  return station;
}

// hls.js setup for one source URL. Network and media fatals get one local
// recovery each before the ladder escalates. The relay HLS URL is a signed
// manifest proxy, so relative segment and key URIs work as well as absolute
// ones. Native HLS remains the Safari fallback.
async function startHlsSource(token, url, { viaRelay = false } = {}) {
  const Hls = await loadHls();
  if (token !== playToken) return; // station changed during dynamic import

  const audio = getElement();
  if (Hls.isSupported()) {
    assignedSrc = '';
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

    // Radio is audio-only. hls.js sorts levels lowest→highest; start there and
    // cap automatic switching so a phone never pulls a 1080p/3 Mbps rendition
    // just to hear the same audio. This is the difference between a stable
    // background stream and constant rebuffering on mobile networks.
    instance.startLevel = 0;
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (viaRelay) hlsConfirmed = true;
      const lowest = lowestBitrateLevelIndex(instance.levels);
      if (lowest < 0) return;
      instance.startLevel = lowest;
      instance.currentLevel = lowest;
      instance.autoLevelCapping = lowest;
    });

    instance.on(Hls.Events.FRAG_PARSING_METADATA, (_evt, data) => {
      const samples = data?.samples ?? [];
      for (const sample of samples) {
        const frames = sample?.data;
        if (!frames || typeof frames !== 'object') continue;
        const title = decodeHtmlEntities(frames.TIT2?.data ?? '');
        const artist = decodeHtmlEntities(frames.TPE1?.data ?? '');
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
      // No transport left. Never point the native element at the relay's m3u8
      // URL — that URL serves a manifest, not audio. A failed probe resets its
      // state so a later recovery attempt can run the ladder again.
      if (viaRelay) {
        if (!hlsConfirmed) {
          hlsProbeTried = false;
          currentIsHls = false;
        }
        destroyHls();
        emit('error', { message: 'HLS relay unavailable', name: 'HlsRelayError' });
        return;
      }
      destroyHls();
      emit('error', { message: 'HLS playback failed', name: 'HlsFatalError' });
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

// One-shot escalation of the current load along the transport ladder. Native
// sources go direct -> native relay -> HLS manifest proxy; HLS sources go
// direct -> HLS manifest proxy. The HLS step for a native station exists
// because some stations hide an HLS manifest behind a non-.m3u8 URL or a
// PLS/M3U wrapper — the native relay answers those with 502 + X-Relay-Hls and
// a plain <audio> element can never play the manifest itself.
function escalateThroughRelay(token) {
  if (token !== playToken) return false;
  const step = nextStreamTransport({
    isHls: currentIsHls,
    directTried: true,
    nativeRelayTried: relayTried,
    hlsRelayTried: hlsProbeTried,
  });
  if (!step) return false;

  if (step === 'native-relay') {
    const relay = relayFor(currentStation);
    if (!relay) return false;
    relayTried = true;
    directFailed = true;
    escalationGraceUntil = Date.now() + 1500;
    destroyHls();
    const audio = getElement();
    assignedSrc = relay;
    audio.src = relay;
    audio.load();
    audio.play().catch((err) => {
      if (token !== playToken) return;
      emit('error', { message: err.message, name: err.name });
    });
    return true;
  }

  // step === 'hls-relay'
  const relay = relayHlsFor(currentStation);
  if (!relay) return false;
  hlsProbeTried = true;
  directFailed = true;
  escalationGraceUntil = Date.now() + HLS_ESCALATION_GRACE_MS;
  destroyHls();
  currentIsHls = true;
  startHlsSource(token, relay, { viaRelay: true })
    .then(() => {
      if (token !== playToken) return;
      // startHlsSource only attaches the MediaSource. The original play()
      // belonged to the source that just failed, so the HLS handoff must
      // start playback itself — otherwise hls.js buffers while paused forever.
      const audio = getElement();
      const playPromise = audio.play();
      playPromise?.catch?.((err) => {
        if (token !== playToken) return;
        emit('error', { message: err.message, name: err.name });
      });
    })
    .catch((err) => {
      if (token !== playToken) return;
      if (!hlsConfirmed) {
        hlsProbeTried = false;
        currentIsHls = false;
      }
      emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
    });
  return true;
}

async function playStation(station) {
  if (!station || !station.url) {
    emit('error', { message: 'Invalid station' });
    return;
  }

  userPaused = false;
  startSessionKeepAlive();
  const token = ++playToken;
  const uuid = String(station.stationuuid || station.id || '');
  if (uuid !== currentUuid || station.url !== currentStation?.url) {
    relayTried = false;
    directFailed = false;
    hlsConfirmed = false;
    hlsProbeTried = false;
    escalationGraceUntil = 0;
  }
  currentStation = station;
  currentUuid = uuid;
  // Announce the switch before any network work. The mixed-content refresh
  // below is an optimisation (it can turn a relay load into a direct one); it
  // must never delay the UI or leave the previous station audible while the
  // station API is slow.
  emit('stationchange', { station });
  emit('loading');

  const audio = getElement();
  destroyHls();

  try {
    audio.pause();
  } catch {}

  try {
    // A favorite can hold an old http:// stream after the database URL has been
    // repaired. Resolve the current record before the relay/decode path, but
    // never wait longer than the short refresh deadline for it.
    station = await refreshMixedContentStation(station);
    if (token !== playToken) return;
    currentStation = station;
    const streamUrl = preferHttps(station.url);
    const urlIsHls = isHlsUrl(station.url) || isHlsUrl(streamUrl);
    currentIsHls = urlIsHls || hlsConfirmed;
    const relay = currentIsHls ? relayHlsFor(station) : relayFor(station);
    // A secure page cannot load http:// media directly. Guessing https:// on
    // the same port often hangs without firing an error, which used to trap
    // recovery on an unreachable URL. Use the working relay first instead.
    const mixedContent = isMixedContentStream(station);
    // A previous attempt for this station already died on the direct source
    // (this load or a recovery retry) — go straight to the relay instead of
    // burning another round on a known-dead URL. Playlist files and mixed
    // content are not playable directly either, so the relay goes first.
    const useRelayFirst = Boolean(relay && (directFailed || isPlaylistUrl(station.url) || mixedContent));
    const source = useRelayFirst ? relay : streamUrl;
    if (useRelayFirst) {
      if (currentIsHls) hlsProbeTried = true;
      else relayTried = true;
    }

    if (currentIsHls) {
      await startHlsSource(token, source, { viaRelay: useRelayFirst });
    } else {
      assignedSrc = source;
      audio.src = source;
      audio.load();
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      // The race can settle before play() does; keep a rejection handler on the
      // original promise so it never surfaces as an unhandled rejection.
      playPromise.catch(() => {});
      await withStartTimeout(playPromise, PLAY_START_TIMEOUT_MS);
    }
  } catch (err) {
    if (token !== playToken) return; // superseded by a newer call
    // Autoplay policy is not a stream failure: the relay cannot bypass it and
    // routing a blocked play() through the VPS only burns capacity.
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
      return;
    }
    // One immediate escalation before surfacing the error, so an http-only
    // host without TLS still starts on the first tap.
    if (escalateThroughRelay(token)) return;
    console.warn('playStation failed:', err);
    emit('error', { message: err?.message ?? 'Playback failed', name: err?.name });
  }
}

function pause() {
  userPaused = true;
  // A station load can be in flight (mixed-content refresh, hls.js import,
  // relay handoff). Pausing must cancel it: otherwise the late load assigns a
  // src and calls play() after the user — or the lock screen — already paused.
  playToken++;
  const audio = getElement();
  audio.pause();
  // A real user pause should release the audio session; only a station switch
  // needs the silent keeper to survive the gap.
  stopSessionKeepAlive();
}

function resume() {
  userPaused = false;
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
  userPaused = false;
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
  hlsConfirmed = false;
  hlsProbeTried = false;
  escalationGraceUntil = 0;
  stopSessionKeepAlive();
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

function isUserPaused() {
  return userPaused;
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
  isUserPaused,
  isEscalating,
  on,
  prefetchHls,
  isHlsUrl,
  // exposed for recovery + metadata-poller modules
  _element: getElement,
  events,
};
