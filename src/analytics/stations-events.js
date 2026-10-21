// Pure builders for the Stations-panel analytics events. Kept free of DOM and
// Umami imports so the payload shapes can be unit-tested in Node.

export function buildListItemEvent({ action, uuid, listId, listKind, source } = {}) {
  return {
    name: 'list-item',
    data: {
      action: action === 'remove' ? 'remove' : 'add',
      uuid: String(uuid ?? ''),
      listId: String(listId ?? ''),
      listKind: listKind === 'community' ? 'community' : 'user',
      source: String(source || 'unknown'),
    },
  };
}

export function searchEventData(query, resultCount) {
  return {
    queryLength: String(query ?? '').trim().length,
    resultCount: Number.isFinite(resultCount) ? resultCount : 0,
  };
}
