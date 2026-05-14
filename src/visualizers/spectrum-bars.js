// Classic Winamp 2.x-style spectrum bars.

export default {
  id: 'spectrum-bars',
  name: 'Spectrum Bars',
  category: 'classic',
  kind: 'canvas2d',
  controls: [
    { id: 'hue', label: 'Hue', type: 'range', min: 0, max: 360, step: 1, default: 200 },
    { id: 'barWidth', label: 'Bar width', type: 'range', min: 2, max: 24, step: 1, default: 8 },
    { id: 'gap', label: 'Gap', type: 'range', min: 0, max: 8, step: 1, default: 2 },
    { id: 'mirror', label: 'Mirror', type: 'toggle', default: true },
    { id: 'gradient', label: 'Gradient', type: 'toggle', default: true },
  ],

  init({ canvas, ctx2d }) {
    return {
      peaks: new Float32Array(256),
      peakVels: new Float32Array(256),
    };
  },

  render({ ctx2d, canvas, state, audioData, controls }) {
    const w = canvas.width;
    const h = canvas.height;
    const freq = audioData.freq;

    const hue = controls.hue ?? 200;
    const barWidth = Math.max(2, controls.barWidth ?? 8);
    const gap = Math.max(0, controls.gap ?? 2);
    const mirror = controls.mirror !== false;
    const useGradient = controls.gradient !== false;

    ctx2d.fillStyle = 'rgba(13, 13, 13, 0.25)';
    ctx2d.fillRect(0, 0, w, h);

    const slot = barWidth + gap;
    const halfW = w / 2;
    const usableHalf = mirror ? halfW : w;
    const bars = Math.max(8, Math.floor(usableHalf / slot));
    const samplePerBar = Math.max(1, Math.floor((freq.length * 0.7) / bars));

    if (state.peaks.length < bars) {
      state.peaks = new Float32Array(bars);
      state.peakVels = new Float32Array(bars);
    }

    const baselineY = h - Math.max(8, h * 0.04);

    for (let i = 0; i < bars; i++) {
      let v = 0;
      const start = i * samplePerBar;
      for (let j = 0; j < samplePerBar; j++) v += freq[start + j] ?? 0;
      v = (v / samplePerBar) / 255;
      // Curve so highs feel more present
      v = Math.pow(v, 0.85);

      // Peak hold with gravity
      if (v > state.peaks[i]) {
        state.peaks[i] = v;
        state.peakVels[i] = 0;
      } else {
        state.peakVels[i] += 0.0009;
        state.peaks[i] -= state.peakVels[i];
        if (state.peaks[i] < 0) state.peaks[i] = 0;
      }

      const barH = v * (baselineY - h * 0.05);
      const barTop = baselineY - barH;
      const localHue = (hue + i * (mirror ? 0.6 : 0.3)) % 360;

      if (useGradient && barH > 8) {
        const grad = ctx2d.createLinearGradient(0, barTop, 0, baselineY);
        grad.addColorStop(0, `hsl(${localHue}, 92%, 65%)`);
        grad.addColorStop(1, `hsl(${(localHue + 60) % 360}, 80%, 35%)`);
        ctx2d.fillStyle = grad;
      } else {
        ctx2d.fillStyle = `hsl(${localHue}, 80%, 55%)`;
      }

      if (mirror) {
        const xR = halfW + i * slot;
        const xL = halfW - (i + 1) * slot;
        ctx2d.fillRect(xR, barTop, barWidth, barH);
        ctx2d.fillRect(xL, barTop, barWidth, barH);

        // Peak caps
        const peakY = baselineY - state.peaks[i] * (baselineY - h * 0.05);
        ctx2d.fillStyle = `hsla(${localHue}, 95%, 75%, 0.9)`;
        ctx2d.fillRect(xR, peakY - 2, barWidth, 2);
        ctx2d.fillRect(xL, peakY - 2, barWidth, 2);
      } else {
        const x = i * slot;
        ctx2d.fillRect(x, barTop, barWidth, barH);
        const peakY = baselineY - state.peaks[i] * (baselineY - h * 0.05);
        ctx2d.fillStyle = `hsla(${localHue}, 95%, 75%, 0.9)`;
        ctx2d.fillRect(x, peakY - 2, barWidth, 2);
      }
    }
  },

  dispose() {},
};
