// Floating gallery panel for backgrounds. Bottom-right, above the cycle
// controls. Shows a thumbnail grid of all available images; the user can:
//   - click a thumbnail to select it (switches to manual mode)
//   - drag thumbnails to reorder them (HTML5 DnD)
//   - click × on a thumbnail to delete it (works for builtins too — local)
//
// The panel takes the same surface treatment as the main .container
// (frosted-glass when transparent mode, solid when solid mode); the
// `.is-solid` class is mirrored from the container so the gallery follows
// the user's chosen panel style.

import { applyGradientToElement } from './background-create.js';

export function createGallery({ onSelect, onReorder, onDelete }) {
  let mounted = false;
  let root = null;
  let listEl = null;
  let open = false;
  let dragSrcId = null;

  function mount() {
    if (mounted) return;
    mounted = true;
    root = document.createElement('div');
    root.className = 'bg-gallery';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Background gallery');
    root.innerHTML = `
      <header class="bg-gallery__header">
        <h3 class="bg-gallery__title">Gallery</h3>
        <button type="button" class="bg-gallery__close" aria-label="Close gallery" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"/>
          </svg>
        </button>
      </header>
      <div class="bg-gallery__list" role="list"></div>
    `;
    listEl = root.querySelector('.bg-gallery__list');
    root.querySelector('.bg-gallery__close').addEventListener('click', () => hide());
    document.body.appendChild(root);
  }

  function render(images, currentId) {
    listEl.innerHTML = '';
    if (!images.length) {
      const empty = document.createElement('p');
      empty.className = 'bg-gallery__empty';
      empty.textContent = 'No backgrounds yet. Use "Add background image" in the menu.';
      listEl.appendChild(empty);
      return;
    }
    for (const img of images) {
      const item = document.createElement('div');
      item.className = 'bg-gallery__item';
      if (img.id === currentId) item.classList.add('is-current');
      item.dataset.id = img.id;
      item.draggable = true;
      item.setAttribute('role', 'listitem');
      item.setAttribute('title', img.name);
      // Render gradient thumbs via the same CSS-vars pipeline as the
      // full-size background — no rasterisation, no preview drift even
      // when spec.drift is true (drift on a 72 px chip is just noise).
      if (img.kind === 'gradient') {
        applyGradientToElement(item, img.spec);
      } else {
        item.style.backgroundImage = `url(${JSON.stringify(img.url)})`;
      }
      item.innerHTML = `
        <button type="button" class="bg-gallery__item-delete" aria-label="Delete background" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18"/>
          </svg>
        </button>
      `;
      listEl.appendChild(item);

      // Click selects (delete button stops propagation).
      item.addEventListener('click', (evt) => {
        if (evt.target.closest('.bg-gallery__item-delete')) return;
        onSelect?.(img.id);
      });
      item.querySelector('.bg-gallery__item-delete').addEventListener('click', (evt) => {
        evt.stopPropagation();
        onDelete?.(img.id);
      });

      // HTML5 drag-drop reorder.
      item.addEventListener('dragstart', (evt) => {
        dragSrcId = img.id;
        item.classList.add('is-dragging');
        // Required for FF — must set some data for the drag to start.
        try { evt.dataTransfer.setData('text/plain', img.id); } catch {}
        evt.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
        // Clear any leftover insertion hints.
        for (const el of listEl.querySelectorAll('.is-drop-before, .is-drop-after')) {
          el.classList.remove('is-drop-before', 'is-drop-after');
        }
      });
      item.addEventListener('dragover', (evt) => {
        if (!dragSrcId || dragSrcId === img.id) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'move';
        // Show insertion zone: left half = before, right half = after.
        const rect = item.getBoundingClientRect();
        const before = (evt.clientX - rect.left) < rect.width / 2;
        item.classList.toggle('is-drop-before', before);
        item.classList.toggle('is-drop-after', !before);
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('is-drop-before', 'is-drop-after');
      });
      item.addEventListener('drop', (evt) => {
        evt.preventDefault();
        if (!dragSrcId || dragSrcId === img.id) return;
        const before = item.classList.contains('is-drop-before');
        const srcId = dragSrcId;
        dragSrcId = null;
        item.classList.remove('is-drop-before', 'is-drop-after');
        onReorder?.(srcId, img.id, before ? 'before' : 'after');
      });
    }
  }

  function show() {
    mount();
    root.classList.add('is-open');
    open = true;
  }
  function hide() {
    if (!root) return;
    root.classList.remove('is-open');
    open = false;
  }
  function toggle() { open ? hide() : show(); }
  function isOpen() { return open; }

  return { show, hide, toggle, isOpen, render, mount };
}
