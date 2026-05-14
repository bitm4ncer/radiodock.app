// Gray-Scott reaction-diffusion with audio-modulated feed/kill.
// Two-pass: simulation step into ping-pong FBO, then a colored display pass.

const SIM_VERT = `
precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const SIM_FRAG = `
precision highp float;
uniform sampler2D src;
uniform vec2 texel;
uniform float feed;
uniform float kill;
uniform float diffuseA;
uniform float diffuseB;
uniform float dt;
uniform float audioBass;
uniform float audioTreble;
varying vec2 vUv;

vec2 laplacian(vec2 uv) {
  vec2 c = texture2D(src, uv).rg;
  vec2 sum = vec2(0.0);
  sum += texture2D(src, uv + vec2(-texel.x, 0.0)).rg * 0.2;
  sum += texture2D(src, uv + vec2( texel.x, 0.0)).rg * 0.2;
  sum += texture2D(src, uv + vec2(0.0, -texel.y)).rg * 0.2;
  sum += texture2D(src, uv + vec2(0.0,  texel.y)).rg * 0.2;
  sum += texture2D(src, uv + vec2(-texel.x, -texel.y)).rg * 0.05;
  sum += texture2D(src, uv + vec2( texel.x, -texel.y)).rg * 0.05;
  sum += texture2D(src, uv + vec2(-texel.x,  texel.y)).rg * 0.05;
  sum += texture2D(src, uv + vec2( texel.x,  texel.y)).rg * 0.05;
  return sum - c;
}

void main() {
  vec2 ab = texture2D(src, vUv).rg;
  float a = ab.r;
  float b = ab.g;
  vec2 lap = laplacian(vUv);
  float dA = diffuseA * lap.r - a * b * b + (feed + audioBass * 0.02) * (1.0 - a);
  float dB = diffuseB * lap.g + a * b * b - (kill + audioTreble * 0.015) * b;
  vec2 next = vec2(a + dA * dt, b + dB * dt);
  next = clamp(next, 0.0, 1.0);
  gl_FragColor = vec4(next, 0.0, 1.0);
}`;

const DISPLAY_FRAG = `
precision highp float;
uniform sampler2D src;
uniform float hue;
uniform float bass;
uniform float time;
varying vec2 vUv;

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);
  return c.z + c.y * (rgb-0.5) * (1.0-abs(2.0*c.z-1.0));
}

void main() {
  float v = texture2D(src, vUv).g;
  float intensity = pow(v, 0.7);
  float h = mod(hue / 360.0 + intensity * 0.35 + bass * 0.08, 1.0);
  float s = 0.6 + 0.3 * intensity;
  float l = 0.05 + intensity * 0.65;
  vec3 col = hsl2rgb(vec3(h, s, l));
  // Subtle vignette
  vec2 p = vUv - 0.5;
  float vig = smoothstep(0.85, 0.3, length(p));
  col *= 0.6 + 0.4 * vig;
  gl_FragColor = vec4(col, 1.0);
}`;

const SEEDS = {
  spot: 'spot',
  spots: 'spots',
  bar: 'bar',
  noise: 'noise',
};

function seedInitialData(width, height, seed) {
  const arr = new Uint8Array(width * height * 4);
  // Default: A=1, B=0 → set R=255, G=0
  for (let i = 0; i < arr.length; i += 4) {
    arr[i] = 255;
    arr[i + 1] = 0;
    arr[i + 2] = 0;
    arr[i + 3] = 255;
  }

  if (seed === 'spot') {
    seedDisc(arr, width, height, width / 2, height / 2, Math.min(width, height) * 0.04);
  } else if (seed === 'spots') {
    for (let s = 0; s < 6; s++) {
      const cx = Math.random() * width;
      const cy = Math.random() * height;
      seedDisc(arr, width, height, cx, cy, Math.min(width, height) * 0.025);
    }
  } else if (seed === 'bar') {
    const cx = width / 2;
    const cy = height / 2;
    const bw = width * 0.25;
    const bh = height * 0.04;
    for (let y = Math.floor(cy - bh); y < cy + bh; y++) {
      for (let x = Math.floor(cx - bw); x < cx + bw; x++) {
        const idx = (y * width + x) * 4;
        arr[idx + 1] = 220;
      }
    }
  } else if (seed === 'noise') {
    for (let i = 0; i < 200; i++) {
      const cx = Math.random() * width;
      const cy = Math.random() * height;
      seedDisc(arr, width, height, cx, cy, Math.min(width, height) * 0.01);
    }
  }
  return arr;
}

function seedDisc(arr, w, h, cx, cy, r) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (y * w + x) * 4;
        arr[idx + 1] = 230;
      }
    }
  }
}

const SIM_RES = 384; // simulation grid resolution (square); display upscales

export default {
  id: 'reaction-diffusion',
  name: 'Reaction-Diffusion',
  category: 'shader',
  kind: 'shader',
  controls: [
    { id: 'hue', label: 'Hue', type: 'range', min: 0, max: 360, step: 1, default: 280 },
    { id: 'feed', label: 'Feed', type: 'range', min: 0.01, max: 0.08, step: 0.001, default: 0.037 },
    { id: 'kill', label: 'Kill', type: 'range', min: 0.04, max: 0.075, step: 0.0005, default: 0.06 },
    { id: 'speed', label: 'Speed', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.4 },
    {
      id: 'seed',
      label: 'Seed',
      type: 'select',
      options: [
        { value: 'spot', label: 'Single spot' },
        { value: 'spots', label: 'Random spots' },
        { value: 'bar', label: 'Bar' },
        { value: 'noise', label: 'Noise' },
      ],
      default: 'spots',
    },
    { id: 'reset', label: 'Reset', type: 'button' },
  ],

  init({ regl }) {
    const seed = 'spots';
    const initialData = seedInitialData(SIM_RES, SIM_RES, seed);
    const makeFbo = (data) => regl.framebuffer({
      color: regl.texture({
        width: SIM_RES,
        height: SIM_RES,
        data,
        mag: 'nearest',
        min: 'nearest',
        wrapS: 'clamp',
        wrapT: 'clamp',
      }),
      depthStencil: false,
    });
    const a = makeFbo(initialData);
    const b = makeFbo(initialData);

    const quad = regl({
      vert: SIM_VERT,
      attributes: { position: [-1, -1, 3, -1, -1, 3] },
      count: 3,
    });

    const simCmd = regl({
      vert: SIM_VERT,
      frag: SIM_FRAG,
      attributes: { position: [-1, -1, 3, -1, -1, 3] },
      uniforms: {
        src: regl.prop('src'),
        texel: [1 / SIM_RES, 1 / SIM_RES],
        feed: regl.prop('feed'),
        kill: regl.prop('kill'),
        diffuseA: 1.0,
        diffuseB: 0.5,
        dt: regl.prop('dt'),
        audioBass: regl.prop('audioBass'),
        audioTreble: regl.prop('audioTreble'),
      },
      framebuffer: regl.prop('dst'),
      count: 3,
    });

    const displayCmd = regl({
      vert: SIM_VERT,
      frag: DISPLAY_FRAG,
      attributes: { position: [-1, -1, 3, -1, -1, 3] },
      uniforms: {
        src: regl.prop('src'),
        hue: regl.prop('hue'),
        bass: regl.prop('bass'),
        time: regl.prop('time'),
      },
      count: 3,
    });

    return {
      regl,
      ping: a,
      pong: b,
      simCmd,
      displayCmd,
      currentSeed: seed,
      lastResetTrigger: 0,
    };
  },

  render({ regl, state, audioData, time, controls }) {
    if (!regl || !state) return;

    // Handle reset trigger (button increments a counter)
    if (controls.reset && controls.reset !== state.lastResetTrigger) {
      const seed = controls.seed ?? 'spots';
      const data = seedInitialData(SIM_RES, SIM_RES, seed);
      state.ping.destroy();
      state.pong.destroy();
      const mk = (d) => regl.framebuffer({
        color: regl.texture({
          width: SIM_RES,
          height: SIM_RES,
          data: d,
          mag: 'nearest',
          min: 'nearest',
          wrapS: 'clamp',
          wrapT: 'clamp',
        }),
        depthStencil: false,
      });
      state.ping = mk(data);
      state.pong = mk(data);
      state.currentSeed = seed;
      state.lastResetTrigger = controls.reset;
    }

    // Audio energy
    const freq = audioData.freq;
    let bass = 0, treble = 0;
    const bassEnd = Math.floor(freq.length * 0.08);
    const trebleStart = Math.floor(freq.length * 0.5);
    for (let i = 0; i < bassEnd; i++) bass += freq[i];
    for (let i = trebleStart; i < freq.length; i++) treble += freq[i];
    bass = bass / bassEnd / 255;
    treble = treble / (freq.length - trebleStart) / 255;

    const feed = controls.feed ?? 0.037;
    const kill = controls.kill ?? 0.06;
    const speed = controls.speed ?? 1.4;
    const hue = controls.hue ?? 280;

    // Multiple sim steps per frame for stability + perceived speed.
    const steps = Math.max(1, Math.min(6, Math.floor(speed * 2)));
    for (let i = 0; i < steps; i++) {
      state.simCmd({
        src: state.ping,
        dst: state.pong,
        feed,
        kill,
        dt: 1.0,
        audioBass: bass,
        audioTreble: treble,
      });
      const tmp = state.ping; state.ping = state.pong; state.pong = tmp;
    }

    regl.clear({ color: [0, 0, 0, 1], depth: 1 });
    state.displayCmd({ src: state.ping, hue, bass, time });
  },

  dispose(state) {
    try { state?.ping?.destroy(); } catch {}
    try { state?.pong?.destroy(); } catch {}
  },
};
