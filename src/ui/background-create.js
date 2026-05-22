// Mesh-gradient editor for backgrounds. Opened from the background menu's
// "Create gradient" item, lives bottom-right alongside the gallery panel.
//
// While the panel is open:
//   - The four mesh points have draggable handles overlaid on the viewport.
//   - The user can pick a preset to seed the working spec, swap a point's
//     colour via the 7-swatch row or a custom <input type=color>, resize
//     the selected point with a slider, and toggle drift.
//   - The active background layer (managed by background.js) reflects the
//     working spec in real time via the same applyGradientToLayer pipeline
//     used for persisted gradients — preview ≡ render.
//
// Save / Cancel are explicit. Cancel restores the pre-open visual state
// (the snapshot is captured by the orchestrator before applying our
// preview); Save persists the spec to IndexedDB and the orchestrator
// makes the new entry the current background. Esc / outside-click =
// Cancel (low-stakes preview — no confirm dialog).

import { SWATCHES, PRESETS, defaultSpec, cloneSpec } from '../data/gradient-presets.js';

export function createBackgroundEditor({ onPreview, onSave, onCancel }) {
  let panel = null;
  let handles = [];        // [{ el, idx }] — the four draggable overlay handles
  let handlesRoot = null;  // shared container for the handles
  let open = false;
  let spec = defaultSpec();
  let selectedPoint = 0;

  // --- mount (lazy) ---------------------------------------------------------

  function mount() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'bg-create';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Create background gradient');
    panel.innerHTML = `
      <header class="bg-create__header">
        <h3 class="bg-create__title">Create gradient</h3>
        <button type="button" class="bg-create__close" aria-label="Cancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"/>
          </svg>
        </button>
      </header>
      <div class="bg-create__body">
        <section class="bg-create__group">
          <h4 class="bg-create__group-title">Presets</h4>
          <div class="bg-create__presets"></div>
        </section>

        <section class="bg-create__group">
          <h4 class="bg-create__group-title">Point</h4>
          <div class="bg-create__points" role="tablist"></div>
        </section>

        <section class="bg-create__group">
          <h4 class="bg-create__group-title">Colour</h4>
          <div class="bg-create__swatches"></div>
          <div class="bg-create__custom">
            <label class="bg-create__custom-label">
              <span>Custom</span>
              <input type="color" class="bg-create__custom-input" value="#ffffff" />
            </label>
          </div>
        </section>

        <section class="bg-create__group">
          <h4 class="bg-create__group-title">Size</h4>
          <input type="range" class="bg-create__size" min="0.4" max="2.2" step="0.01" value="0.7" />
        </section>

        <section class="bg-create__group">
          <label class="bg-create__drift">
            <input type="checkbox" class="bg-create__drift-input" />
            <span>Drift slowly</span>
          </label>
        </section>
      </div>
      <footer class="bg-create__footer">
        <button type="button" class="bg-create__btn bg-create__btn--ghost" data-action="cancel">Cancel</button>
        <button type="button" class="bg-create__btn bg-create__btn--primary" data-action="save">Save to Gallery</button>
      </footer>
    `;
    document.body.appendChild(panel);

    handlesRoot = document.createElement('div');
    handlesRoot.className = 'bg-mesh-handles';
    handlesRoot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(handlesRoot);
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'bg-mesh-handle';
      h.dataset.idx = String(i);
      h.setAttribute('aria-label', `Mesh point ${i + 1}`);
      // Pointer wiring — the button itself is the drag handle; clicking
      // (no movement) just selects the point.
      h.addEventListener('pointerdown', (evt) => startDrag(evt, i));
      handlesRoot.appendChild(h);
      handles.push({ el: h, idx: i });
    }

    // Build static rows that don't depend on `spec`.
    renderPresets();
    renderPoints();
    renderSwatches();

    // Wiring
    panel.querySelector('.bg-create__close').addEventListener('click', cancel);
    panel.querySelector('[data-action="cancel"]').addEventListener('click', cancel);
    panel.querySelector('[data-action="save"]').addEventListener('click', save);
    panel.querySelector('.bg-create__size').addEventListener('input', onSizeChange);
    panel.querySelector('.bg-create__custom-input').addEventListener('input', onCustomColour);
    panel.querySelector('.bg-create__drift-input').addEventListener('change', onDriftChange);

    document.addEventListener('keydown', onKeyDown);
  }

  // --- rendering ------------------------------------------------------------

  function renderPresets() {
    const list = panel.querySelector('.bg-create__presets');
    list.innerHTML = '';
    for (const preset of PRESETS) {
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'bg-create__preset';
      thumb.title = preset.name;
      thumb.setAttribute('aria-label', `Preset: ${preset.name}`);
      applyGradientToElement(thumb, preset);
      thumb.addEventListener('click', () => loadSpec(cloneSpec(preset)));
      list.appendChild(thumb);
    }
  }

  function renderPoints() {
    const row = panel.querySelector('.bg-create__points');
    row.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-create__point';
      btn.dataset.idx = String(i);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-label', `Point ${i + 1}`);
      btn.textContent = String(i + 1);
      btn.addEventListener('click', () => selectPoint(i));
      row.appendChild(btn);
    }
  }

  function renderSwatches() {
    const row = panel.querySelector('.bg-create__swatches');
    row.innerHTML = '';
    for (const s of SWATCHES) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'bg-create__swatch';
      sw.style.background = s.color;
      sw.title = s.name;
      sw.setAttribute('aria-label', s.name);
      sw.addEventListener('click', () => setPointColor(s.color));
      row.appendChild(sw);
    }
  }

  // Refresh stateful UI (selected point, current colours, drift toggle, etc.)
  // after the spec changes — cheap, called on every commit.
  function refreshUI() {
    // Point tabs
    panel.querySelectorAll('.bg-create__point').forEach((btn, i) => {
      btn.classList.toggle('is-selected', i === selectedPoint);
      btn.style.background = spec.points[i].color;
    });

    // Size slider reflects the selected point
    const sizeInput = panel.querySelector('.bg-create__size');
    sizeInput.value = spec.points[selectedPoint].size;

    // Custom-colour input reflects the selected point
    panel.querySelector('.bg-create__custom-input').value = spec.points[selectedPoint].color;

    // Drift toggle
    panel.querySelector('.bg-create__drift-input').checked = !!spec.drift;

    // Handle positions + colours
    for (const h of handles) {
      const p = spec.points[h.idx];
      h.el.style.left = (p.x * 100) + '%';
      h.el.style.top = (p.y * 100) + '%';
      h.el.style.background = p.color;
      h.el.classList.toggle('is-selected', h.idx === selectedPoint);
    }
  }

  // --- spec mutations -------------------------------------------------------

  function loadSpec(next) {
    spec = next;
    selectedPoint = 0;
    refreshUI();
    onPreview?.(spec);
  }

  function selectPoint(i) {
    if (i < 0 || i > 3) return;
    selectedPoint = i;
    refreshUI();
  }

  function setPointColor(hex) {
    spec.points[selectedPoint].color = hex;
    refreshUI();
    onPreview?.(spec);
  }

  function onCustomColour(evt) {
    setPointColor(evt.target.value);
  }

  function onSizeChange(evt) {
    spec.points[selectedPoint].size = Number(evt.target.value);
    onPreview?.(spec);
  }

  function onDriftChange(evt) {
    spec.drift = !!evt.target.checked;
    onPreview?.(spec);
  }

  // --- dragging -------------------------------------------------------------

  function startDrag(evt, idx) {
    if (evt.button !== 0 && evt.button !== undefined) return;
    selectPoint(idx);
    const handle = handles[idx].el;
    handle.setPointerCapture(evt.pointerId);
    handle.classList.add('is-dragging');

    const onMove = (e) => {
      const x = Math.max(0, Math.min(1, e.clientX / window.innerWidth));
      const y = Math.max(0, Math.min(1, e.clientY / window.innerHeight));
      spec.points[idx].x = x;
      spec.points[idx].y = y;
      handle.style.left = (x * 100) + '%';
      handle.style.top = (y * 100) + '%';
      onPreview?.(spec);
    };
    const onUp = () => {
      handle.classList.remove('is-dragging');
      try { handle.releasePointerCapture(evt.pointerId); } catch {}
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    evt.preventDefault();
  }

  // --- open / save / cancel -------------------------------------------------

  function openEditor(seedSpec) {
    mount();
    spec = cloneSpec(seedSpec ?? defaultSpec());
    selectedPoint = 0;
    panel.classList.add('is-open');
    handlesRoot.classList.add('is-open');
    open = true;
    refreshUI();
    onPreview?.(spec);
  }

  function closeEditor() {
    if (!panel) return;
    panel.classList.remove('is-open');
    handlesRoot?.classList.remove('is-open');
    open = false;
  }

  function save() {
    const finalSpec = cloneSpec(spec);
    closeEditor();
    onSave?.(finalSpec);
  }

  function cancel() {
    closeEditor();
    onCancel?.();
  }

  function onKeyDown(evt) {
    if (!open) return;
    if (evt.key === 'Escape') {
      evt.stopPropagation();
      cancel();
    }
  }

  return {
    open: openEditor,
    close: closeEditor,
    isOpen: () => open,
  };
}

// --- shared with background.js: render a spec onto a single element ---------

// Sets background-related CSS variables on `el` and toggles the
// `[data-gradient]` attribute so the CSS rule kicks in. Exported because
// background.js, background-gallery.js, AND the preset-thumb builder
// above all paint specs onto elements — single source of truth.
export function applyGradientToElement(el, spec) {
  if (!el || !spec) return;
  for (let i = 0; i < 4; i++) {
    const p = spec.points[i];
    el.style.setProperty(`--p${i}-x`, (p.x * 100) + '%');
    el.style.setProperty(`--p${i}-y`, (p.y * 100) + '%');
    el.style.setProperty(`--p${i}-c`, p.color);
    el.style.setProperty(`--p${i}-r`, (p.size * 100) + '%');
  }
  el.style.setProperty('--base', spec.base);
  el.dataset.gradient = '1';
  // Clear any inline backgroundImage left over from a previous image apply;
  // the [data-gradient] CSS rule defines the full `background` shorthand.
  el.style.backgroundImage = '';
}

export function clearGradientFromElement(el) {
  if (!el) return;
  delete el.dataset.gradient;
  for (let i = 0; i < 4; i++) {
    el.style.removeProperty(`--p${i}-x`);
    el.style.removeProperty(`--p${i}-y`);
    el.style.removeProperty(`--p${i}-c`);
    el.style.removeProperty(`--p${i}-r`);
  }
  el.style.removeProperty('--base');
}
