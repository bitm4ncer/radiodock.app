// Thin IndexedDB wrapper.
// One DB `radiodock` with two stores:
//   `lists`  — custom user lists, keyPath: 'id'.
//             value shape: { id, name, stations: [...], order, createdAt }
//   `prefs`  — key/value, keyPath: 'key'.
//             keys in use: currentStationId, currentListId, volume, seenInstallHint

const DB_NAME = 'radiodock';
const DB_VERSION = 1;

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
