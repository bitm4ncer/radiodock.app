// Drag handle + minimize button for the main app container.
//
// Both buttons live in the main `.container#app` (alongside the visualizer
// trigger). They control the container itself:
//   - Drag handle: moves the whole container card around the viewport.
//   - Minimize:    collapses the container, hiding the favorites + search
//                  sections, leaving only the player section visible.
//
// Position + minimized state are persisted to IndexedDB.

import { getPref, setPref } from '../data/storage.js';

const PREF_POS = 'containerPos';
const PREF_MIN = 'containerMinimized';

export async function mountPlayerCardDragMinimize() {
  if (matchMedia('(pointer: coarse)').matches) return null; // desktop only

  const container = document.getElementById('app');
  if (!container) return null;

  // Mark the container so visualizer.css can rely on a known anchor for the
  // absolutely-positioned tool buttons. We use a class (not inline style) so
  // the `.container.is-dragged { position: fixed }` rule isn't blocked by
  // inline-style specificity.
  container.classList.add('has-tools');

  // --- Inject handle + minimize button into the container ---

  const handle = makeFloatingBtn({
    className: 'player-card-drag-handle',
    label: 'Drag',
    title: 'Drag (double-click to reset)',
    svg: gripDots(),
    role: 'button',
    extraAttrs: { 'aria-label': 'Drag main container' },
  });
  container.appendChild(handle);

  const minBtn = makeFloatingBtn({
    className: 'player-card-minimize-btn',
    label: 'Minimize',
    title: 'Minimize',
    svg: chevronDown(),
    role: 'button',
    extraAttrs: { 'aria-label': 'Minimize main container' },
    asButton: true,
  });
  container.appendChild(minBtn);

  // --- State ---

  let savedPos = await getPref(PREF_POS, null);
  let minimized = await getPref(PREF_MIN, false);

  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    applyPosition(savedPos.x, savedPos.y);
  }
  if (minimized) {
    container.classList.add('is-minimized');
    minBtn.querySelector('.tool-btn__icon').innerHTML = chevronUp();
    minBtn.dataset.label = 'Expand';
    minBtn.title = 'Expand';
  }

  function applyPosition(x, y) {
    const rect = container.getBoundingClientRect();
    const w = rect.width || 480;
    const h = rect.height || 200;
    const clampedX = Math.max(0, Math.min(window.innerWidth - w, x));
    const clampedY = Math.max(0, Math.min(window.innerHeight - h, y));
    container.style.setProperty('--container-x', clampedX + 'px');
    container.style.setProperty('--container-y', clampedY + 'px');
    container.classList.add('is-dragged');
  }

  async function persistPosition(x, y) {
    savedPos = { x, y };
    await setPref(PREF_POS, savedPos);
  }

  function resetPosition() {
    container.classList.remove('is-dragged');
    container.style.removeProperty('--container-x');
    container.style.removeProperty('--container-y');
    savedPos = null;
    setPref(PREF_POS, null);
  }

  // --- Drag mechanics ---

  let dragging = false;
  let pointerId = null;
  let offsetX = 0, offsetY = 0;

  handle.addEventListener('pointerdown', (evt) => {
    if (evt.button !== 0) return;
    dragging = true;
    pointerId = evt.pointerId;
    handle.setPointerCapture(pointerId);
    handle.classList.add('is-dragging');
    const rect = container.getBoundingClientRect();
    offsetX = evt.clientX - rect.left;
    offsetY = evt.clientY - rect.top;
    evt.preventDefault();
  });

  handle.addEventListener('pointermove', (evt) => {
    if (!dragging || evt.pointerId !== pointerId) return;
    applyPosition(evt.clientX - offsetX, evt.clientY - offsetY);
  });

  function endDrag(evt) {
    if (!dragging || (evt && evt.pointerId !== pointerId)) return;
    dragging = false;
    handle.classList.remove('is-dragging');
    try { handle.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    const xStr = container.style.getPropertyValue('--container-x');
    const yStr = container.style.getPropertyValue('--container-y');
    if (xStr && yStr) persistPosition(parseFloat(xStr), parseFloat(yStr));
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  handle.addEventListener('dblclick', () => resetPosition());

  // --- Minimize ---

  minBtn.addEventListener('click', async () => {
    minimized = !minimized;
    container.classList.toggle('is-minimized', minimized);
    minBtn.querySelector('.tool-btn__icon').innerHTML = minimized ? chevronUp() : chevronDown();
    minBtn.dataset.label = minimized ? 'Expand' : 'Minimize';
    minBtn.title = minimized ? 'Expand' : 'Minimize';
    await setPref(PREF_MIN, minimized);
  });

  window.addEventListener('resize', () => {
    if (!savedPos) return;
    applyPosition(savedPos.x, savedPos.y);
  });

  return {
    isMinimized: () => minimized,
    getPosition: () => savedPos,
    resetPosition,
  };
}

// --- Helpers ---

function makeFloatingBtn({ className, label, title, svg, role, extraAttrs = {}, asButton = false }) {
  const el = asButton ? document.createElement('button') : document.createElement('div');
  if (asButton) el.type = 'button';
  el.className = `tool-btn ${className}`;
  el.title = title;
  el.dataset.label = label;
  if (role) el.setAttribute('role', role);
  for (const [k, v] of Object.entries(extraAttrs)) el.setAttribute(k, v);
  el.innerHTML = `
    <span class="tool-btn__pill" aria-hidden="true">${label}</span>
    <span class="tool-btn__icon">${svg}</span>
  `;
  return el;
}

function gripDots() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.4"/>
    <circle cx="15" cy="6" r="1.4"/>
    <circle cx="9" cy="12" r="1.4"/>
    <circle cx="15" cy="12" r="1.4"/>
    <circle cx="9" cy="18" r="1.4"/>
    <circle cx="15" cy="18" r="1.4"/>
  </svg>`;
}
function chevronDown() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`;
}
function chevronUp() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 15 12 9 18 15"/>
  </svg>`;
}
