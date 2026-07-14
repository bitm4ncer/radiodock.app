// Cross-device sync: token-based, AES-GCM encryption, server is zero-knowledge relay.
// Uses WebCrypto for all crypto operations, IndexedDB (via storage.js) for token storage.
import * as storage from './storage.js';
import { parseExport } from './import-export.js';
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

async function getKey(token) {
  const keyRaw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// --- Crypto ---

export function generateToken() {
  return crypto.randomUUID();
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptPayload(plainJson, token) {
  const key = await getKey(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainJson),
  );
  return JSON.stringify({
    v: 1,
    iv: base64urlEncode(iv),
    ct: base64urlEncode(ct),
  });
}

export async function decryptPayload(envelopeJson, token) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    throw new SyncError('Invalid payload format', 'decrypt');
  }
  if (envelope.v !== 1) {
    throw new SyncError(`Unsupported payload version: ${envelope.v}`, 'decrypt');
  }
  if (!envelope.iv || !envelope.ct) {
    throw new SyncError('Invalid payload format', 'decrypt');
  }
  const key = await getKey(token);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlDecode(envelope.iv) },
      key,
      base64urlDecode(envelope.ct),
    );
    return new TextDecoder().decode(plain);
  } catch (err) {
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

export async function computeContentHash(exportJson) {
  return sha256(exportJson);
}

// --- Token persistence ---

export function getSyncToken() {
  return storage.getPref('syncToken', null);
}

// --- Server communication ---

export async function buildExportPayload() {
  const lists = await listsApi.getUserLists();
  const exportLists = lists
    .filter((l) => l.id !== listsApi.COMMUNITY_LIST_ID)
    .map((l) => ({
      name: l.name,
      stations: (l.stations ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        countrycode: s.countrycode ?? '',
        favicon: s.favicon ?? '',
        homepage: s.homepage ?? '',
      })),
    }))
    .filter((l) => l.stations.length > 0);
  const stationCount = exportLists.reduce((sum, l) => sum + l.stations.length, 0);
  const exportJson = JSON.stringify({ version: '2.0', exportDate: new Date().toISOString(), lists: exportLists });
  return { exportJson, stationCount, listCount: exportLists.length };
}

export async function pushToServer(token) {
  const { exportJson, stationCount, listCount } = await buildExportPayload();
  const hash = await computeContentHash(exportJson);
  const lastHash = await storage.getPref('syncLastHash', null);

  if (hash === lastHash) return null;

  const envelope = await encryptPayload(exportJson, token);
  const res = await fetch(`${SYNC_BASE}/${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: envelope,
      content_hash: hash,
      list_count: listCount,
      station_count: stationCount,
    }),
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SyncError(body.error || `Server error: ${res.status}`, 'server');
  }
  const result = await res.json();
  await storage.setPref('syncLastHash', hash);
  await storage.setPref('syncLastUpdatedAt', result.updated_at);
  return { ok: true, updated_at: result.updated_at, created: result.created, station_count: stationCount, list_count: listCount };
}

export async function pullFromServer(token) {
  const metaRes = await fetch(`${SYNC_BASE}/${token}?meta=1`, { referrerPolicy: 'no-referrer' });
  if (metaRes.status === 404) {
    throw new SyncError('Sync token not found or expired', 'server');
  }
  if (!metaRes.ok) {
    throw new SyncError(`Server error: ${metaRes.status}`, 'server');
  }
  const meta = await metaRes.json();
  const lastHash = await storage.getPref('syncLastHash', null);

  if (meta.content_hash === lastHash) return null;

  const fullRes = await fetch(`${SYNC_BASE}/${token}`, { referrerPolicy: 'no-referrer' });
  if (!fullRes.ok) {
    throw new SyncError(`Server error: ${fullRes.status}`, 'server');
  }
  const full = await fullRes.json();
  const exportJson = await decryptPayload(full.payload, token);

  const computedHash = await computeContentHash(exportJson);
  if (computedHash !== full.content_hash) {
    throw new SyncError('Data integrity check failed', 'decrypt');
  }

  return { exportJson, hash: full.content_hash, updated_at: full.updated_at, list_count: full.list_count };
}

export async function deleteFromServer(token) {
  const res = await fetch(`${SYNC_BASE}/${token}`, {
    method: 'DELETE',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    throw new SyncError(`Server error: ${res.status}`, 'server');
  }
  await storage.setPref('syncToken', undefined);
  await storage.setPref('syncLastHash', undefined);
  await storage.setPref('syncLastUpdatedAt', undefined);
}

// --- Import ---

export async function applyImportPayload(exportJson, hash, updatedAt) {
  const parsed = parseExport(exportJson);
  const incoming = parsed.kind === 'single' ? [parsed.list] : parsed.lists;
  const existing = await listsApi.getUserLists();
  let imported = 0;
  let totalStations = 0;

  for (const src of incoming) {
    totalStations += src.stations.length;
    const match = existing.find((l) => !l.readOnly && l.name.toLowerCase() === src.name.toLowerCase());
    if (match) {
      await listsApi.replaceListStations(match.id, src.stations);
    } else {
      const list = await listsApi.createList(src.name);
      list.stations = src.stations.map((s) => ({
        id: s.id, name: s.name ?? '', url: s.url ?? '',
        countrycode: s.countrycode ?? '', favicon: s.favicon ?? '', homepage: s.homepage ?? '',
      }));
      await storage.putList(list);
    }
    imported++;
  }

  await storage.setPref('syncLastHash', hash);
  await storage.setPref('syncLastUpdatedAt', updatedAt);
  return { imported, stationCount: totalStations };
}

// --- Auto-sync ---

export async function autoSyncOnStartup(token) {
  try {
    const pulled = await pullFromServer(token);
    if (pulled) {
      await applyImportPayload(pulled.exportJson, pulled.hash, pulled.updated_at);
      return 'pulled';
    }

    const pushed = await pushToServer(token);
    if (pushed) return 'pushed';
    return 'unchanged';
  } catch (err) {
    if (err instanceof SyncError && err.type === 'server' && err.message.includes('not found')) {
      await storage.setPref('syncToken', undefined);
      await storage.setPref('syncLastHash', undefined);
      await storage.setPref('syncLastUpdatedAt', undefined);
    }
    return 'error';
  }
}

// --- Push-on-change with external debounce + AbortController ---

let pendingPushController = null;

export function cancelPendingPush() {
  if (pendingPushController) {
    pendingPushController.abort();
    pendingPushController = null;
  }
}

export async function pushOnChange(token) {
  cancelPendingPush();
  pendingPushController = new AbortController();
  try {
    const result = await pushToServer(token);
    return result;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.warn('Sync push failed:', err);
    return null;
  } finally {
    pendingPushController = null;
  }
}
