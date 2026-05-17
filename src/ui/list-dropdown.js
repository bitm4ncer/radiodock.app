// List switcher dropdown with per-row actions (rename / share / export
// / delete). Community list is rendered first and only supports selection.
// Desktop shows the four small action icons inline on hover; mobile
// hides them and exposes a single ⋯ button that opens a bottom-sheet
// action menu with bigger tap targets.

import { openModal, closeModal } from './modals.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

const ICON_RENAME = `<svg viewBox="0 0 24 24" class="action-icon" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.04a1 1 0 0 0 0-1.41l-2.5-2.5a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.99-1.67Z" fill="currentColor"/></svg>`;
const ICON_EXPORT = `<svg viewBox="0 0 24 24" class="action-icon" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24" class="action-icon" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const ICON_MORE = `<svg viewBox="0 0 24 24" class="action-icon action-icon--more" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>`;

export function mountListDropdown() {
  const btn = document.getElementById('listDropdownBtn');
  const menu = document.getElementById('listDropdownMenu');
  const itemsEl = document.getElementById('listItems');
  const label = document.getElementById('currentListName');
  const addBtn = document.getElementById('addListBtn');
  const importBtn = document.getElementById('importListBtn');
  const importInput = document.getElementById('importListFile');

  let lists = [];
  let currentId = null;
  let selectCb = null;
  let addCb = null;
  let importCb = null;
  let renameCb = null;
  let exportCb = null;
  let shareCb = null;
  let deleteCb = null;
  let toggleCb = null;

  // Toggle a marker class on the enclosing .favorites-section while the
  // dropdown is open. Without it, visualizer.css's overflow:hidden on
  // that section clips the floating menu whenever the menu extends past
  // the section's bottom edge (which it always does when there are
  // many lists, or when favorites-list is short and the menu has to
  // grow downward into empty space).
  const section = btn.closest('.favorites-section');

  function close() {
    menu.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    section?.classList.remove('list-dropdown-open');
    toggleCb?.(false);
  }
  function open() {
    menu.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    section?.classList.add('list-dropdown-open');
    toggleCb?.(true);
  }
  function toggle() {
    const isOpen = menu.style.display !== 'none';
    isOpen ? close() : open();
  }

  function render() {
    const current = lists.find((l) => l.id === currentId);
    label.textContent = current?.name ?? 'Community Radios';

    itemsEl.innerHTML = lists
      .map((l) => {
        const readOnly = l.readOnly;
        // Per-row actions only on user-owned (editable) lists.
        const actions = readOnly
          ? ''
          : `<button type="button" class="list-edit-btn" data-action="rename" title="Rename list">${ICON_RENAME}</button>
             <button type="button" class="list-share-btn" data-action="share" title="Share list">${ICON_SHARE}</button>
             <button type="button" class="list-export-btn" data-action="export" title="Export list">${ICON_EXPORT}</button>
             <button type="button" class="list-remove-btn" data-action="delete" title="Delete list">×</button>
             <button type="button" class="list-more-btn" data-action="more" title="More" aria-label="List actions">${ICON_MORE}</button>`;
        const isActive = l.id === currentId;
        return `
          <div class="list-item${isActive ? ' active' : ''}" data-id="${escapeHtml(l.id)}">
            <span class="list-name" data-action="select">${escapeHtml(l.name)}</span>
            <span class="list-count">${l.stations?.length ?? 0}</span>
            ${actions}
          </div>`;
      })
      .join('');
  }

  btn.addEventListener('click', toggle);
  document.addEventListener('click', (evt) => {
    if (menu.style.display === 'none') return;
    if (!menu.contains(evt.target) && !btn.contains(evt.target)) close();
  });

  itemsEl.addEventListener('click', (evt) => {
    const row = evt.target.closest('[data-id]');
    if (!row) return;
    const list = lists.find((l) => l.id === row.dataset.id);
    if (!list) return;
    const actionEl = evt.target.closest('[data-action]');
    const action = actionEl?.dataset.action ?? 'select';
    if (action === 'select') {
      selectCb?.(list);
      close();
    } else if (action === 'rename') {
      renameCb?.(list);
      close();
    } else if (action === 'export') {
      exportCb?.(list);
      close();
    } else if (action === 'share') {
      shareCb?.(list);
      close();
    } else if (action === 'delete') {
      deleteCb?.(list);
      close();
    } else if (action === 'more') {
      openActionsSheet(list);
      close();
    }
  });

  // Mobile bottom-sheet for per-list actions. Wired once with a delegated
  // listener that reads data-action off the row that was tapped, looks up
  // the current list, and dispatches to the existing rename/share/export/
  // delete callbacks — same code path as the desktop hover-icons.
  const actionsModal = document.getElementById('listActionsModal');
  let actionsCurrentList = null;

  function openActionsSheet(list) {
    actionsCurrentList = list;
    const titleEl = document.getElementById('listActionsTitle');
    if (titleEl) titleEl.textContent = list.name;
    openModal(actionsModal);
  }

  actionsModal?.addEventListener('click', (evt) => {
    const row = evt.target.closest('[data-action]');
    if (!row) return;
    const action = row.dataset.action;
    const list = actionsCurrentList;
    closeModal(actionsModal);
    if (!list) return;
    if (action === 'rename') renameCb?.(list);
    else if (action === 'share') shareCb?.(list);
    else if (action === 'export') exportCb?.(list);
    else if (action === 'delete') deleteCb?.(list);
  });

  addBtn.addEventListener('click', () => {
    close();
    addCb?.();
  });

  importBtn.addEventListener('click', () => {
    importInput.click();
  });
  importInput.addEventListener('change', (evt) => {
    const file = evt.target.files?.[0];
    if (file) importCb?.(file);
    importInput.value = '';
    close();
  });

  return {
    setLists(next) {
      lists = next ?? [];
      render();
    },
    setCurrent(id) {
      currentId = id ?? null;
      render();
    },
    onSelect(cb) { selectCb = cb; },
    onAddList(cb) { addCb = cb; },
    onImport(cb) { importCb = cb; },
    onRename(cb) { renameCb = cb; },
    onExport(cb) { exportCb = cb; },
    onShare(cb) { shareCb = cb; },
    onDelete(cb) { deleteCb = cb; },
    onToggle(cb) { toggleCb = cb; },
    openActionsSheet,
    open,
    close,
  };
}
