// Visualizer engine — owns two fullscreen <canvas>es (one 2D, one WebGL/regl),
// runs the active visualizer's render() inside a single rAF loop, manages
// init/dispose around switches, and pauses when the page is hidden / the
// master toggle is off.
//
// Two canvases stacked because a single canvas can't expose both a 2D and a
// WebGL context simultaneously — once one is requested, the other is null
// forever on that element. We just toggle display.
//
// Public API:
//   const engine = createEngine({ audioSource });
//   engine.start();
//   engine.stop();
//   await engine.setVisualizer(vizModule);
//   engine.setControls(map);
//   engine.isRunning();

const DPR_CAP = 1.5;
const DPR_FALLBACK = 1.0;
const STALL_FRAMES = 30;
const STALL_BUDGET_MS = 24;

export function createEngine({ audioSource }) {
  let canvas2d = null;
  let canvasGl = null;
  let canvasMilkdrop = null;     // butterchurn manages this one itself
  let ctx2d = null;
  let regl = null;
  let reglPromise = null;

  let activeViz = null;          // { module, state, kind, canvas }
  let pendingViz = null;
  let dpr = DPR_CAP;
  let dprFallbackTaken = false;
  let stallCount = 0;
  let running = false;
  let rafId = 0;
  let lastFrameStart = 0;
  let controls = {};
  let mounted = false;

  function makeCanvas(id) {
    const c = document.createElement('canvas');
    c.id = id;
    Object.assign(c.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '-1',
      pointerEvents: 'none',
      display: 'none',
    });
    return c;
  }

  function ensureMounted() {
    if (mounted) return;
    canvas2d = makeCanvas('vizCanvas2d');
    canvasGl = makeCanvas('vizCanvasGl');
    canvasMilkdrop = makeCanvas('vizCanvasMilkdrop');
    document.body.prepend(canvasMilkdrop);
    document.body.prepend(canvasGl);
    document.body.prepend(canvas2d);
    mounted = true;
  }

  function activeCanvas() {
    return activeViz?.canvas ?? null;
  }

  function showActive() {
    if (canvas2d) canvas2d.style.display = activeViz?.kind === 'canvas2d' ? 'block' : 'none';
    if (canvasGl) canvasGl.style.display = activeViz?.kind === 'shader' ? 'block' : 'none';
    if (canvasMilkdrop) canvasMilkdrop.style.display = activeViz?.kind === 'milkdrop' ? 'block' : 'none';
    resize();
  }
  function hideAll() {
    if (canvas2d) canvas2d.style.display = 'none';
    if (canvasGl) canvasGl.style.display = 'none';
    if (canvasMilkdrop) canvasMilkdrop.style.display = 'none';
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas2d) {
      const tw = Math.floor(w * Math.min(dpr, window.devicePixelRatio || 1));
      const th = Math.floor(h * Math.min(dpr, window.devicePixelRatio || 1));
      if (canvas2d.width !== tw) canvas2d.width = tw;
      if (canvas2d.height !== th) canvas2d.height = th;
    }
    if (canvasGl) {
      const tw = Math.floor(w * dpr);
      const th = Math.floor(h * dpr);
      if (canvasGl.width !== tw) canvasGl.width = tw;
      if (canvasGl.height !== th) canvasGl.height = th;
    }
    if (canvasMilkdrop) {
      const tw = Math.floor(w * dpr);
      const th = Math.floor(h * dpr);
      if (canvasMilkdrop.width !== tw) canvasMilkdrop.width = tw;
      if (canvasMilkdrop.height !== th) canvasMilkdrop.height = th;
      // Inform active milkdrop viz so butterchurn can re-target.
      if (activeViz?.kind === 'milkdrop') {
        try { activeViz.module.resize?.({ state: activeViz.state, width: tw, height: th }); } catch {}
      }
    }
  }

  async function ensureRegl() {
    if (regl) return regl;
    if (!reglPromise) {
      ensureMounted();
      reglPromise = import('regl').then((mod) => {
        const create = mod.default ?? mod;
        regl = create({
          canvas: canvasGl,
          attributes: { antialias: false, preserveDrawingBuffer: false, alpha: false },
        });
        return regl;
      });
    }
    return reglPromise;
  }

  function ensureCtx2d() {
    if (ctx2d) return ctx2d;
    ensureMounted();
    try {
      ctx2d = canvas2d.getContext('2d');
    } catch (err) {
      console.warn('2D context unavailable:', err);
    }
    return ctx2d;
  }

  async function setVisualizer(vizModule) {
    pendingViz = vizModule;
  }

  async function applyPendingViz() {
    if (!pendingViz) return;
    const next = pendingViz;
    pendingViz = null;

    if (activeViz && activeViz.module === next) return;

    if (activeViz) {
      try { activeViz.module.dispose?.(activeViz.state); } catch (err) {
        console.warn('viz dispose failed:', err);
      }
      if (activeViz.kind === 'canvas2d' && ctx2d) {
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
      } else if (activeViz.kind === 'shader' && regl) {
        regl.clear({ color: [0, 0, 0, 1], depth: 1 });
      }
      activeViz = null;
    }

    ensureMounted();

    if (next.kind === 'canvas2d') {
      const ctx = ensureCtx2d();
      if (!ctx) return;
      const state = next.init?.({ canvas: canvas2d, ctx2d: ctx }) ?? {};
      activeViz = { module: next, state, kind: 'canvas2d', canvas: canvas2d };
    } else if (next.kind === 'shader') {
      await ensureRegl();
      const state = next.init?.({ regl, canvas: canvasGl }) ?? {};
      activeViz = { module: next, state, kind: 'shader', canvas: canvasGl };
    } else if (next.kind === 'milkdrop') {
      const audioContext = audioSource.getAudioContext?.();
      const sourceNode = audioSource.getSourceNode?.();
      const state = await next.init?.({
        canvas: canvasMilkdrop,
        audioContext,
        sourceNode,
      });
      activeViz = { module: next, state, kind: 'milkdrop', canvas: canvasMilkdrop };
    } else {
      console.warn('Unknown viz kind:', next.kind);
      return;
    }

    showActive();
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    if (pendingViz) {
      // Fire-and-forget; pendingViz handling is async only for regl import.
      applyPendingViz();
    }

    if (!activeViz) return;

    const frameStart = performance.now();
    if (lastFrameStart) {
      const dt = frameStart - lastFrameStart;
      if (dt > STALL_BUDGET_MS) stallCount++;
      else stallCount = Math.max(0, stallCount - 1);
      if (stallCount >= STALL_FRAMES && !dprFallbackTaken && activeViz.kind === 'shader') {
        dpr = DPR_FALLBACK;
        dprFallbackTaken = true;
        resize();
      }
    }
    lastFrameStart = frameStart;

    const { freq, time } = audioSource.getFrame();
    const c = activeCanvas();
    const viewport = { width: c.width, height: c.height, dpr };

    try {
      activeViz.module.render({
        ctx2d,
        regl,
        canvas: c,
        state: activeViz.state,
        audioData: { freq, time },
        time: now / 1000,
        controls,
        viewport,
      });
    } catch (err) {
      console.error('viz render error:', err);
    }
  }

  function start() {
    if (running) return;
    running = true;
    ensureMounted();
    showActive();
    resize();
    rafId = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    hideAll();
  }

  function onVisibility() {
    if (document.hidden && running) {
      cancelAnimationFrame(rafId);
    } else if (!document.hidden && running) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function setControls(next) {
    controls = { ...next };
  }

  function isRunning() {
    return running;
  }

  function getActiveKind() {
    return activeViz?.kind ?? null;
  }

  return {
    start,
    stop,
    setVisualizer,
    setControls,
    isRunning,
    getActiveKind,
  };
}
