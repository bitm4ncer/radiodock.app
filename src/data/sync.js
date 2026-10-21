// Cross-device sync: end-to-end encrypted, the server stores only opaque blobs.
//
// Secret vs. record id (this is the whole security model):
//   - The SECRET is a high-entropy random string. It lives ONLY on the user's
//     devices and inside the share link's URL fragment (#sync=…), which
//     browsers never send to a server.
//   - The server record is keyed by recordId = SHA-256("…id…" + secret), and
//     the AES key is derived independently as SHA-256("…key…" + secret). The
//     server only ever receives the recordId, so it cannot derive the key and
//     cannot read the payload. (The earlier version put the secret itself in
//     the request path AND used SHA-256(secret) as the key — so the server
//     could trivially decrypt everything. That's fixed here.)
//
// The secret is unchanged across this migration, so existing #sync= links keep
// working: every updated client derives the same recordId from the same secret.
import * as storage from './storage.js';
import * as listsApi from './lists.js';

const SYNC_BASE = 'https://stations.radiodock.app/api/sync';

export class SyncError extends Error {
  constructor(message, type = 'generic') {
    super(message);
    this.name = 'SyncError';
    this.type = type;
  }
}

function base64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --- Crypto: derive the server id and the AES key from the secret, with
// domain separation so knowing one never reveals the other. ---

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveRecordId(secret) {
  return sha256(`radiodock-sync-id:v1:${secret}`);
}

async function deriveKey(secret) {
  const keyRaw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`radiodock-sync-key:v1:${secret}`),
  );
  return crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function generateToken() {
  return crypto.randomUUID();
}

export async function encryptPayload(plainJson, secret) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainJson));
  return JSON.stringify({ v: 1, iv: base64urlEncode(iv), ct: base64urlEncode(ct) });
}

export async function decryptPayload(envelopeJson, secret) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    throw new SyncError('Invalid payload format', 'decrypt');
  }
  if (envelope.v !== 1 || !envelope.iv || !envelope.ct) {
    throw new SyncError('Invalid payload format', 'decrypt');
  }
  const key = await deriveKey(secret);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlDecode(envelope.iv) },
      key,
      base64urlDecode(envelope.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SyncError('Decryption failed: the sync link may be incorrect', 'decrypt');
  }
}

export function extractTokenFromInput(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return null;
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = trimmed.match(uuidRe);
  return match ? match[0] : null;
}

// --- Payload build + content hash ---
//
// The hashed/encrypted JSON carries no timestamp: an earlier version stamped
// exportDate inside it, so every call produced a new hash even for identical
// lists → the push-dedup never fired and every device re-pulled on every
// startup. The hash is now stable iff the actual list content is unchanged.

function normalizeStation(s) {
  return {
    id: s.id,
    name: s.name ?? '',
    url: s.url ?? '',
    countrycode: s.countrycode ?? '',
    favicon: s.favicon ?? '',
    homepage: s.homepage ?? '',
  };
}

// Full state of the user's lists (ids included, empty lists kept) so the
// receiver can reconcile by id and propagate deletions.
export function buildExportObject(userLists) {
  const lists = userLists
    .filter((l) => l.id !== listsApi.COMMUNITY_LIST_ID)
    .map((l) => ({
      id: l.id,
      name: l.name,
      stations: (l.stations ?? []).map(normalizeStation),
    }));
  return { version: '2.0', lists };
}

export async function buildExportPayload() {
  const lists = await listsApi.getUserLists();
  const obj = buildExportObject(lists);
  const exportJson = JSON.stringify(obj);
  const stationCount = obj.lists.reduce((sum, l) => sum + l.stations.length, 0);
  return { exportJson, stationCount, listCount: obj.lists.length };
}

export async function computeContentHash(exportJson) {
  return sha256(exportJson);
}

// Pure reconciliation: given the incoming lists and the current local user
// lists, decide what to upsert and what to delete. Keyed by list id, so a
// rename updates in place (no duplicate) and a list removed on another device
// is deleted here (no lingering stale copy).
export function planImport(incomingLists, existingUserLists) {
  const incomingIds = new Set(incomingLists.map((l) => l.id).filter(Boolean));
  const upserts = incomingLists.map((l) => ({
    id: l.id ?? null,
    name: String(l.name ?? 'Imported List').slice(0, 50),
    stations: (l.stations ?? []).map(normalizeStation),
  }));
  const deleteIds = existingUserLists
    .filter((l) => l.id !== listsApi.COMMUNITY_LIST_ID && l.id && !incomingIds.has(l.id))
    .map((l) => l.id);
  return { upserts, deleteIds };
}

function parseSyncPayload(exportJson) {
  let data;
  try {
    data = JSON.parse(exportJson);
  } catch {
    throw new SyncError('Invalid sync payload', 'decrypt');
  }
  if (!data || !Array.isArray(data.lists)) {
    throw new SyncError('Invalid sync payload', 'decrypt');
  }
  return data.lists.filter((l) => l && typeof l === 'object' && Array.isArray(l.stations));
}

// --- Token persistence (the stored value is the secret) ---

export function getSyncToken() {
  return storage.getPref('syncToken', null);
}

// Local unsaved-changes marker plus a monotonic revision. Every local mutation
// (main.js) bumps the revision; a push captures it at start and only clears the
// dirty flag when the revision is still current at completion, so a push that
// began before a newer edit can never clear that edit's dirty flag.
let syncRevision = 0;

async function getSyncRevision() {
  const saved = await storage.getPref('syncRevision', 0);
  if (typeof saved === 'number' && saved > syncRevision) syncRevision = saved;
  return syncRevision;
}

async function clearDirtyIfCurrent(rev) {
  const current = await getSyncRevision();
  if (current === rev) await storage.setPref('syncDirty', false);
}

export async function markSyncDirty() {
  syncRevision = (await getSyncRevision()) + 1;
  await storage.setPref('syncRevision', syncRevision);
  await storage.setPref('syncDirty', true);
  return syncRevision;
}

// True while a merge conflict is awaiting a user decision. Automatic pushes are
// skipped until the user resolves it (keep local or use server), so a conflict
// never turns into a retry loop.
export async function hasSyncConflict() {
  return (await storage.getPref('syncConflict', false)) === true;
}

// --- Server communication (paths use the derived recordId, never the secret) ---

export async function getRemoteMeta(secret) {
  const recordId = await deriveRecordId(secret);
  const res = await fetch(`${SYNC_BASE}/${recordId}?meta=1`, { referrerPolicy: 'no-referrer' });
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError(`Server error: ${res.status}`, 'server');
  return res.json();
}

// Base-aware three-way merge for a push conflict (409). Merges per station id
// against the common ancestor so a delete can be told apart from "not yet
// synced": a station removed on exactly one side while the other left it
// unchanged is tombstoned, adds on both sides survive (union), and a same
// station edited on both sides (or a delete vs an edit) surfaces a conflict
// instead of silently dropping an edit.
function stationFingerprint(s) {
  return JSON.stringify(normalizeStation(s));
}

// True when two list snapshots carry the same name and the same stations
// (by id + content), so a whole-list delete can be told apart from a
// delete-vs-edit: an unchanged survivor means the delete is clean, while a
// changed survivor means someone still holds data we must not tombstone.
function listEquals(a, b) {
  if (!a || !b) return a === b;
  if ((a.name ?? '') !== (b.name ?? '')) return false;
  const as = a.stations ?? [];
  const bs = b.stations ?? [];
  if (as.length !== bs.length) return false;
  return as.every((s, i) => stationFingerprint(s) === stationFingerprint(bs[i]));
}

function resolveListName(baseList, localList, remoteList) {
  const baseName = baseList?.name;
  const localName = localList?.name;
  const remoteName = remoteList?.name;
  let conflict = false;
  let name;
  if (baseName !== undefined) {
    const localChanged = localName !== undefined && localName !== baseName;
    const remoteChanged = remoteName !== undefined && remoteName !== baseName;
    if (localChanged && remoteChanged && localName !== remoteName) conflict = true;
    name = localChanged ? localName : (remoteChanged ? remoteName : baseName);
  } else {
    name = localName ?? remoteName ?? '';
  }
  return { name, conflict };
}

function mergeStations(baseList, localList, remoteList, onConflict) {
  const bStations = baseList?.stations ?? [];
  const lStations = localList?.stations ?? [];
  const rStations = remoteList?.stations ?? [];

  const bById = new Map(bStations.map((s) => [s.id, s]));
  const lById = new Map(lStations.map((s) => [s.id, s]));
  const rById = new Map(rStations.map((s) => [s.id, s]));
  const eq = (a, b) => stationFingerprint(a) === stationFingerprint(b);

  const result = [];
  const placed = new Set();

  // Base order first: reconcile stations present in the common ancestor.
  for (const b of bStations) {
    const l = lById.get(b.id);
    const r = rById.get(b.id);
    if (l && r) {
      const lChanged = !eq(l, b);
      const rChanged = !eq(r, b);
      if (lChanged && rChanged && !eq(l, r)) onConflict();
      result.push(normalizeStation(lChanged ? l : (rChanged ? r : b)));
      placed.add(b.id);
    } else if (l && !r) {
      if (eq(l, b)) continue; // remote deleted, local unchanged: tombstone
      onConflict(); // delete vs edit
      result.push(normalizeStation(l));
      placed.add(b.id);
    } else if (r && !l) {
      if (eq(r, b)) continue; // local deleted, remote unchanged: tombstone
      onConflict(); // delete vs edit
      result.push(normalizeStation(r));
      placed.add(b.id);
    }
    // both absent: deleted on both sides, drop
  }

  // Local-only appends, then remote-only appends.
  for (const l of lStations) {
    if (bById.has(l.id) || placed.has(l.id)) continue;
    const r = rById.get(l.id);
    if (r && !eq(l, r)) onConflict(); // added on both sides with different content
    result.push(normalizeStation(l));
    placed.add(l.id);
  }
  for (const r of rStations) {
    if (bById.has(r.id) || placed.has(r.id)) continue;
    result.push(normalizeStation(r));
    placed.add(r.id);
  }

  return result;
}

export function mergeLists(base, local, remote) {
  const baseLists = base?.lists ?? [];
  const localLists = local?.lists ?? [];
  const remoteLists = remote?.lists ?? [];
  const listMap = (arr) => new Map((arr ?? []).filter((l) => l?.id).map((l) => [l.id, l]));
  const bList = listMap(baseLists);
  const lList = listMap(localLists);
  const rList = listMap(remoteLists);

  let conflict = false;
  const listIds = [...new Set([...bList.keys(), ...lList.keys(), ...rList.keys()])];
  const lists = [];
  for (const id of listIds) {
    const b = bList.get(id);
    const l = lList.get(id);
    const r = rList.get(id);

    // List-level delete vs edit/change: when the common ancestor had the list
    // and exactly one side removed it while the other still holds a CHANGED
    // version, surface a conflict and keep the survivor's data wholesale.
    // Running the per-station merge here would tombstone every base station
    // the survivor still has (silent data loss), so skip it for this case.
    //
    // With no base (upgrading users with no stored syncBaseExport) this branch
    // never runs; the two-way union below is deliberately conservative then: a
    // list absent on one side is restored rather than deleted, because without
    // a common ancestor a creation and a deletion are indistinguishable. Prefer
    // retaining data over deleting it.
    if (b) {
      const localDeleted = !l;
      const remoteDeleted = !r;
      if (localDeleted && remoteDeleted) continue; // deleted on both sides: drop
      if (localDeleted !== remoteDeleted) {
        const survivor = localDeleted ? r : l;
        // Both sides agree the stations are gone (one removed the list, the
        // other emptied it): a clean drop, not a conflict.
        if ((survivor.stations ?? []).length === 0) continue;
        if (!listEquals(b, survivor)) {
          conflict = true;
          lists.push({ id, name: survivor.name, stations: (survivor.stations ?? []).map(normalizeStation) });
          continue;
        }
        // Survivor is unchanged: the delete is clean, drop the list.
        continue;
      }
    }

    const { name, conflict: nameConflict } = resolveListName(b, l, r);
    if (nameConflict) conflict = true;
    const stations = mergeStations(b, l, r, () => { conflict = true; });
    lists.push({ id, name, stations });
  }
  return { lists, conflict };
}

export async function pushToServer(secret, signal, retries = 3) {
  const rev = await getSyncRevision();
  const { exportJson, stationCount, listCount } = await buildExportPayload();
  const hash = await computeContentHash(exportJson);
  const lastHash = await storage.getPref('syncLastHash', null);

  if (hash === lastHash) {
    await clearDirtyIfCurrent(rev);
    return null;
  }

  const recordId = await deriveRecordId(secret);
  const envelope = await encryptPayload(exportJson, secret);
  const res = await fetch(`${SYNC_BASE}/${recordId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // base_hash = the server state we edited from → the server CAS rejects with
    // 409 if another device pushed since (backward compatible: old servers ignore it).
    body: JSON.stringify({ payload: envelope, content_hash: hash, list_count: listCount, station_count: stationCount, base_hash: lastHash }),
    referrerPolicy: 'no-referrer',
    signal,
  });

  // Compare-and-swap conflict: another device pushed since we last synced. Merge
  // their state with ours, adopt it as our base, and retry the push.
  if (res.status === 409) {
    if (retries <= 0) throw new SyncError('Sync conflict could not be resolved', 'conflict');
    const body = await res.json().catch(() => ({}));
    const current = body.current;
    if (!current?.payload || !current?.content_hash) throw new SyncError('Sync conflict', 'conflict');
    const serverJson = await decryptPayload(current.payload, secret);
    let mine, theirs, base;
    try {
      mine = JSON.parse(exportJson);
      theirs = JSON.parse(serverJson);
      const baseRaw = await storage.getPref('syncBaseExport', null);
      base = baseRaw ? JSON.parse(baseRaw) : null;
    } catch { throw new SyncError('Invalid sync payload', 'decrypt'); }
    const merged = mergeLists(base, mine, theirs);
    if (merged.conflict) {
      await storage.setPref('syncConflict', true);
      throw new SyncError('Sync conflict: the same station was changed on two devices', 'conflict');
    }
    const mergedJson = JSON.stringify({ version: '2.0', lists: merged.lists });
    // Reconcile local lists to the merge, but adopt the SERVER document as the
    // new base (the true common ancestor the merge was derived from), not the
    // merged result. Merging against the merged result on a second 409 would
    // tombstone local-only additions. Keep dirty so a crash before the retry
    // pushes (rather than pulls and overwrites) the merged local state.
    await applyImportPayload(mergedJson, current.content_hash, current.updated_at, { baseExport: serverJson, dirty: true });
    liveOnChange?.(); // the merge pulled in the other device's lists — re-render
    return pushToServer(secret, signal, retries - 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SyncError(body.error || `Server error: ${res.status}`, 'server');
  }
  const result = await res.json();
  await storage.setPref('syncLastHash', hash);
  await storage.setPref('syncLastUpdatedAt', result.updated_at);
  await storage.setPref('syncBaseExport', exportJson);
  await clearDirtyIfCurrent(rev);
  return { ok: true, updated_at: result.updated_at, created: result.created, station_count: stationCount, list_count: listCount };
}

export async function pullFromServer(secret) {
  const recordId = await deriveRecordId(secret);
  const metaRes = await fetch(`${SYNC_BASE}/${recordId}?meta=1`, { referrerPolicy: 'no-referrer' });
  if (metaRes.status === 404) {
    throw new SyncError('Sync token not found or expired', 'server');
  }
  if (!metaRes.ok) {
    throw new SyncError(`Server error: ${metaRes.status}`, 'server');
  }
  const meta = await metaRes.json();
  const lastHash = await storage.getPref('syncLastHash', null);
  if (meta.content_hash === lastHash) return null;

  const fullRes = await fetch(`${SYNC_BASE}/${recordId}`, { referrerPolicy: 'no-referrer' });
  if (!fullRes.ok) {
    throw new SyncError(`Server error: ${fullRes.status}`, 'server');
  }
  const full = await fullRes.json();
  const exportJson = await decryptPayload(full.payload, secret);

  const computedHash = await computeContentHash(exportJson);
  if (computedHash !== full.content_hash) {
    throw new SyncError('Data integrity check failed', 'decrypt');
  }
  return { exportJson, hash: full.content_hash, updated_at: full.updated_at, list_count: full.list_count };
}

export async function deleteFromServer(secret) {
  const recordId = await deriveRecordId(secret);
  const res = await fetch(`${SYNC_BASE}/${recordId}`, { method: 'DELETE', referrerPolicy: 'no-referrer' });
  if (!res.ok) {
    throw new SyncError(`Server error: ${res.status}`, 'server');
  }
  await storage.setPref('syncToken', undefined);
  await storage.setPref('syncLastHash', undefined);
  await storage.setPref('syncLastUpdatedAt', undefined);
  await storage.setPref('syncDirty', false);
  await storage.setPref('syncBaseExport', undefined);
  await storage.setPref('syncRevision', undefined);
  await storage.setPref('syncConflict', false);
}

// --- Import: reconcile by id, propagate deletions ---

export async function applyImportPayload(exportJson, hash, updatedAt, { baseExport = exportJson, dirty = false } = {}) {
  const incoming = parseSyncPayload(exportJson);
  const existing = await listsApi.getUserLists();
  const { upserts, deleteIds } = planImport(incoming, existing);
  const existingById = new Map(existing.map((l) => [l.id, l]));

  let imported = 0;
  let totalStations = 0;

  for (const src of upserts) {
    totalStations += src.stations.length;
    const current = src.id ? existingById.get(src.id) : null;
    if (current) {
      current.name = src.name;
      current.stations = src.stations;
      await storage.putList(current);
    } else {
      const maxOrder = existing.reduce((m, l) => Math.max(m, l.order ?? 0), 0);
      await storage.putList({
        id: src.id ?? crypto.randomUUID(),
        name: src.name,
        stations: src.stations,
        order: maxOrder + 1 + imported,
        createdAt: new Date().toISOString(),
      });
    }
    imported++;
  }

  for (const id of deleteIds) {
    await listsApi.deleteList(id);
  }

  await storage.setPref('syncLastHash', hash);
  await storage.setPref('syncLastUpdatedAt', updatedAt);
  await storage.setPref('syncBaseExport', baseExport);
  await storage.setPref('syncDirty', dirty);
  return { imported, stationCount: totalStations, deleted: deleteIds.length };
}

// --- Auto-sync ---

export async function autoSyncOnStartup(secret) {
  try {
    // A pending conflict blocks automatic sync: pushing again would re-trigger
    // the same 409/merge loop, and pulling would overwrite local edits the user
    // has not yet chosen between. The user resolves it explicitly instead.
    if (await hasSyncConflict()) return 'conflict';

    // Unpushed local edits take priority: push them rather than pulling and
    // overwriting. Otherwise pull remote changes, then push if we're ahead.
    const dirty = await storage.getPref('syncDirty', false);
    if (dirty) {
      const pushed = await pushToServer(secret);
      return pushed ? 'pushed' : 'unchanged';
    }

    const pulled = await pullFromServer(secret);
    if (pulled) {
      await applyImportPayload(pulled.exportJson, pulled.hash, pulled.updated_at);
      return 'pulled';
    }
    const pushed = await pushToServer(secret);
    if (pushed) return 'pushed';
    return 'unchanged';
  } catch (err) {
    // A merge conflict surfaced during this sync: report it as such (the marker
    // is already persisted) so the UI can offer a resolution instead of retrying.
    if (err instanceof SyncError && err.type === 'conflict') return 'conflict';
    // A "not found" may be a transient read-after-write race (right after a
    // fresh push) or a real "unlinked/expired elsewhere". Don't self-nuke the
    // link on one blip — report it; the live engine clears the link only after
    // repeated confirmation (see syncNow).
    if (err instanceof SyncError && err.type === 'server' && err.message.includes('not found')) {
      return 'notfound';
    }
    return 'error';
  }
}

async function clearSyncPrefsLocal() {
  await storage.setPref('syncToken', undefined);
  await storage.setPref('syncLastHash', undefined);
  await storage.setPref('syncLastUpdatedAt', undefined);
  await storage.setPref('syncDirty', false);
  await storage.setPref('syncBaseExport', undefined);
  await storage.setPref('syncRevision', undefined);
  await storage.setPref('syncConflict', false);
}

// --- Push-on-change with external debounce + AbortController ---

let pendingPushController = null;

export function cancelPendingPush() {
  if (pendingPushController) {
    pendingPushController.abort();
    pendingPushController = null;
  }
}

export async function pushOnChange(secret) {
  cancelPendingPush();
  const ctl = new AbortController();
  pendingPushController = ctl;
  try {
    return await pushToServer(secret, ctl.signal);
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.warn('Sync push failed:', err);
    throw err;
  } finally {
    // Only clear the shared controller if a newer push hasn't replaced it.
    if (pendingPushController === ctl) pendingPushController = null;
  }
}

// ===== Live sync engine =====
// Status broadcasting + a poll loop so a change made on device A shows up on
// device B while the app is open — not only on the next startup. The loop is
// cheap: an idle tick is a single GET of the meta endpoint (hash compare), and
// it only runs while the tab is visible and the browser is online.

const statusListeners = new Set();
let syncStatus = { state: 'unlinked', at: null };

export function getSyncStatus() {
  return syncStatus;
}

export function onSyncStatus(cb) {
  statusListeners.add(cb);
  try { cb(syncStatus); } catch { /* listener error must not break sync */ }
  return () => statusListeners.delete(cb);
}

function setStatus(state, at = syncStatus.at) {
  syncStatus = { state, at };
  for (const cb of statusListeners) {
    try { cb(syncStatus); } catch { /* ignore listener errors */ }
  }
}

let liveTimer = null;
let liveGetToken = null;
let liveOnChange = null;
let liveInFlight = false;
let notFoundStreak = 0;
const LIVE_POLL_MS = 25_000;
const NOTFOUND_UNLINK_THRESHOLD = 3;

// The actual sync — dirty-aware push/pull, applies pulls, drives status. Not
// visibility-gated: used for the immediate sync on link/startup and on
// visibility/online resume, which should always run.
async function syncNow() {
  if (liveInFlight) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) { setStatus('offline'); return; }
  // A push is in flight: defer rather than running a concurrent pull/push that
  // could interleave with (or clobber) the pending compare-and-swap push.
  if (pendingPushController) {
    setTimeout(() => { if (!liveInFlight) syncNow(); }, 2500);
    return;
  }
  const secret = await liveGetToken?.();
  if (!secret) { setStatus('unlinked'); return; }
  liveInFlight = true;
  setStatus('syncing');
  try {
    const result = await autoSyncOnStartup(secret);
    if (result === 'notfound') {
      // A 404 right after a fresh push is usually a read-after-write race, not a
      // real unlink. Retry quickly a few times before concluding the record is
      // gone; only then unlink locally. (Server-down gives a network 'error',
      // not 'notfound', so a real outage never trips this.)
      if (++notFoundStreak >= NOTFOUND_UNLINK_THRESHOLD) {
        notFoundStreak = 0;
        await clearSyncPrefsLocal();
        setStatus('unlinked');
      } else {
        setStatus('syncing');
        setTimeout(() => { if (!liveInFlight) syncNow(); }, 2500);
      }
    } else if (result === 'error') {
      notFoundStreak = 0;
      setStatus(navigator.onLine ? 'error' : 'offline');
    } else if (result === 'conflict') {
      notFoundStreak = 0;
      setStatus('conflict');
    } else {
      notFoundStreak = 0;
      setStatus('synced', Date.now());
      if (result === 'pulled') liveOnChange?.();
    }
  } finally {
    liveInFlight = false;
  }
}

// Periodic poll — skipped while the tab is hidden (no point syncing a tab
// nobody is looking at; it resumes on visibilitychange).
function liveTick() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  syncNow();
}

function onVisibleResume() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') syncNow();
}
function onOffline() { setStatus('offline'); }

export function startLiveSync({ getToken, onRemoteChange } = {}) {
  stopLiveSync();
  liveGetToken = getToken;
  liveOnChange = onRemoteChange;
  liveTimer = setInterval(liveTick, LIVE_POLL_MS);
  document.addEventListener('visibilitychange', onVisibleResume);
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', onOffline);
  syncNow(); // immediate first sync, regardless of visibility
  return { stop: stopLiveSync, syncNow };
}

export function stopLiveSync() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  liveGetToken = null;
  liveOnChange = null;
  document.removeEventListener('visibilitychange', onVisibleResume);
  window.removeEventListener('online', syncNow);
  window.removeEventListener('offline', onOffline);
  setStatus('unlinked');
}

// Wrap a debounced push so the status reflects push activity too (called from
// the app's push-on-change scheduler).
export async function pushWithStatus(secret) {
  setStatus('syncing');
  try {
    const result = await pushOnChange(secret);
    setStatus('synced', Date.now());
    return result;
  } catch (err) {
    if (err instanceof SyncError && err.type === 'conflict') setStatus('conflict');
    else setStatus(navigator.onLine ? 'error' : 'offline');
    return null;
  }
}

// --- Conflict resolution (explicit user choice) ---

// Keep this device's lists and overwrite the server. Omitting base_hash skips
// the server's compare-and-swap, so this is a deliberate last-writer-wins push.
export async function resolveConflictKeepLocal(secret) {
  const { exportJson, stationCount, listCount } = await buildExportPayload();
  const hash = await computeContentHash(exportJson);
  const recordId = await deriveRecordId(secret);
  const envelope = await encryptPayload(exportJson, secret);
  const res = await fetch(`${SYNC_BASE}/${recordId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: envelope, content_hash: hash, list_count: listCount, station_count: stationCount }),
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SyncError(body.error || `Server error: ${res.status}`, 'server');
  }
  const result = await res.json();
  await storage.setPref('syncLastHash', hash);
  await storage.setPref('syncLastUpdatedAt', result.updated_at);
  await storage.setPref('syncBaseExport', exportJson);
  await storage.setPref('syncDirty', false);
  await storage.setPref('syncConflict', false);
  setStatus('synced', Date.now());
  return { ok: true, updated_at: result.updated_at, created: result.created, station_count: stationCount, list_count: listCount };
}

// Discard this device's conflicting edits and adopt the server's state.
export async function resolveConflictUseServer(secret) {
  const pulled = await pullFromServer(secret);
  if (pulled) {
    await applyImportPayload(pulled.exportJson, pulled.hash, pulled.updated_at);
  }
  await storage.setPref('syncConflict', false);
  await storage.setPref('syncDirty', false);
  setStatus('synced', Date.now());
  liveOnChange?.();
  return pulled;
}
