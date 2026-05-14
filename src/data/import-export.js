// JSON import/export for station lists. Wire-compatible with the Chrome
// extension's export format: { version, exportDate, listName, stations }.
// Also handles a multi-list bundle: { version, exportDate, lists: [...] }.

import * as storage from './storage.js';
import { createList } from './lists.js';

const EXPORT_VERSION = '2.0';

/** Export a single list in the extension-compatible shape. */
export function exportListAsJson(list) {
  return {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    listName: list.name,
    stations: list.stations.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      countrycode: s.countrycode ?? '',
      favicon: s.favicon ?? '',
      homepage: s.homepage ?? '',
    })),
  };
}

/** Trigger a browser download for the supplied list. */
export function downloadList(list) {
  const data = exportListAsJson(list);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (list.name || 'list').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  a.href = url;
  a.download = `radiodock-${safe || 'list'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isStation(s) {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.url === 'string'
  );
}

/** Parse and validate a JSON payload as either a single-list or multi-list export. */
export function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('File is not valid JSON.');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Unrecognised export shape.');
  }

  // Multi-list bundle
  if (Array.isArray(data.lists)) {
    const lists = data.lists
      .filter((l) => l && typeof l === 'object' && Array.isArray(l.stations))
      .map((l) => ({
        name: String(l.name ?? l.listName ?? 'Imported List').slice(0, 50),
        stations: (l.stations ?? []).filter(isStation),
      }));
    if (!lists.length) throw new Error('No valid lists in this file.');
    return { kind: 'multi', lists };
  }

  // Single-list export (extension shape)
  if (Array.isArray(data.stations)) {
    return {
      kind: 'single',
      list: {
        name: String(data.listName ?? 'Imported List').slice(0, 50),
        stations: data.stations.filter(isStation),
      },
    };
  }

  throw new Error('Unrecognised export shape.');
}

/** Persist a parsed import to IndexedDB, creating new lists. Returns the new list(s). */
export async function applyImport(parsed) {
  const created = [];
  const incoming = parsed.kind === 'single' ? [parsed.list] : parsed.lists;
  for (const src of incoming) {
    const name = await pickUniqueName(src.name);
    const list = await createList(name);
    list.stations = src.stations;
    await storage.putList(list);
    created.push(list);
  }
  return created;
}

async function pickUniqueName(name) {
  const existing = await storage.getAllLists();
  const used = new Set(existing.map((l) => l.name.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} (${Date.now()})`;
}
