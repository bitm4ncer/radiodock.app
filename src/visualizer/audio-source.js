// Visualizer audio source.
//
// Two modes:
//   procedural — default. Drives the visualizer from a synthesised FFT that
//                reacts to player events (playing / paused / metadata /
//                stationchange). Costs nothing, no permission prompts.
//   capture    — user-opted-in via getDisplayMedia(). Real-time FFT from the
//                tab's audio output. Comes with a browser-mandated "Sharing
//                this tab to …" banner — there is no API to hide it.
//
// Why no Tier-1 createMediaElementSource: our radio streams are cross-origin
// without CORS, so connecting Web Audio to the shared <audio> element
// silences it permanently for that element. The element-tap path is
// disabled entirely; see git history for the previous broken implementation.
//
// Public API:
//   const src = createAudioSource(player);
//   src.start();
//   src.getFrame() => { freq: Uint8Array, time: Uint8Array }
//   src.getMode() => 'idle' | 'procedural' | 'capture'
//   src.onModeChange(cb) => unsubscribe
//   src.requestUpgrade()  // opt-in to capture mode
//   src.captureSupported()
//   src.getDebug() => { contextState, analyserConnected, ... }
//   src.destroy()

const FFT_SIZE = 1024;
const FFT_BINS = FFT_SIZE / 2;
const SMOOTHING = 0.78;

export function createAudioSource(player) {
  // --- State -----------------------------------------------------------
  let mode = 'idle';
  const modeListeners = new Set();

  // Procedural data (always available)
  const procFreq = new Uint8Array(FFT_BINS);
  const procTime = new Uint8Array(FFT_SIZE);
  let intensity = 0.65;
  let pulse = 0;
  let bpm = 96;
  let isPlaying = false;
  let isLoading = false;
  let startedAt = performance.now();

  // Capture-mode resources (created on first requestUpgrade)
  let audioCtx = null;
  let analyser = null;
  let captureFreq = null;
  let captureTime = null;
  let captureSource = null;
  let captureStream = null;
  let lastCaptureNonZero = 0;

  // --- Mode mgmt -------------------------------------------------------
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

  // --- Procedural fill -------------------------------------------------
  function bumpPulse(amount = 1) {
    pulse = Math.min(1, pulse + amount);
  }

  function fillProcedural(nowMs) {
    const elapsed = (nowMs - startedAt) / 1000;
    pulse = Math.max(0, pulse - 0.018);

    const beat = 0.5 + 0.5 * Math.sin(elapsed * (bpm / 60) * Math.PI * 2);
    const drift1 = 0.5 + 0.5 * Math.sin(elapsed * 0.21);
    const drift2 = 0.5 + 0.5 * Math.sin(elapsed * 0.61 + 1.3);

    const playMul = isPlaying ? 1 : (isLoading ? 0.55 : 0.3);
    const amp = Math.min(
      1.2,
      intensity * playMul * (0.55 + 0.45 * beat) * (0.75 + 0.25 * drift1)
        + pulse * 0.5,
    );

    for (let i = 0; i < procFreq.length; i++) {
      const t = i / procFreq.length;
      const env = Math.pow(1 - t, 1.5);
      const n =
        0.5 +
        0.25 * Math.sin(i * 0.31 + elapsed * 2.7) +
        0.25 * Math.sin(i * 0.07 + elapsed * 0.9 + drift2 * 6);
      procFreq[i] = clamp255(amp * env * n * 255);
    }
    const omega = (bpm / 60) * Math.PI * 2;
    for (let i = 0; i < procTime.length; i++) {
      const t = i / procTime.length;
      const v =
        Math.sin(t * 12 + elapsed * omega) * amp * 0.6 +
        Math.sin(t * 30 + elapsed * omega * 1.3) * amp * 0.25;
      procTime[i] = clamp255((0.5 + v * 0.5) * 255);
    }
  }

  function clamp255(v) {
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v | 0;
  }

  // --- Capture mode setup ---------------------------------------------
  function resumeIfSuspended() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch((err) => console.warn('audioCtx.resume() rejected:', err));
    }
  }

  function ensureCaptureContext() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (err) {
      console.warn('AudioContext creation failed:', err);
      audioCtx = null;
      return null;
    }
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = SMOOTHING;
    captureFreq = new Uint8Array(analyser.frequencyBinCount);
    captureTime = new Uint8Array(analyser.fftSize);
    return audioCtx;
  }

  async function requestUpgrade() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Tab audio capture not supported in this browser.');
    }

    // The button click is a real user gesture. Create + resume the
    // AudioContext NOW, before any await — the gesture is consumed by
    // getDisplayMedia. Without this, Chromium can leave the context
    // suspended and the analyser only reads zeros.
    ensureCaptureContext();
    resumeIfSuspended();

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });
    } catch (err) {
      throw err;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio track in the shared stream. Tick "Share tab audio" when prompted.');
    }

    // Drop video tracks; we only want audio.
    stream.getVideoTracks().forEach((t) => t.stop());

    // Replace any prior capture.
    if (captureSource) {
      try { captureSource.disconnect(); } catch {}
      captureSource = null;
    }
    if (captureStream) {
      try { captureStream.getTracks().forEach((t) => t.stop()); } catch {}
    }
    captureStream = stream;
    captureSource = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
    captureSource.connect(analyser);

    // The getDisplayMedia await consumed the gesture. Try once more to
    // resume the context — Chrome usually allows it now that an active
    // capture stream is connected.
    resumeIfSuspended();

    setMode('capture');

    // If user ends sharing from the browser bar, fall back gracefully.
    audioTracks[0].addEventListener('ended', () => {
      stopCapture();
      setMode('procedural');
    });
  }

  function stopCapture() {
    if (captureSource) {
      try { captureSource.disconnect(); } catch {}
      captureSource = null;
    }
    if (captureStream) {
      try { captureStream.getTracks().forEach((t) => t.stop()); } catch {}
      captureStream = null;
    }
  }

  // --- Per-frame accessor ---------------------------------------------
  function getFrame() {
    if (mode === 'capture' && analyser) {
      analyser.getByteFrequencyData(captureFreq);
      analyser.getByteTimeDomainData(captureTime);
      // Watchdog: if the capture is producing only zeros for >60 frames
      // straight (1s @ 60fps), something is wrong (suspended context,
      // muted track, ad break, etc.). Mix in a touch of procedural so
      // the user sees movement instead of a dead canvas. Doesn't switch
      // modes — the moment real audio resumes, capture data takes over.
      let sum = 0;
      for (let i = 0; i < captureFreq.length; i += 32) sum += captureFreq[i];
      if (sum > 0) {
        lastCaptureNonZero = performance.now();
        return { freq: captureFreq, time: captureTime };
      }
      // Zero capture frame — fall back to procedural data for this frame.
      fillProcedural(performance.now());
      return { freq: procFreq, time: procTime };
    }
    fillProcedural(performance.now());
    return { freq: procFreq, time: procTime };
  }

  // --- Lifecycle -------------------------------------------------------
  const cleanupFns = [];
  let started = false;

  function start() {
    if (started) return;
    started = true;
    startedAt = performance.now();
    setMode('procedural');

    cleanupFns.push(player.on('playing', () => {
      isPlaying = true;
      isLoading = false;
      bumpPulse(0.6);
    }));
    cleanupFns.push(player.on('paused', () => {
      isPlaying = false;
      isLoading = false;
    }));
    cleanupFns.push(player.on('loading', () => {
      isLoading = true;
    }));
    cleanupFns.push(player.on('stationchange', () => {
      bpm = 80 + Math.random() * 60;
      intensity = 0.55 + Math.random() * 0.25;
      bumpPulse(0.9);
    }));
    cleanupFns.push(player.on('metadata', () => {
      bumpPulse(0.45);
    }));

    isPlaying = player.isPlaying?.() ?? false;

    // Resume any existing context whenever the user interacts — covers the
    // edge case where capture was started in a prior session and the audio
    // context is somehow suspended.
    const wake = () => resumeIfSuspended();
    window.addEventListener('pointerdown', wake, { capture: true });
    cleanupFns.push(() => window.removeEventListener('pointerdown', wake, { capture: true }));
  }

  function destroy() {
    for (const off of cleanupFns) try { off(); } catch {}
    cleanupFns.length = 0;
    stopCapture();
    try { audioCtx?.close(); } catch {}
    audioCtx = null;
    analyser = null;
    captureFreq = null;
    captureTime = null;
    started = false;
    setMode('idle');
  }

  // --- Diagnostics ----------------------------------------------------
  function getDebug() {
    return {
      mode,
      audioContextState: audioCtx?.state ?? null,
      analyserConnected: !!captureSource && !!analyser,
      captureStreamActive: !!captureStream && captureStream.active,
      audioTrackEnabled: captureStream?.getAudioTracks?.()[0]?.enabled ?? null,
      audioTrackMuted: captureStream?.getAudioTracks?.()[0]?.muted ?? null,
      msSinceLastNonZero: lastCaptureNonZero ? performance.now() - lastCaptureNonZero : null,
    };
  }

  function captureSupported() {
    return !!navigator.mediaDevices?.getDisplayMedia;
  }

  return {
    start,
    destroy,
    getFrame,
    getMode: () => mode,
    onModeChange,
    requestUpgrade,
    captureSupported,
    getAudioContext: () => audioCtx,
    getSourceNode: () => captureSource,
    getDebug,
  };
}
