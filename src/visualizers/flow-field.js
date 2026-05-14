// Audio-modulated noise flow field rendered as a single full-screen shader.
// No real particles — a fragment shader integrates noise streamlines for
// each pixel so we keep it purely GPU.

const VERT = `
precision highp float;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform float time;
uniform vec2 resolution;
uniform float bass;
uniform float treble;
uniform float hue;
uniform float hueRange;
uniform float speed;
uniform float turbulence;
varying vec2 vUv;

// Simplex-ish 2D noise via hash + smoothstep
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);
  return c.z + c.y * (rgb-0.5) * (1.0-abs(2.0*c.z-1.0));
}

void main() {
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = (vUv - 0.5) * aspect * 2.0;

  // Trace a short streamline by stepping through a noise-driven angle field.
  float intensity = 0.0;
  vec2 q = p;
  float t = time * speed * 0.3;
  float audio = 0.6 + bass * 1.4;

  for (int i = 0; i < 16; i++) {
    float n = fbm(q * (1.2 + turbulence * 0.6) + vec2(t * 0.4, t * 0.31));
    float angle = n * 6.2831853 * (1.0 + turbulence * 0.5);
    vec2 dir = vec2(cos(angle), sin(angle));
    q += dir * 0.022 * audio;
    intensity += 0.06 * (0.7 + treble * 1.2);
  }

  float density = fbm(q * 3.0 + vec2(time * 0.15, 0.0));
  density = pow(density, 1.4);

  float h = mod((hue + density * hueRange) / 360.0, 1.0);
  float s = 0.5 + 0.4 * density + bass * 0.1;
  float l = 0.05 + intensity * density * 1.4;
  vec3 col = hsl2rgb(vec3(h, s, l));

  // Soft vignette
  vec2 vp = vUv - 0.5;
  float vig = smoothstep(0.85, 0.25, length(vp));
  col *= 0.55 + 0.45 * vig;

  gl_FragColor = vec4(col, 1.0);
}`;

export default {
  id: 'flow-field',
  name: 'Flow Field',
  category: 'shader',
  kind: 'shader',
  controls: [
    { id: 'hue', label: 'Hue', type: 'range', min: 0, max: 360, step: 1, default: 30 },
    { id: 'hueRange', label: 'Hue range', type: 'range', min: 0, max: 240, step: 1, default: 60 },
    { id: 'speed', label: 'Speed', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1.0 },
    { id: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.6 },
  ],

  init({ regl }) {
    const cmd = regl({
      vert: VERT,
      frag: FRAG,
      attributes: { position: [-1, -1, 3, -1, -1, 3] },
      uniforms: {
        time: regl.prop('time'),
        resolution: regl.prop('resolution'),
        bass: regl.prop('bass'),
        treble: regl.prop('treble'),
        hue: regl.prop('hue'),
        hueRange: regl.prop('hueRange'),
        speed: regl.prop('speed'),
        turbulence: regl.prop('turbulence'),
      },
      count: 3,
    });
    return { regl, cmd };
  },

  render({ regl, state, audioData, time, controls, viewport }) {
    if (!regl || !state) return;

    const freq = audioData.freq;
    let bass = 0, treble = 0;
    const bassEnd = Math.floor(freq.length * 0.08);
    const trebleStart = Math.floor(freq.length * 0.5);
    for (let i = 0; i < bassEnd; i++) bass += freq[i];
    for (let i = trebleStart; i < freq.length; i++) treble += freq[i];
    bass = bass / bassEnd / 255;
    treble = treble / (freq.length - trebleStart) / 255;

    regl.clear({ color: [0, 0, 0, 1], depth: 1 });
    state.cmd({
      time,
      resolution: [viewport.width, viewport.height],
      bass,
      treble,
      hue: controls.hue ?? 30,
      hueRange: controls.hueRange ?? 60,
      speed: controls.speed ?? 1.0,
      turbulence: controls.turbulence ?? 0.6,
    });
  },

  dispose() {},
};
