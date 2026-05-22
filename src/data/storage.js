// Thin IndexedDB wrapper.
// One DB `radiodock` with two stores:
//   `lists`  — custom user lists, keyPath: 'id'.
//             value shape: { id, name, stations: [...], order, createdAt }
//   `prefs`  — key/value, keyPath: 'key'.
//             keys in use: currentStationId, currentListId, volume, seenInstallHint

const DB_NAME = 'radiodock';
// v2 (May 2026): added `userBackgrounds` store. v3 (immediately after):
// re-runs the v2 migration for dev databases that ended up on schema v2
// without the new store (the original upgrade handler shipped in a
// session where the module hot-reloaded before its new code was actually
// in memory, leaving half-migrated databases). Idempotent — the upgrade
// branch only creates stores that don't already exist.
// v4: notes feature — `notePages` + `notes` stores. v5 re-runs v4's
// migration (idempotent — same `if (!contains)` pattern as v3 → v2's
// fix) because the dev server can open the DB at v4 before the upgrade
// handler has loaded the new store definitions.
const DB_VERSION = 5;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains('lists')) {
        db.createObjectStore('lists', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('userBackgrounds')) {
        db.createObjectStore('userBackgrounds', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notePages')) {
        db.createObjectStore('notePages', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('byPage', 'pageId', { unique: false });
        notes.createIndex('byCreatedAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  const store = tx.objectStore(name);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

// --- Lists ---

export async function getAllLists() {
  return withStore('lists', 'readonly', (store) => promisify(store.getAll()))
    .then((list) => list ?? [])
    .then((list) => list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
}

export async function getList(id) {
  return withStore('lists', 'readonly', (store) => promisify(store.get(id)));
}

export async function putList(list) {
  return withStore('lists', 'readwrite', (store) => promisify(store.put(list)));
}

export async function deleteList(id) {
  return withStore('lists', 'readwrite', (store) => promisify(store.delete(id)));
}

export async function clearLists() {
  return withStore('lists', 'readwrite', (store) => promisify(store.clear()));
}

// --- Prefs ---

export async function getPref(key, defaultValue = undefined) {
  const row = await withStore('prefs', 'readonly', (store) => promisify(store.get(key)));
  return row?.value ?? defaultValue;
}

export async function setPref(key, value) {
  return withStore('prefs', 'readwrite', (store) => promisify(store.put({ key, value })));
}

export async function getAllPrefs() {
  const rows = await withStore('prefs', 'readonly', (store) => promisify(store.getAll()));
  const out = {};
  for (const row of rows ?? []) out[row.key] = row.value;
  return out;
}

// --- User-uploaded backgrounds ---

export async function getAllUserBackgrounds() {
  const rows = await withStore('userBackgrounds', 'readonly', (store) => promisify(store.getAll()));
  return (rows ?? []).sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
}

export async function putUserBackground(row) {
  return withStore('userBackgrounds', 'readwrite', (store) => promisify(store.put(row)));
}

export async function deleteUserBackground(id) {
  return withStore('userBackgrounds', 'readwrite', (store) => promisify(store.delete(id)));
}

// --- Note pages ---

export async function getAllNotePages() {
  const rows = await withStore('notePages', 'readonly', (store) => promisify(store.getAll()));
  return (rows ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function putNotePage(page) {
  return withStore('notePages', 'readwrite', (store) => promisify(store.put(page)));
}

export async function deleteNotePage(id) {
  return withStore('notePages', 'readwrite', (store) => promisify(store.delete(id)));
}

// --- Notes ---

export async function getAllNotes() {
  const rows = await withStore('notes', 'readonly', (store) => promisify(store.getAll()));
  return (rows ?? []).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getNotesForPage(pageId) {
  const all = await getAllNotes();
  return all.filter((n) => n.pageId === pageId);
}

export async function putNote(note) {
  return withStore('notes', 'readwrite', (store) => promisify(store.put(note)));
}

export async function deleteNote(id) {
  return withStore('notes', 'readwrite', (store) => promisify(store.delete(id)));
}

export async function deleteNotesForPage(pageId) {
  return withStore('notes', 'readwrite', async (store) => {
    const all = await promisify(store.getAll());
    const tasks = (all ?? [])
      .filter((n) => n.pageId === pageId)
      .map((n) => promisify(store.delete(n.id)));
    await Promise.all(tasks);
  });
}
