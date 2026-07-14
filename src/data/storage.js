// Thin IndexedDB wrapper, defensive against blocked / unavailable IDB.
//
// One DB `radiodock` with two stores:
//   `lists`  — custom user lists, keyPath: 'id'.
//             value shape: { id, name, stations: [...], order, createdAt }
//   `prefs`  — key/value, keyPath: 'key'.
//             keys in use: currentStationId, currentListId, volume, seenInstallHint
//
// Every public read returns a safe default (`[]`, `{}`, `defaultValue`)
// when IndexedDB is unreachable. Every public write resolves silently —
// the caller gets `undefined` and continues. The only signal a blocked
// IDB ever produces is the health observable below, which the boot
// process uses to surface the help banner.
//
// Failure modes we have to survive in the wild:
//   - Brave Shield / Firefox Strict Mode partition / lock IDB
//   - Safari ITP wipes storage between sessions
//   - Older Chromium drops onsuccess/onerror silently in some states,
//     so the watchdog timeout is mandatory
//   - User has another tab on a previous schema → onblocked fires

const DB_NAME = 'radiodock';
// Schema history:
//   v1 — initial: lists + prefs.
//   v2 — added `userBackgrounds` store for the background-image feature.
//   v3 — adds `notePages` + `notes` stores for the notes feature.
//   v4 — adds `recordings` store (audio blobs for tape recording).
// The upgrade handler is fully idempotent (every step uses `if (!contains)`
// guards) so the migration runs cleanly from any starting version, AND
// degrades safely when something goes wrong (the defensive wrappers
// below catch every IDB error and the help banner surfaces the state).
const DB_VERSION = 4;
const OPEN_TIMEOUT_MS = 5000;

let dbPromise = null;
let idbHealth = 'unknown';      // 'unknown' | 'ok' | 'failed'
let idbLastError = null;
const healthListeners = new Set();

function setHealth(state, err) {
  if (idbHealth === state) return;
  idbHealth = state;
  idbLastError = err ?? null;
  for (const cb of healthListeners) {
    try { cb(state, err); } catch {}
  }
}

export function getIdbHealth() {
  return idbHealth;
}

export function getIdbLastError() {
  return idbLastError;
}

export function onIdbHealthChange(cb) {
  healthListeners.add(cb);
  // Fire once with the current value so late subscribers don't miss the
  // initial transition out of 'unknown'.
  if (idbHealth !== 'unknown') {
    try { cb(idbHealth, idbLastError); } catch {}
  }
  return () => healthListeners.delete(cb);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      const err = new Error('IndexedDB not available');
      setHealth('failed', err);
      reject(err);
      return;
    }
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(arg);
    };
    const watchdog = setTimeout(() => {
      const err = new Error('IndexedDB open timed out');
      setHealth('failed', err);
      finish(reject, err);
    }, OPEN_TIMEOUT_MS);

    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      setHealth('failed', err);
      finish(reject, err);
      return;
    }
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
      // v4 — recording blobs. Kept separate so listing notes never loads audio.
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      setHealth('ok');
      finish(resolve, req.result);
    };
    req.onerror = () => {
      const err = req.error ?? new Error('IndexedDB open error');
      setHealth('failed', err);
      finish(reject, err);
    };
    req.onblocked = () => {
      const err = new Error('IndexedDB blocked by another connection');
      setHealth('failed', err);
      finish(reject, err);
    };
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

// Wraps a withStore call with a try/catch that surfaces a fallback value
// and logs once on failure. Used by every public helper so the rest of
// the app never has to think about IDB exceptions.
async function safeRead(name, fn, fallback) {
  try {
    return await withStore(name, 'readonly', fn);
  } catch (err) {
    if (idbHealth !== 'failed') setHealth('failed', err);
    return fallback;
  }
}

async function safeWrite(name, fn) {
  try {
    return await withStore(name, 'readwrite', fn);
  } catch (err) {
    if (idbHealth !== 'failed') setHealth('failed', err);
    return undefined;
  }
}

// --- Lists ---

export async function getAllLists() {
  const list = await safeRead('lists', (store) => promisify(store.getAll()), []);
  return (list ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function getList(id) {
  return safeRead('lists', (store) => promisify(store.get(id)), undefined);
}

export async function putList(list) {
  return safeWrite('lists', (store) => promisify(store.put(list)));
}

export async function deleteList(id) {
  return safeWrite('lists', (store) => promisify(store.delete(id)));
}

export async function clearLists() {
  return safeWrite('lists', (store) => promisify(store.clear()));
}

// --- Prefs ---

export async function getPref(key, defaultValue = undefined) {
  const row = await safeRead('prefs', (store) => promisify(store.get(key)), undefined);
  return row?.value ?? defaultValue;
}

export async function setPref(key, value) {
  return safeWrite('prefs', (store) => promisify(store.put({ key, value })));
}

export async function getAllPrefs() {
  const rows = await safeRead('prefs', (store) => promisify(store.getAll()), []);
  const out = {};
  for (const row of rows ?? []) out[row.key] = row.value;
  return out;
}

// --- User-uploaded backgrounds (Blob storage) ---

export async function getAllUserBackgrounds() {
  const rows = await safeRead('userBackgrounds', (store) => promisify(store.getAll()), []);
  return (rows ?? []).sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
}

export async function putUserBackground(row) {
  return safeWrite('userBackgrounds', (store) => promisify(store.put(row)));
}

export async function deleteUserBackground(id) {
  return safeWrite('userBackgrounds', (store) => promisify(store.delete(id)));
}

// --- Note pages ---

export async function getAllNotePages() {
  const rows = await safeRead('notePages', (store) => promisify(store.getAll()), []);
  return (rows ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function putNotePage(page) {
  return safeWrite('notePages', (store) => promisify(store.put(page)));
}

export async function deleteNotePage(id) {
  return safeWrite('notePages', (store) => promisify(store.delete(id)));
}

// --- Notes ---

export async function getAllNotes() {
  const rows = await safeRead('notes', (store) => promisify(store.getAll()), []);
  return (rows ?? []).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getNotesForPage(pageId) {
  const all = await getAllNotes();
  return all.filter((n) => n.pageId === pageId);
}

export async function putNote(note) {
  return safeWrite('notes', (store) => promisify(store.put(note)));
}

export async function deleteNote(id) {
  return safeWrite('notes', (store) => promisify(store.delete(id)));
}

export async function deleteNotesForPage(pageId) {
  return safeWrite('notes', async (store) => {
    const all = await promisify(store.getAll());
    const tasks = (all ?? [])
      .filter((n) => n.pageId === pageId)
      .map((n) => promisify(store.delete(n.id)));
    await Promise.all(tasks);
  });
}

// --- Recordings (audio Blob storage) ---

export async function putRecordingAudio(id, blob) {
  return safeWrite('recordings', (store) => promisify(store.put({ id, blob, bytes: blob.size })));
}

export async function getRecordingAudio(id) {
  const row = await safeRead('recordings', (store) => promisify(store.get(id)), undefined);
  return row?.blob;
}

export async function deleteRecordingAudio(id) {
  return safeWrite('recordings', (store) => promisify(store.delete(id)));
}

export async function sumRecordingBytes() {
  const rows = await safeRead('recordings', (store) => promisify(store.getAll()), []);
  return (rows ?? []).reduce((n, r) => n + (r.bytes ?? 0), 0);
}
