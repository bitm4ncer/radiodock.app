// List-management facade on top of storage.js. Exposes high-level operations
// the UI calls (create / rename / delete / addStation / removeStation /
// reorder / move-station). Handles default "Favorites" creation lazily.

import * as storage from './storage.js';
import { collectionListId, uniqueListName } from './collection-list.js';

export const COMMUNITY_LIST_ID = '__community__';
export { collectionListId, uniqueListName };
const FAVORITES_LIST_ID = 'favorites';

function genId() {
  return 'list_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now() {
  return Date.now();
}

/**
 * Returns all user-owned lists, sorted by order. Ensures a "Favorites" list
 * exists on first read so the heart-icon button always has somewhere to write.
 */
export async function getUserLists() {
  let lists = await storage.getAllLists();
  if (!lists.length) {
    const favorites = {
      id: FAVORITES_LIST_ID,
      name: 'Favorites',
      stations: [],
      order: 0,
      createdAt: now(),
    };
    await storage.putList(favorites);
    lists = [favorites];
  }
  return lists;
}

export async function createList(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('List name is required.');
  if (trimmed.length > 50) throw new Error('List name is too long (max 50 characters).');

  const existing = await storage.getAllLists();
  if (existing.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A list with that name already exists.');
  }
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.order ?? 0), 0);
  const list = {
    id: genId(),
    name: trimmed,
    stations: [],
    order: maxOrder + 1,
    createdAt: now(),
  };
  await storage.putList(list);
  return list;
}

/**
 * Save a curated collection as a normal private user list. The id is derived
 * from the collection slug so clicking "add" twice cannot create duplicates.
 * Stations must already be hydrated with a playable url.
 */
export async function createListFromCollection({ title, slug, stations } = {}) {
  const id = collectionListId(slug);
  const existing = await storage.getAllLists();
  const found = existing.find((list) => list.id === id);
  if (found) return { list: found, already: true };

  const seen = new Set();
  const playable = [];
  for (const station of Array.isArray(stations) ? stations : []) {
    const stationId = station?.id ?? station?.stationuuid ?? station?.uuid;
    const url = station?.url ?? station?.url_resolved ?? '';
    if (!stationId || !url || seen.has(stationId)) continue;
    seen.add(stationId);
    playable.push({ ...station, id: stationId, url });
  }
  if (!playable.length) throw new Error('This collection has no playable stations.');

  const maxOrder = existing.reduce((max, list) => Math.max(max, list.order ?? 0), 0);
  const list = {
    id,
    name: uniqueListName(title, existing.map((item) => item.name)),
    stations: playable.map(sanitizeStation),
    order: maxOrder + 1,
    createdAt: now(),
  };
  await storage.putList(list);
  return { list, already: false };
}

export async function renameList(id, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('List name is required.');
  if (trimmed.length > 50) throw new Error('List name is too long (max 50 characters).');

  const list = await storage.getList(id);
  if (!list) throw new Error('List not found.');

  const existing = await storage.getAllLists();
  if (existing.some((l) => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A list with that name already exists.');
  }
  list.name = trimmed;
  await storage.putList(list);
  return list;
}

export async function deleteList(id) {
  if (id === COMMUNITY_LIST_ID) {
    throw new Error('Community Radios cannot be deleted.');
  }
  return storage.deleteList(id);
}

export async function addStationToList(listId, station) {
  if (listId === COMMUNITY_LIST_ID) {
    throw new Error('Community Radios is read-only.');
  }
  const list = await storage.getList(listId);
  if (!list) throw new Error('List not found.');
  if (!station?.id) throw new Error('Invalid station.');

  if (list.stations.some((s) => s.id === station.id)) {
    return list; // already present, no-op
  }
  list.stations = [...list.stations, sanitizeStation(station)];
  await storage.putList(list);
  return list;
}

export async function removeStationFromList(listId, stationId) {
  if (listId === COMMUNITY_LIST_ID) {
    throw new Error('Community Radios is read-only.');
  }
  const list = await storage.getList(listId);
  if (!list) throw new Error('List not found.');
  list.stations = list.stations.filter((s) => s.id !== stationId);
  await storage.putList(list);
  return list;
}

export async function reorderStationsInList(listId, orderedIds, opts = {}) {
  if (listId === COMMUNITY_LIST_ID) {
    // Community is a read-only list shipped via JSON, but the user can
    // arrange it to taste. The order is persisted as a pref (just the id
    // sequence); on next boot main.js applies it to the freshly-loaded JSON.
    const baseline = opts.baseline ?? [];
    const map = new Map(baseline.map((s) => [s.id, s]));
    const reordered = [];
    for (const id of orderedIds) {
      const s = map.get(id);
      if (s) {
        reordered.push(s);
        map.delete(id);
      }
    }
    for (const s of map.values()) reordered.push(s);
    await storage.setPref('communityOrder', reordered.map((s) => s.id));
    return { id: COMMUNITY_LIST_ID, stations: reordered };
  }
  const list = await storage.getList(listId);
  if (!list) throw new Error('List not found.');
  const map = new Map(list.stations.map((s) => [s.id, s]));
  const reordered = [];
  for (const id of orderedIds) {
    const s = map.get(id);
    if (s) {
      reordered.push(s);
      map.delete(id);
    }
  }
  // Any stations missing from the supplied order keep their relative spot at the end.
  for (const s of map.values()) reordered.push(s);
  list.stations = reordered;
  await storage.putList(list);
  return list;
}

/** Apply a saved community order (from prefs) to the freshly-loaded JSON
 *  station list. Unknown ids in the saved order are dropped; new ids
 *  not in the saved order keep their JSON position appended at the end.
 *  Returns the reordered stations array. */
export function applyCommunityOrder(stations, savedOrder) {
  if (!Array.isArray(savedOrder) || savedOrder.length === 0) return stations;
  const map = new Map(stations.map((s) => [s.id, s]));
  const out = [];
  for (const id of savedOrder) {
    const s = map.get(id);
    if (s) {
      out.push(s);
      map.delete(id);
    }
  }
  for (const s of map.values()) out.push(s);
  return out;
}

/** Wholesale replace a list's stations. Used by share-link import when the
 *  user picks "Replace" on a name collision. The list metadata (id, name,
 *  order) is preserved. */
export async function replaceListStations(listId, stations) {
  if (listId === COMMUNITY_LIST_ID) {
    throw new Error('Community Radios is read-only.');
  }
  const list = await storage.getList(listId);
  if (!list) throw new Error('List not found.');
  list.stations = stations.map(sanitizeStation);
  await storage.putList(list);
  return list;
}

/** Strip transient fields and only persist the canonical station shape. */
function sanitizeStation(station) {
  return {
    id: station.id,
    name: station.name ?? '',
    url: station.url ?? '',
    countrycode: station.countrycode ?? '',
    favicon: station.favicon ?? '',
    homepage: station.homepage ?? '',
  };
}

export function isFavorited(list, stationId) {
  return !!list?.stations?.some((s) => s.id === stationId);
}

export { storage as _storage };
