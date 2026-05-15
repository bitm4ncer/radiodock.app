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
    onEnabledChange: (next) => {
      if (next) startEverything();
      else stopEverything();
      setPref(PREF_ENABLED, next).catch(() => {});
    },
    onVisualizerChange: (id) => {
      setPref(PREF_VIZ_ID, id).catch(() => {});
    },
    onControlsChange: (map) => {
      setPref(PREF_CONTROLS, map).catch(() => {});
    },
  });

  function startEverything() {
    audioSource.start();
    engine.setControls(drawer.getControlsFor(drawer.getCurrentVisualizerId()));
    engine.setVisualizer(findVisualizer(drawer.getCurrentVisualizerId()) ?? visualizers[0]);
    engine.start();
    document.body.classList.add('viz-active');
  }

  function stopEverything() {
    engine.stop();
    document.body.classList.remove('viz-active');
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
  const container = document.getElementById('app');
  if (!container) return;

  // Mount inside the main .container (#app) — top-right corner. Shares the
  // .tool-btn pattern with the drag handle + minimize button so they form a
  // visually consistent horizontal strip and all get the slide-out hover pill.
  container.classList.add('has-tools');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tool-btn viz-trigger-btn';
  btn.title = 'Open visualizer';
  btn.dataset.label = 'Visuals';
  btn.setAttribute('aria-label', 'Open visualizer settings');
  btn.innerHTML = `
    <span class="tool-btn__pill" aria-hidden="true">Visuals</span>
    <span class="tool-btn__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12h2l2-7 3 14 3-10 3 7 2-4h3"/>
      </svg>
    </span>
  `;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}
