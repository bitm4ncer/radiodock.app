const MAX_ROWS = 500;

export function buildBrowseParams(state = {}) {
  const mode = state.query ? 'search' : (state.mode || 'az');
  const params = {
    mode,
    limit: 100,
    offset: state.offset ?? 0,
    hidebroken: true,
  };
  if (mode === 'search' && state.query) params.q = state.query;
  if (mode === 'az' && state.letter && state.letter !== 'all') params.letter = state.letter;
  if (state.country) params.country = state.country;
  if (state.genre) params.genre = state.genre;
  if (state.hasDescription) params.hasDescription = true;
  return params;
}

export function searchModeFor(value, previousMode = 'az') {
  const query = String(value ?? '').trim();
  if (query.length >= 2) return { mode: 'search', query };
  if (query.length === 1) return { mode: 'too-short', query };
  return { mode: previousMode === 'search' ? 'az' : previousMode, query: '' };
}

export function popularParams(state = {}) {
  return buildBrowseParams({ ...state, mode: 'popular', query: '' });
}

export function communityParams(state = {}) {
  return buildBrowseParams({ ...state, mode: 'community', query: '', letter: 'all' });
}

export function searchParams(state = {}) {
  return buildBrowseParams({ ...state, mode: 'search', query: String(state.query ?? '').trim() });
}

export function mergeRows(existing = [], incoming = [], maxRows = MAX_ROWS) {
  const seen = new Set();
  const merged = [];
  for (const row of [...existing, ...incoming]) {
    const id = row?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
    if (maxRows != null && merged.length >= maxRows) break;
  }
  return merged;
}

export { MAX_ROWS };
