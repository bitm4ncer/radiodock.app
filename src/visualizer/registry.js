// Flat registry of in-house visualizers. butterchurn presets are loaded
// lazily and registered separately on first activation (see
// butterchurn-preset.js).
//
// Each module exports a default object with this shape:
//   {
//     id: string,
//     name: string,
//     category: 'classic' | 'shader' | 'milkdrop',
//     kind: 'canvas2d' | 'shader',
//     controls: Array<{ id, label, type, ... }>,
//     init(ctx) -> state,
//     render(ctx) -> void,
//     dispose(state) -> void,
//   }

import spectrumBars from '../visualizers/spectrum-bars.js';
import oscilloscope from '../visualizers/oscilloscope.js';
import radialPulse from '../visualizers/radial-pulse.js';
import reactionDiffusion from '../visualizers/reaction-diffusion.js';
import flowField from '../visualizers/flow-field.js';
import butterchurnPreset from '../visualizers/butterchurn-preset.js';

// butterchurn-preset.js's top-level only declares a stub; the heavy
// `butterchurn` + `butterchurn-presets` packages are loaded via dynamic
// imports inside its init(), so they stay out of the initial bundle.

export const visualizers = [
  spectrumBars,
  oscilloscope,
  radialPulse,
  reactionDiffusion,
  flowField,
  butterchurnPreset,
];

export function findVisualizer(id) {
  return visualizers.find((v) => v.id === id);
}

export function visualizersByCategory() {
  const out = { classic: [], shader: [], milkdrop: [] };
  for (const v of visualizers) {
    (out[v.category] ?? (out[v.category] = [])).push(v);
  }
  return out;
}
