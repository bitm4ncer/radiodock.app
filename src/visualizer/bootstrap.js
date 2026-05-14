// Bootstraps the visualizer feature: audio source, engine, drawer, trigger button.
// Hidden entirely on coarse-pointer devices (mobile). Designed to coexist with
// the in-flight frosted-card work — does not touch player-card.js or its CSS.

import { createAudioSource } from './audio-source.js';
import { createEngine } from './engine.js';
import { visualizers, findVisualizer } from './registry.js';
import { mountVisualizerDrawer } from '../ui/visualizer-drawer.js';
import { getPref, setPref } from '../data/storage.js';

const PREF_ENABLED = 'visualizerEnabled';
const PREF_VIZ_ID = 'visualizerId';
const PREF_CONTROLS = 'visualizerControls';

export async function mountVisualizer({ player }) {
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  if (isCoarse) return null; // desktop-only

  const [enabled, vizId, controls] = await Promise.all([
    getPref(PREF_ENABLED, false),
    getPref(PREF_VIZ_ID, visualizers[0]?.id),
    getPref(PREF_CONTROLS, {}),
  ]);

  const audioSource = createAudioSource(player);
  const engine = createEngine({ audioSource });

  const initialViz = findVisualizer(vizId) ?? visualizers[0];

  const drawer = mountVisualizerDrawer({
    visualizers,
    audioSource,
    engine,
    initialEnabled: enabled,
    initialVisualizerId: initialViz.id,
    initialControls: controls,
    onEnabledChange: async (next) => {
      await setPref(PREF_ENABLED, next);
      if (next) startEverything();
      else stopEverything();
    },
    onVisualizerChange: async (id) => {
      await setPref(PREF_VIZ_ID, id);
    },
    onControlsChange: async (map) => {
      await setPref(PREF_CONTROLS, map);
    },
  });

  function startEverything() {
    audioSource.start();
    engine.setControls(drawer.getControlsFor(drawer.getCurrentVisualizerId()));
    engine.setVisualizer(findVisualizer(drawer.getCurrentVisualizerId()) ?? visualizers[0]);
    engine.start();
  }

  function stopEverything() {
    engine.stop();
  }

  // Insert the trigger button into the player card area at runtime.
  mountTriggerButton(() => {
    drawer.open();
  });

  // Restore previous "on" state.
  if (enabled) {
    startEverything();
  }

  return { drawer, engine, audioSource };
}

function mountTriggerButton(onClick) {
  const card = document.getElementById('playerCard');
  if (!card) return;

  // Make the card position:relative so absolute children anchor to it.
  if (getComputedStyle(card).position === 'static') {
    card.style.position = 'relative';
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'viz-trigger-btn';
  btn.title = 'Visualizer';
  btn.setAttribute('aria-label', 'Open visualizer settings');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 18V12"/>
      <path d="M8 18V8"/>
      <path d="M12 18V4"/>
      <path d="M16 18V10"/>
      <path d="M20 18V14"/>
    </svg>
  `;
  btn.addEventListener('click', onClick);
  card.appendChild(btn);
}
