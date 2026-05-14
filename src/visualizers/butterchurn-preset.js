// Milkdrop visualizer powered by butterchurn (https://github.com/jberg/butterchurn).
//
// butterchurn manages its own WebGL canvas. The engine creates a dedicated
// canvas for it and we hand it over here. The preset list is loaded on first
// activation via dynamic import — keeps butterchurn out of the initial bundle.

let butterchurnMod = null;
let presetsMod = null;
let cachedPresetNames = null;

async function loadButterchurn() {
  if (butterchurnMod) return butterchurnMod;
  butterchurnMod = await import('butterchurn');
  return butterchurnMod;
}

async function loadPresets() {
  if (presetsMod) return presetsMod;
  presetsMod = await import('butterchurn-presets');
  return presetsMod;
}

// A small curated list of preset names known to ship with butterchurn-presets.
// We let the user pick by name; if the name isn't found we fall back to the
// first available preset.
const CURATED_PRESETS = [
  'Flexi - mindblob mix',
  'martin - mandelbox explorer - high speed demo',
  'Geiss - Reaction Diffusion 2',
  'Flexi, martin + geiss - dedicated to the sherwin maxawow',
  'cope + martin - mother-of-pearl',
  '$$$ Royal - Mashup (197)',
];

export default {
  id: 'butterchurn',
  name: 'Milkdrop (butterchurn)',
  category: 'milkdrop',
  kind: 'milkdrop',
  attribution: {
    label: 'butterchurn',
    url: 'https://github.com/jberg/butterchurn',
  },
  controls: [
    { id: 'preset', label: 'Preset', type: 'select', options: [], default: CURATED_PRESETS[0] },
    { id: 'blendSeconds', label: 'Blend (s)', type: 'range', min: 0, max: 6, step: 0.1, default: 1.0 },
  ],

  // Engine reads this to populate the preset select after the module loads.
  // We need an async loader for the options list, exposed as a static helper.
  async getPresetOptions() {
    if (cachedPresetNames) return cachedPresetNames;
    const presets = await loadPresets();
    const all = presets.default ? presets.default.getPresets() : presets.getPresets?.();
    const names = Object.keys(all ?? {});
    cachedPresetNames = names.map((n) => ({ value: n, label: n }));
    return cachedPresetNames;
  },

  async init({ canvas, audioContext, sourceNode }) {
    if (!audioContext) {
      console.warn('butterchurn requires an AudioContext (visualizer must be enabled first)');
      return { unavailable: true };
    }

    const [bc, presets] = await Promise.all([loadButterchurn(), loadPresets()]);
    const create = (bc.default ?? bc).createVisualizer;
    const visualizer = create(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
      pixelRatio: 1,
    });

    if (sourceNode) {
      try { visualizer.connectAudio(sourceNode); } catch (err) {
        console.warn('butterchurn connectAudio failed:', err);
      }
    }

    const presetMap = (presets.default ?? presets).getPresets();
    const names = Object.keys(presetMap);

    // Hydrate the controls.options on first init so the drawer's select can
    // populate. We mutate this module's controls in place; safe because the
    // engine reads it lazily.
    const moduleSelf = (await import('./butterchurn-preset.js')).default;
    if (moduleSelf?.controls) {
      const presetCtrl = moduleSelf.controls.find((c) => c.id === 'preset');
      if (presetCtrl) {
        presetCtrl.options = names.map((n) => ({ value: n, label: n }));
        // Pick a curated default that actually exists
        const firstAvailableCurated = CURATED_PRESETS.find((n) => names.includes(n));
        presetCtrl.default = firstAvailableCurated ?? names[0];
      }
    }

    // Load the initial preset (curated → first)
    const startName = CURATED_PRESETS.find((n) => names.includes(n)) ?? names[0];
    if (startName) {
      try { visualizer.loadPreset(presetMap[startName], 0.0); } catch (err) {
        console.warn('butterchurn loadPreset failed:', err);
      }
    }

    return {
      visualizer,
      presetMap,
      names,
      currentPreset: startName,
      blendSeconds: 1.0,
    };
  },

  render({ state, controls, viewport }) {
    if (!state || state.unavailable) return;
    const { visualizer, presetMap, currentPreset } = state;

    // Resize sync (butterchurn was init'd with starting dims; here we just
    // re-render at current canvas dims).
    try {
      if (visualizer.setRendererSize && (state.lastW !== viewport.width || state.lastH !== viewport.height)) {
        visualizer.setRendererSize(viewport.width, viewport.height);
        state.lastW = viewport.width;
        state.lastH = viewport.height;
      }
    } catch {}

    // Preset switch
    const wantPreset = controls.preset ?? currentPreset;
    if (wantPreset && wantPreset !== state.currentPreset && presetMap[wantPreset]) {
      try {
        visualizer.loadPreset(presetMap[wantPreset], controls.blendSeconds ?? 1.0);
        state.currentPreset = wantPreset;
      } catch (err) {
        console.warn('butterchurn preset switch failed:', err);
      }
    }

    try {
      visualizer.render();
    } catch (err) {
      console.warn('butterchurn render failed:', err);
    }
  },

  resize({ state, width, height }) {
    if (!state || state.unavailable) return;
    try { state.visualizer?.setRendererSize?.(width, height); } catch {}
  },

  dispose(state) {
    if (state?.visualizer && typeof state.visualizer.disconnectAudio === 'function') {
      try { state.visualizer.disconnectAudio(); } catch {}
    }
  },
};
