// Player card drag handle + minimize button.
// Progressively enhances the existing #playerCard — does not modify
// player-card.js itself, so the in-flight frosted-card work isn't disturbed.
//
// Position is persisted to IndexedDB prefs as { x, y } (top-left of the
// .player-section). Minimized state is persisted as a boolean.

import { getPref, setPref } from '../data/storage.js';

const PREF_POS = 'playerCardPos';
const PREF_MIN = 'playerCardMinimized';

export async function mountPlayerCardDragMinimize() {
  if (matchMedia('(pointer: coarse)').matches) return null; // desktop only

  const section = document.querySelector('.player-section');
  const card = document.getElementById('playerCard');
  if (!section || !card) return null;

  // Make sure the card is the anchor for absolute children.
  if (getComputedStyle(card).position === 'static') {
    card.style.position = 'relative';
  }

  // --- Inject handle + minimize button ---

  const handle = document.createElement('div');
  handle.className = 'player-card-drag-handle';
  handle.title = 'Drag to reposition (double-click to reset)';
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', 'Drag player card');
  handle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="9" cy="6" r="1.2"/>
      <circle cx="15" cy="6" r="1.2"/>
      <circle cx="9" cy="12" r="1.2"/>
      <circle cx="15" cy="12" r="1.2"/>
      <circle cx="9" cy="18" r="1.2"/>
      <circle cx="15" cy="18" r="1.2"/>
    </svg>
  `;
  card.appendChild(handle);

  const minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.className = 'player-card-minimize-btn';
  minBtn.title = 'Minimize';
  minBtn.setAttribute('aria-label', 'Minimize player card');
  minBtn.innerHTML = chevronDown();
  card.appendChild(minBtn);

  // --- State ---

  let savedPos = await getPref(PREF_POS, null);   // { x, y } | null
  let minimized = await getPref(PREF_MIN, false);

  if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
    applyPosition(savedPos.x, savedPos.y);
  }
  if (minimized) {
    section.classList.add('is-minimized');
    minBtn.innerHTML = chevronUp();
    minBtn.title = 'Expand';
  }

  function applyPosition(x, y) {
    // Clamp to viewport
    const rect = section.getBoundingClientRect();
    const w = rect.width || 320;
    const h = rect.height || 80;
    const clampedX = Math.max(0, Math.min(window.innerWidth - w, x));
    const clampedY = Math.max(0, Math.min(window.innerHeight - h, y));
    section.style.setProperty('--card-x', clampedX + 'px');
    section.style.setProperty('--card-y', clampedY + 'px');
    section.classList.add('is-dragged');
  }

  async function persistPosition(x, y) {
    savedPos = { x, y };
    await setPref(PREF_POS, savedPos);
  }

  function resetPosition() {
    section.classList.remove('is-dragged');
    section.style.removeProperty('--card-x');
    section.style.removeProperty('--card-y');
    savedPos = null;
    setPref(PREF_POS, null);
  }

  // --- Drag mechanics ---

  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0;
  let offsetX = 0, offsetY = 0;

  handle.addEventListener('pointerdown', (evt) => {
    if (evt.button !== 0) return;
    dragging = true;
    pointerId = evt.pointerId;
    handle.setPointerCapture(pointerId);
    handle.classList.add('is-dragging');
    const rect = section.getBoundingClientRect();
    startX = evt.clientX;
    startY = evt.clientY;
    offsetX = startX - rect.left;
    offsetY = startY - rect.top;
    evt.preventDefault();
  });

  handle.addEventListener('pointermove', (evt) => {
    if (!dragging || evt.pointerId !== pointerId) return;
    const x = evt.clientX - offsetX;
    const y = evt.clientY - offsetY;
    applyPosition(x, y);
  });

  function endDrag(evt) {
    if (!dragging || (evt && evt.pointerId !== pointerId)) return;
    dragging = false;
    handle.classList.remove('is-dragging');
    try { handle.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    // Persist current position
    const xStr = section.style.getPropertyValue('--card-x');
    const yStr = section.style.getPropertyValue('--card-y');
    if (xStr && yStr) {
      persistPosition(parseFloat(xStr), parseFloat(yStr));
    }
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Double-click handle → reset to default centered position
  handle.addEventListener('dblclick', () => resetPosition());

  // --- Minimize ---

  minBtn.addEventListener('click', async () => {
    minimized = !minimized;
    section.classList.toggle('is-minimized', minimized);
    minBtn.innerHTML = minimized ? chevronUp() : chevronDown();
    minBtn.title = minimized ? 'Expand' : 'Minimize';
    await setPref(PREF_MIN, minimized);
  });

  // --- Window resize: re-clamp position ---
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
