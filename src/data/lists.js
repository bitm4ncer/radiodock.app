// List-management facade on top of storage.js. Exposes high-level operations
// the UI calls (create / rename / delete / addStation / removeStation /
// reorder / move-station). Handles default "Favorites" creation lazily.

import * as storage from './storage.js';

export const COMMUNITY_LIST_ID = '__community__';
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

export async function reorderStationsInList(listId, orderedIds) {
  if (listId === COMMUNITY_LIST_ID) {
    throw new Error('Community Radios is read-only.');
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
