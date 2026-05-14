// Concentric rings pulsing from center on bass hits.

const PALETTES = {
  sunset: [[20, 95, 60], [340, 88, 58], [280, 70, 60]],
  ocean:  [[200, 90, 60], [180, 85, 55], [240, 75, 60]],
  forest: [[120, 75, 50], [80, 80, 55], [160, 60, 45]],
  mono:   [[0, 0, 90], [0, 0, 60], [0, 0, 30]],
};

export default {
  id: 'radial-pulse',
  name: 'Radial Pulse',
  category: 'classic',
  kind: 'canvas2d',
  controls: [
    {
      id: 'palette',
      label: 'Palette',
      type: 'select',
      options: [
        { value: 'sunset', label: 'Sunset' },
        { value: 'ocean', label: 'Ocean' },
        { value: 'forest', label: 'Forest' },
        { value: 'mono', label: 'Mono' },
      ],
      default: 'sunset',
    },
    { id: 'rings', label: 'Rings', type: 'range', min: 4, max: 28, step: 1, default: 14 },
    { id: 'decay', label: 'Trail', type: 'range', min: 0.05, max: 0.5, step: 0.01, default: 0.18 },
    { id: 'thickness', label: 'Thickness', type: 'range', min: 1, max: 12, step: 1, default: 3 },
  ],

  init() {
    return {
      ringAges: new Float32Array(32),
      ringEnergies: new Float32Array(32),
      bassSmoothed: 0,
      lastHitAt: 0,
    };
  },

  render({ ctx2d, canvas, state, audioData, time, controls }) {
    const w = canvas.width;
    const h = canvas.height;
    const freq = audioData.freq;

    const paletteName = controls.palette ?? 'sunset';
    const palette = PALETTES[paletteName] ?? PALETTES.sunset;
    const rings = Math.min(state.ringAges.length, Math.max(4, controls.rings ?? 14));
    const decay = controls.decay ?? 0.18;
    const thickness = controls.thickness ?? 3;

    ctx2d.fillStyle = `rgba(13, 13, 13, ${0.04 + decay * 0.4})`;
    ctx2d.fillRect(0, 0, w, h);

    // Bass energy from the bottom 10% of bins.
    const bassEnd = Math.max(8, Math.floor(freq.length * 0.1));
    let bass = 0;
    for (let i = 0; i < bassEnd; i++) bass += freq[i];
    bass = (bass / bassEnd) / 255;

    state.bassSmoothed = state.bassSmoothed * 0.7 + bass * 0.3;

    // Detect a "hit": current bass significantly above smoothed baseline.
    const hitThreshold = state.bassSmoothed * 1.25 + 0.05;
    const hit = bass > hitThreshold && time - state.lastHitAt > 0.12;
    if (hit) {
      state.lastHitAt = time;
      // Spawn a new ring in the oldest slot
      let oldest = 0;
      for (let i = 1; i < rings; i++) {
        if (state.ringAges[i] > state.ringAges[oldest]) oldest = i;
      }
      state.ringAges[oldest] = 0;
      state.ringEnergies[oldest] = Math.min(1, bass * 1.5);
    }

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(cx, cy);

    for (let i = 0; i < rings; i++) {
      state.ringAges[i] += 0.016 + state.ringEnergies[i] * 0.01;
      const age = state.ringAges[i];
      if (age > 3) continue;

      const e = state.ringEnergies[i];
      const r = (age / 3) * maxR;
      const alpha = Math.max(0, (1 - age / 3)) * (0.25 + e * 0.7);
      const [hH, sS, lL] = palette[i % palette.length];

      ctx2d.strokeStyle = `hsla(${hH}, ${sS}%, ${lL}%, ${alpha})`;
      ctx2d.lineWidth = thickness * (1 + e * 1.2);
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.stroke();
    }

    // Center glow on bass
    const glowR = (h * 0.04) + state.bassSmoothed * h * 0.06;
    const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    const [gH, gS, gL] = palette[0];
    grad.addColorStop(0, `hsla(${gH}, ${gS}%, ${Math.min(95, gL + 30)}%, ${0.5 + state.bassSmoothed * 0.4})`);
    grad.addColorStop(1, `hsla(${gH}, ${gS}%, ${gL}%, 0)`);
    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx2d.fill();
  },

  dispose() {},
};
