// List switcher dropdown with per-row actions (rename / export / delete).
// Community list is rendered first and only supports selection.

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
  let deleteCb = null;

  function close() {
    menu.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  }
  function open() {
    menu.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
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
             <button type="button" class="list-export-btn" data-action="export" title="Export list">${ICON_EXPORT}</button>
             <button type="button" class="list-remove-btn" data-action="delete" title="Delete list">×</button>`;
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
    } else if (action === 'delete') {
      deleteCb?.(list);
      close();
    }
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
    onDelete(cb) { deleteCb = cb; },
    close,
  };
}
