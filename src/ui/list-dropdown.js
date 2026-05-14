// List switcher dropdown. Renders the available lists and dispatches
// selection events. List management (create / rename / delete / import)
// is added in M3 alongside the storage layer.

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

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
  let listCallback = null;
  let addCallback = null;
  let importCallback = null;

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
      .map(
        (l) => `
          <button type="button" class="list-item${l.id === currentId ? ' is-current' : ''}" data-id="${escapeHtml(l.id)}">
            <span class="list-item__name">${escapeHtml(l.name)}</span>
            <span class="list-item__count">${l.stations?.length ?? 0}</span>
          </button>`,
      )
      .join('');
  }

  btn.addEventListener('click', toggle);
  document.addEventListener('click', (evt) => {
    if (menu.style.display === 'none') return;
    if (!menu.contains(evt.target) && !btn.contains(evt.target)) close();
  });

  itemsEl.addEventListener('click', (evt) => {
    const el = evt.target.closest('[data-id]');
    if (!el) return;
    const list = lists.find((l) => l.id === el.dataset.id);
    if (list) {
      listCallback?.(list);
      close();
    }
  });

  addBtn.addEventListener('click', () => {
    close();
    addCallback?.();
  });

  importBtn.addEventListener('click', () => {
    importInput.click();
  });
  importInput.addEventListener('change', (evt) => {
    const file = evt.target.files?.[0];
    if (file) importCallback?.(file);
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
    onSelect(cb) {
      listCallback = cb;
    },
    onAddList(cb) {
      addCallback = cb;
    },
    onImport(cb) {
      importCallback = cb;
    },
    close,
  };
}
