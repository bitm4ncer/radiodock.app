// Single-line waveform / oscilloscope.

export default {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  category: 'classic',
  kind: 'canvas2d',
  controls: [
    { id: 'hue', label: 'Hue', type: 'range', min: 0, max: 360, step: 1, default: 140 },
    { id: 'thickness', label: 'Line width', type: 'range', min: 1, max: 8, step: 1, default: 2 },
    { id: 'glow', label: 'Glow', type: 'toggle', default: true },
    { id: 'amplify', label: 'Amplify', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.4 },
  ],

  init() {
    return {};
  },

  render({ ctx2d, canvas, audioData, controls }) {
    const w = canvas.width;
    const h = canvas.height;
    const time = audioData.time;

    const hue = controls.hue ?? 140;
    const thickness = controls.thickness ?? 2;
    const glow = controls.glow !== false;
    const amplify = controls.amplify ?? 1.4;

    ctx2d.fillStyle = 'rgba(13, 13, 13, 0.18)';
    ctx2d.fillRect(0, 0, w, h);

    const midY = h / 2;
    const len = time.length;
    const step = w / len;

    ctx2d.lineWidth = thickness * (canvas.height / 800);
    ctx2d.strokeStyle = `hsl(${hue}, 90%, 60%)`;

    if (glow) {
      ctx2d.shadowColor = `hsla(${hue}, 90%, 60%, 0.85)`;
      ctx2d.shadowBlur = 18 * (canvas.height / 800);
    } else {
      ctx2d.shadowBlur = 0;
    }

    ctx2d.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (time[i] - 128) / 128 * amplify;
      const x = i * step;
      const y = midY + v * (h * 0.35);
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;
  },

  dispose() {},
};
