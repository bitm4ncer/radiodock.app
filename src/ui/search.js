// Search input + filter tabs. The actual Radio Browser API call is wired
// up in M4. For M2 this just hides/shows the input cleanly and dispatches
// query/filter changes via callbacks.

export function mountSearch({ onQuery, onFilterChange } = {}) {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  const filtersEl = document.getElementById('searchFilters');
  const resultsEl = document.getElementById('searchResults');

  let activeFilter = 'name';
  let debounceTimer = null;

  function syncClearButton() {
    const has = input.value.length > 0;
    clearBtn.style.display = has ? '' : 'none';
    filtersEl.style.display = has ? '' : 'none';
    resultsEl.style.display = has ? '' : 'none';
  }

  function debounce(fn, ms) {
    return (...args) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fn(...args), ms);
    };
  }

  const fire = debounce(() => {
    onQuery?.({ query: input.value.trim(), filter: activeFilter });
  }, 300);

  input.addEventListener('input', () => {
    syncClearButton();
    if (input.value.trim()) fire();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncClearButton();
    onQuery?.({ query: '', filter: activeFilter });
    input.focus();
  });

  filtersEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-btn');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    filtersEl.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
    onFilterChange?.(activeFilter);
    if (input.value.trim()) fire();
  });

  syncClearButton();

  return {
    focus: () => input.focus(),
    clear: () => {
      input.value = '';
      syncClearButton();
    },
    getQuery: () => ({ query: input.value.trim(), filter: activeFilter }),
  };
}
