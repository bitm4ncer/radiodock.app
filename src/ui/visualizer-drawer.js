// Right-side slide-in drawer for the visualizer.
//
// - Master on/off toggle
// - Visualizer picker (grouped by category)
// - Per-visualizer control panel auto-rendered from each module's controls[]
// - Audio-mode status line
// - "Connect audio" button when getDisplayMedia is needed
// - butterchurn credit + link
//
// Hidden on coarse-pointer devices (mobile) per the desktop-only rule.

const MODE_LABELS = {
  idle: 'Idle',
  procedural: 'Decorative — pulses on track changes',
  capture: 'Live FFT (via tab capture)',
};

const CATEGORY_LABELS = {
  classic: 'Classic',
  shader: 'Shader',
  milkdrop: 'Milkdrop (via butterchurn)',
};

export function mountVisualizerDrawer({
  visualizers,
  audioSource,
  engine,
  initialEnabled,
  initialVisualizerId,
  initialControls,
  onEnabledChange,
  onVisualizerChange,
  onControlsChange,
}) {
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  if (isCoarse) return null;

  // --- Build root + DOM ---

  const root = document.createElement('div');
  root.className = 'viz-drawer';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="viz-drawer__backdrop"></div>
    <aside class="viz-drawer__panel" role="dialog" aria-label="Visualizer settings">
      <header class="viz-drawer__header">
        <h3>Visualizer</h3>
        <button class="viz-drawer__close" type="button" aria-label="Close">×</button>
      </header>

      <div class="viz-drawer__body">
        <div class="viz-drawer__toggle-row">
          <label class="viz-toggle">
            <input type="checkbox" class="viz-drawer__master" />
            <span>Enable visualizer</span>
          </label>
        </div>

        <div class="viz-drawer__status">
          <span class="viz-drawer__status-text">Audio: not started</span>
          <button type="button" class="viz-drawer__connect-btn" style="display: none;">Connect audio</button>
        </div>

        <section class="viz-drawer__list"></section>

        <section class="viz-drawer__controls"></section>
      </div>

      <footer class="viz-drawer__footer">
        Milkdrop presets powered by
        <a href="https://github.com/jberg/butterchurn" target="_blank" rel="noopener">butterchurn</a>.
      </footer>
    </aside>
  `;
  document.body.appendChild(root);

  const backdrop = root.querySelector('.viz-drawer__backdrop');
  const panel = root.querySelector('.viz-drawer__panel');
  const closeBtn = root.querySelector('.viz-drawer__close');
  const masterEl = root.querySelector('.viz-drawer__master');
  const statusEl = root.querySelector('.viz-drawer__status-text');
  const connectBtn = root.querySelector('.viz-drawer__connect-btn');
  const listEl = root.querySelector('.viz-drawer__list');
  const controlsEl = root.querySelector('.viz-drawer__controls');

  // --- State ---
  let enabled = !!initialEnabled;
  let currentId = initialVisualizerId ?? visualizers[0]?.id;
  let controlsState = JSON.parse(JSON.stringify(initialControls ?? {})); // { vizId: { ctrlId: value } }

  masterEl.checked = enabled;

  // --- Helpers ---

  function controlsFor(vizId) {
    const viz = visualizers.find((v) => v.id === vizId);
    if (!viz) return {};
    const stored = controlsState[vizId] ?? {};
    const out = {};
    for (const c of viz.controls ?? []) {
      out[c.id] = stored[c.id] ?? c.default;
    }
    return out;
  }

  function persistControls() {
    onControlsChange?.(controlsState);
  }

  function renderList() {
    const byCat = { classic: [], shader: [], milkdrop: [] };
    for (const v of visualizers) {
      (byCat[v.category] ?? (byCat[v.category] = [])).push(v);
    }

    listEl.innerHTML = '';
    for (const cat of ['classic', 'shader', 'milkdrop']) {
      const items = byCat[cat];
      if (!items || items.length === 0) continue;
      const group = document.createElement('div');
      group.className = 'viz-drawer__group';

      const heading = document.createElement('div');
      heading.className = 'viz-drawer__group-title';
      heading.textContent = CATEGORY_LABELS[cat] ?? cat;
      if (cat === 'milkdrop') {
        const link = document.createElement('a');
        link.href = 'https://github.com/jberg/butterchurn';
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'viz-drawer__group-credit';
        link.title = 'butterchurn on GitHub';
        link.textContent = 'GitHub ↗';
        heading.appendChild(link);
      }
      group.appendChild(heading);

      for (const v of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'viz-drawer__item';
        row.dataset.vizId = v.id;
        if (v.id === currentId) row.classList.add('is-active');
        row.innerHTML = `
          <span class="viz-drawer__item-name">${escapeHtml(v.name)}</span>
          <span class="viz-drawer__item-check" aria-hidden="true">✓</span>
        `;
        row.addEventListener('click', () => selectVisualizer(v.id));
        group.appendChild(row);
      }
      listEl.appendChild(group);
    }
  }

  function renderControls() {
    controlsEl.innerHTML = '';
    const viz = visualizers.find((v) => v.id === currentId);
    if (!viz) return;
    const values = controlsFor(currentId);

    if (!viz.controls || viz.controls.length === 0) {
      controlsEl.innerHTML = `<p class="viz-drawer__empty">No controls for this visualizer.</p>`;
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'viz-drawer__controls-title';
    heading.textContent = `${viz.name} controls`;
    controlsEl.appendChild(heading);

    for (const ctrl of viz.controls) {
      const wrap = document.createElement('div');
      wrap.className = 'viz-control';
      wrap.dataset.controlId = ctrl.id;

      const label = document.createElement('label');
      label.className = 'viz-control__label';
      label.textContent = ctrl.label;
      wrap.appendChild(label);

      let input;
      if (ctrl.type === 'range') {
        input = document.createElement('input');
        input.type = 'range';
        input.min = String(ctrl.min);
        input.max = String(ctrl.max);
        if (ctrl.step != null) input.step = String(ctrl.step);
        input.value = String(values[ctrl.id]);
        const readout = document.createElement('span');
        readout.className = 'viz-control__readout';
        readout.textContent = String(values[ctrl.id]);
        input.addEventListener('input', () => {
          const v = Number(input.value);
          setControl(ctrl.id, v);
          readout.textContent = String(v);
        });
        wrap.appendChild(input);
        wrap.appendChild(readout);
      } else if (ctrl.type === 'toggle') {
        const checkLabel = document.createElement('label');
        checkLabel.className = 'viz-toggle';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!values[ctrl.id];
        input.addEventListener('change', () => setControl(ctrl.id, input.checked));
        const span = document.createElement('span');
        span.textContent = 'On';
        checkLabel.appendChild(input);
        checkLabel.appendChild(span);
        wrap.appendChild(checkLabel);
      } else if (ctrl.type === 'select') {
        input = document.createElement('select');
        for (const opt of ctrl.options ?? []) {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = opt.label;
          if (String(values[ctrl.id]) === String(opt.value)) option.selected = true;
          input.appendChild(option);
        }
        input.addEventListener('change', () => setControl(ctrl.id, input.value));
        wrap.appendChild(input);
      } else if (ctrl.type === 'button') {
        input = document.createElement('button');
        input.type = 'button';
        input.className = 'viz-control__button';
        input.textContent = ctrl.label;
        input.addEventListener('click', () => {
          setControl(ctrl.id, (values[ctrl.id] ?? 0) + 1);
        });
        // Skip the label appendage for buttons — the button text IS the label.
        wrap.removeChild(label);
        wrap.appendChild(input);
      }

      controlsEl.appendChild(wrap);
    }
  }

  function setControl(ctrlId, value) {
    if (!controlsState[currentId]) controlsState[currentId] = {};
    controlsState[currentId][ctrlId] = value;
    engine.setControls(controlsFor(currentId));
    persistControls();
  }

  function selectVisualizer(id) {
    if (id === currentId) return;
    currentId = id;
    listEl.querySelectorAll('.viz-drawer__item').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.vizId === id);
    });
    const viz = visualizers.find((v) => v.id === id);
    engine.setControls(controlsFor(id));
    engine.setVisualizer(viz);
    renderControls();
    onVisualizerChange?.(id);
  }

  function updateStatus() {
    const mode = audioSource.getMode();
    statusEl.textContent = MODE_LABELS[mode] ?? '';
    const showConnect = mode !== 'capture' && audioSource.captureSupported();
    connectBtn.style.display = showConnect ? '' : 'none';
  }

  // --- Wire events ---

  function open() {
    root.classList.add('show');
    root.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', onKeydown);
  }
  function close() {
    root.classList.remove('show');
    root.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(evt) {
    if (evt.key === 'Escape') close();
  }
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  masterEl.addEventListener('change', () => {
    enabled = masterEl.checked;
    onEnabledChange?.(enabled);
  });

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Waiting for permission…';
    try {
      await audioSource.requestUpgrade();
      updateStatus();
    } catch (err) {
      console.warn('Capture upgrade failed:', err);
      statusEl.textContent = err?.message ?? 'Audio capture failed';
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect audio';
    }
  });

  audioSource.onModeChange(() => updateStatus());

  renderList();
  renderControls();
  updateStatus();

  return {
    open,
    close,
    isOpen: () => root.classList.contains('show'),
    setEnabled: (v) => {
      enabled = !!v;
      masterEl.checked = enabled;
    },
    getCurrentVisualizerId: () => currentId,
    getControlsFor: controlsFor,
    refresh: () => { renderList(); renderControls(); updateStatus(); },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
