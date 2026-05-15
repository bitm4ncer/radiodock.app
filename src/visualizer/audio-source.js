// Tiered audio data acquisition for the visualizer.
//
// Most RadioDock streams are tainted cross-origin (Shoutcast / Icecast without
// CORS), so Web Audio's AnalyserNode reads zeros from the main <audio> element
// for those. This module runs through tiers to get usable FFT data anyway:
//
//   Tier 1 — HLS via hls.js. The element's src is a same-origin blob: URL
//            (MediaSource), so it's untainted. createMediaElementSource works.
//            DISABLED: even on HLS, calling createMediaElementSource() once
//            permanently routes the <audio> element through Web Audio. As soon
//            as the user switches to a non-HLS (cross-origin) station, the
//            tainted media source silences audioCtx.destination — playback
//            stops site-wide and there is no way to undo it without a full
//            page reload. The trade-off (reactive visuals on HLS only) is not
//            worth the risk to audio playback, so we always fall through to
//            Tier 3 / Tier 4.
//   Tier 2 — (deferred to v1.1) CORS probe + element swap with crossorigin.
//            The current implementation skips this and drops straight to Tier 3.
//   Tier 3 — getDisplayMedia tab-audio capture. Universal but requires a user
//            gesture and a permission prompt. Chromium-only in practice.
//   Tier 4 — Procedural fallback. Synthesized sine pulse plus drift, nudged
//            by `metadata` events. Visualizers consume this identically.
//
// Public API:
//   const src = createAudioSource(player);
//   src.start();                                 // create AudioContext (user gesture)
//   src.getFrame() => { freq: Uint8Array, time: Uint8Array }  // call per rAF
//   src.requestUpgrade()                          // run getDisplayMedia prompt
//   src.getMode() => 'hls' | 'capture' | 'procedural' | 'idle'
//   src.onModeChange(cb) => unsubscribe
//   src.destroy()

const FFT_SIZE = 1024;            // → 512 freq bins
const SMOOTHING = 0.78;

export function createAudioSource(player) {
  let audioCtx = null;
  let mediaElementSource = null;     // built once, lives for the page
  let captureSource = null;          // MediaStreamSource from getDisplayMedia
  let captureStream = null;
  let analyser = null;
  let freqArray = null;
  let timeArray = null;

  let mode = 'idle';
  const modeListeners = new Set();

  // Procedural state
  let procStart = performance.now();
  let procBpm = 96;
  let procIntensity = 0.6;
  let procFreq = null;
  let procTime = null;

  // Track whether the current station's element is HLS-via-hls.js.
  // Decided on `canplay`: blob: URL → tier 1; otherwise tier 4 (or 3 if upgrade granted).
  let elementIsHls = false;
  let lastNonZeroAt = 0;
  let zeroFrameCounter = 0;

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    for (const cb of modeListeners) {
      try { cb(mode); } catch {}
    }
  }

  function onModeChange(cb) {
    modeListeners.add(cb);
    return () => modeListeners.delete(cb);
  }

  function ensureAnalyser() {
    if (!audioCtx) return null;
    if (analyser) return analyser;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    freqArray = new Uint8Array(analyser.frequencyBinCount);
    timeArray = new Uint8Array(analyser.fftSize);
    return analyser;
  }

  function ensureMediaElementSource() {
    // Tier 1 is disabled — see file header. Calling createMediaElementSource
    // on the shared <audio> element is a one-way door that silences any
    // future cross-origin station. We always return null and let the engine
    // fall through to procedural / capture data.
    return null;
  }

  function connectElementToAnalyser() {
    const src = ensureMediaElementSource();
    const an = ensureAnalyser();
    if (!src || !an) return;
    try { src.disconnect(an); } catch {}
    try { src.connect(an); } catch {}
  }

  function disconnectElementFromAnalyser() {
    if (!mediaElementSource || !analyser) return;
    try { mediaElementSource.disconnect(analyser); } catch {}
  }

  function connectCaptureToAnalyser() {
    const an = ensureAnalyser();
    if (!captureSource || !an) return;
    try { captureSource.disconnect(an); } catch {}
    try { captureSource.connect(an); } catch {}
  }

  // --- Tier 1: detect HLS-via-hls.js after canplay ---

  function checkElementSource() {
    // Tier 1 is disabled (see file header). We never attach to the <audio>
    // element. If a capture stream is active it takes priority; otherwise the
    // mode is procedural until the user opts into capture.
    if (mode === 'capture') return;
    setMode('procedural');
  }

  // --- Tier 3: getDisplayMedia upgrade ---

  async function requestUpgrade() {
    if (!audioCtx) start();
    // The "Connect audio" button click is a real user gesture — use it to
    // resume the context before any await (which would consume the gesture).
    resumeIfSuspended();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Tab audio capture not supported in this browser.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });
    } catch (err) {
      // User dismissed / unsupported / no audio chosen
      throw err;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      // User shared a tab but didn't tick "Share tab audio"
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio track in the shared stream. Tick "Share tab audio" when prompted.');
    }

    // Drop video tracks — we only want audio.
    stream.getVideoTracks().forEach((t) => t.stop());

    // Disconnect any prior capture, then build new one.
    if (captureSource) {
      try { captureSource.disconnect(); } catch {}
      captureSource = null;
    }
    if (captureStream) {
      try { captureStream.getTracks().forEach((t) => t.stop()); } catch {}
    }
    captureStream = stream;
    captureSource = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));

    // Capture overrides element-based analysis.
    disconnectElementFromAnalyser();
    connectCaptureToAnalyser();
    setMode('capture');

    // If user ends sharing from the browser bar, fall back gracefully.
    audioTracks[0].addEventListener('ended', () => {
      if (mode !== 'capture') return;
      try { captureSource?.disconnect(); } catch {}
      captureSource = null;
      captureStream = null;
      // Re-evaluate the current element state.
      checkElementSource();
    });
  }

  // --- Procedural fallback ---

  function fillProcedural() {
    if (!procFreq) procFreq = new Uint8Array(analyser?.frequencyBinCount ?? 512);
    if (!procTime) procTime = new Uint8Array(analyser?.fftSize ?? FFT_SIZE);

    const now = performance.now();
    const elapsed = (now - procStart) / 1000;
    const beat = 0.5 + 0.5 * Math.sin(elapsed * (procBpm / 60) * Math.PI * 2);
    const slowDrift = 0.5 + 0.5 * Math.sin(elapsed * 0.13);
    const amp = procIntensity * (0.4 + 0.6 * beat) * (0.7 + 0.3 * slowDrift);

    for (let i = 0; i < procFreq.length; i++) {
      // Falloff curve: bass strongest, treble decays.
      const t = i / procFreq.length;
      const env = Math.pow(1 - t, 1.6);
      const noise = (Math.sin(i * 0.31 + elapsed * 2.7) + Math.sin(i * 0.07 + elapsed * 0.9)) * 0.25 + 0.5;
      procFreq[i] = Math.max(0, Math.min(255, Math.round(amp * env * noise * 255)));
    }

    const sampleRate = procBpm / 60 * Math.PI * 2;
    for (let i = 0; i < procTime.length; i++) {
      const t = i / procTime.length;
      const v = Math.sin(t * 12 + elapsed * sampleRate) * amp * 0.6
              + Math.sin(t * 30 + elapsed * sampleRate * 1.3) * amp * 0.25;
      procTime[i] = Math.max(0, Math.min(255, Math.round((0.5 + v * 0.5) * 255)));
    }
  }

  function getFrame() {
    if (!audioCtx || !analyser) {
      // Engine asks for data before start(); return empty arrays.
      return { freq: emptyFreq(), time: emptyTime() };
    }

    if (mode === 'hls' || mode === 'capture') {
      analyser.getByteFrequencyData(freqArray);
      analyser.getByteTimeDomainData(timeArray);

      // Sanity check: if the source is silently producing zeros (taint), drop
      // out of HLS mode after ~60 consecutive zero frames (~1s at 60fps).
      // Skip this watchdog for capture (legitimate silence is possible).
      if (mode === 'hls') {
        let sum = 0;
        for (let i = 0; i < freqArray.length; i += 32) sum += freqArray[i];
        if (sum === 0) {
          zeroFrameCounter++;
          if (zeroFrameCounter > 60) {
            disconnectElementFromAnalyser();
            setMode('procedural');
            zeroFrameCounter = 0;
          }
        } else {
          zeroFrameCounter = 0;
          lastNonZeroAt = performance.now();
        }
      }

      return { freq: freqArray, time: timeArray };
    }

    fillProcedural();
    return { freq: procFreq, time: procTime };
  }

  // --- Lifecycle ---

  function resumeIfSuspended() {
    if (audioCtx && audioCtx.state === 'suspended') {
      // Resume returns a promise; we don't await — caller may not be inside
      // a gesture. Chrome will accept the resume silently if the caller is.
      audioCtx.resume().catch(() => {});
    }
  }

  // One-shot listener: the visualizer is often auto-started from a saved
  // pref (no user gesture), so the AudioContext starts suspended. The
  // first user click/touch/key after that resumes it.
  function installGestureWakeup() {
    if (!audioCtx) return;
    const types = ['pointerdown', 'keydown', 'touchstart'];
    const wake = () => {
      resumeIfSuspended();
      // Keep listening until it actually resumes — Chrome can sometimes
      // refuse a resume even after a gesture if the gesture was already
      // consumed by another handler in the same frame.
      if (!audioCtx || audioCtx.state === 'running') {
        types.forEach((t) => window.removeEventListener(t, wake, true));
      }
    };
    types.forEach((t) => window.addEventListener(t, wake, true));
  }

  function start() {
    if (audioCtx) {
      // Already created (probably auto-started from a saved pref). Try to
      // resume in case we're now inside a fresh user gesture.
      resumeIfSuspended();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (err) {
      console.warn('AudioContext creation failed:', err);
      return;
    }
    ensureAnalyser();
    // Intentionally NOT calling ensureMediaElementSource(): Tier 1 is disabled
    // because it permanently silences cross-origin audio. See file header.

    // Resume on user gesture if needed (Chrome's autoplay policy).
    resumeIfSuspended();
    // Belt-and-braces: also wake up on the next user gesture, in case start()
    // was called without one (pref-driven auto-start at page load).
    installGestureWakeup();

    // React to player state.
    const offCanplay = player.on('canplay', () => checkElementSource());
    const offStationChange = player.on('stationchange', () => {
      zeroFrameCounter = 0;
    });
    const offMetadata = player.on('metadata', () => {
      // Drift the procedural intensity / bpm slightly to mark "scene change"
      procIntensity = 0.4 + Math.random() * 0.4;
      procBpm = 80 + Math.random() * 50;
    });

    cleanupFns.push(offCanplay, offStationChange, offMetadata);

    // Evaluate immediately in case a station is already loaded.
    checkElementSource();
  }

  const cleanupFns = [];

  function destroy() {
    for (const off of cleanupFns) try { off(); } catch {}
    cleanupFns.length = 0;

    try { mediaElementSource?.disconnect(); } catch {}
    try { captureSource?.disconnect(); } catch {}
    try { captureStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioCtx?.close(); } catch {}

    mediaElementSource = null;
    captureSource = null;
    captureStream = null;
    analyser = null;
    freqArray = null;
    timeArray = null;
    audioCtx = null;
    setMode('idle');
  }

  // --- Utility ---

  function emptyFreq() {
    if (!procFreq) procFreq = new Uint8Array(FFT_SIZE / 2);
    return procFreq;
  }
  function emptyTime() {
    if (!procTime) procTime = new Uint8Array(FFT_SIZE);
    return procTime;
  }

  function captureSupported() {
    return !!navigator.mediaDevices?.getDisplayMedia;
  }

  function getAudioContext() {
    return audioCtx;
  }

  // Returns the current source node feeding the analyser. For butterchurn and
  // similar consumers that want to tap into the same audio graph.
  function getSourceNode() {
    if (mode === 'capture') return captureSource;
    if (mode === 'hls') return mediaElementSource;
    return null;
  }

  return {
    start,
    destroy,
    getFrame,
    getMode: () => mode,
    onModeChange,
    requestUpgrade,
    captureSupported,
    getAudioContext,
    getSourceNode,
  };
}
