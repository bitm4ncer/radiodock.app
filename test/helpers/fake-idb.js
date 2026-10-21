// In-memory IndexedDB double for tests. No native IDB, no dependencies.
//
// Mirrors just enough of the IDB API that storage.js uses: open, transaction,
// objectStore (get/getAll/put/delete/clear/index), createObjectStore,
// createIndex, and index(). Writes are staged per transaction and committed on
// oncomplete; on a write error the transaction aborts and its writes roll back.

const SCHEMA = {
  lists: { keyPath: 'id', indexes: {} },
  prefs: { keyPath: 'key', indexes: {} },
  userBackgrounds: { keyPath: 'id', indexes: {} },
  notePages: { keyPath: 'id', indexes: {} },
  notes: { keyPath: 'id', indexes: { byPage: 'pageId', byCreatedAt: 'createdAt' } },
  recordings: { keyPath: 'id', indexes: {} },
};

const originalIndexedDB = globalThis.indexedDB;

let stores = new Map(); // Map<name, Map<key, value>>
let failWrites = new Map(); // Map<name, count>
let failOpenFlag = false;
let lastDb = null; // the most recently opened connection

function newRequest() {
  return { onsuccess: null, onerror: null, result: undefined, error: null };
}

function settleSuccess(req, result) {
  req.result = result;
  queueMicrotask(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
}

function settleError(req, error) {
  req.error = error;
  queueMicrotask(() => { if (req.onerror) req.onerror({ target: req }); });
}

function maybeFail(name) {
  const left = failWrites.get(name) ?? 0;
  if (left > 0) {
    failWrites.set(name, left - 1);
    return new Error('forced write failure: ' + name);
  }
  return null;
}

function normalizeNames(nameOrNames) {
  return Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
}

function makeStoreView(name, tx) {
  const schema = SCHEMA[name] || { keyPath: 'id', indexes: {} };
  const read = () => (tx._snapshots ? tx._snapshots.get(name) : (stores.get(name) ?? new Map()));

  return {
    get(id) {
      const req = newRequest();
      settleSuccess(req, read().get(id));
      return req;
    },
    getAll() {
      const req = newRequest();
      settleSuccess(req, Array.from(read().values()));
      return req;
    },
    put(value) {
      const req = newRequest();
      const err = maybeFail(name);
      if (err) {
        tx._abort(err);
        settleError(req, err);
        return req;
      }
      const key = value[schema.keyPath];
      read().set(key, value);
      settleSuccess(req, key);
      return req;
    },
    delete(id) {
      const req = newRequest();
      const err = maybeFail(name);
      if (err) {
        tx._abort(err);
        settleError(req, err);
        return req;
      }
      read().delete(id);
      settleSuccess(req, undefined);
      return req;
    },
    clear() {
      const req = newRequest();
      read().clear();
      settleSuccess(req, undefined);
      return req;
    },
    index(idxName) {
      const keyPath = schema.indexes[idxName];
      return {
        getAll(key) {
          const req = newRequest();
          const values = Array.from(read().values()).filter((v) => v[keyPath] === key);
          settleSuccess(req, values);
          return req;
        },
      };
    },
    createIndex() {},
  };
}

function makeTransaction(names, mode) {
  const tx = {
    mode,
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    _aborted: false,
    _snapshots: null,
    _abort(err) {
      this._aborted = true;
      this.error = err;
    },
    objectStore(name) {
      return makeStoreView(name, tx);
    },
  };

  if (mode === 'readwrite') {
    tx._snapshots = new Map();
    for (const name of names) {
      if (!stores.has(name)) stores.set(name, new Map());
      tx._snapshots.set(name, new Map(stores.get(name)));
    }
  }

  // Complete on a macrotask so request microtasks settle and the caller wires
  // oncomplete/onabort/onerror first.
  setTimeout(() => {
    if (tx._aborted) {
      if (tx.onabort) tx.onabort({ target: tx });
      else if (tx.onerror) tx.onerror({ target: tx });
      return; // snapshots discarded
    }
    if (tx._snapshots) {
      for (const [name, snap] of tx._snapshots) stores.set(name, snap);
    }
    if (tx.oncomplete) tx.oncomplete({ target: tx });
  }, 0);

  return tx;
}

function makeDb() {
  return {
    onversionchange: null,
    closed: false,
    objectStoreNames: {
      contains: (name) => name in SCHEMA,
    },
    createObjectStore(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeStoreView(name, { _snapshots: null });
    },
    transaction(nameOrNames, mode) {
      return makeTransaction(normalizeNames(nameOrNames), mode);
    },
    close() {
      this.closed = true;
    },
  };
}

function openRequest() {
  const req = newRequest();
  queueMicrotask(() => {
    if (failOpenFlag) {
      req.error = new Error('IndexedDB open error');
      if (req.onerror) req.onerror({ target: req });
      return;
    }
    const db = makeDb();
    lastDb = db;
    req.result = db;
    if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
    if (req.onsuccess) req.onsuccess({ target: req });
  });
  return req;
}

export function createFakeIdb({ failOpen = false } = {}) {
  stores = new Map();
  failWrites = new Map();
  failOpenFlag = failOpen;

  globalThis.indexedDB = { open: openRequest };

  return {
    get stores() {
      return stores;
    },
    get connection() {
      return lastDb;
    },
    failNextWrite(name) {
      failWrites.set(name, (failWrites.get(name) ?? 0) + 1);
    },
    get failOpen() {
      return failOpenFlag;
    },
    set failOpen(value) {
      failOpenFlag = value;
    },
    restore() {
      if (originalIndexedDB === undefined) {
        delete globalThis.indexedDB;
      } else {
        globalThis.indexedDB = originalIndexedDB;
      }
    },
  };
}
