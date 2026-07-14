import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRecordId,
  encryptPayload,
  decryptPayload,
  computeContentHash,
  buildExportObject,
  planImport,
  extractTokenFromInput,
} from '../src/data/sync.js';

const COMMUNITY = '__community__';

test('deriveRecordId: deterministic, 64-hex, and not equal to the secret', async () => {
  const secret = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const id1 = await deriveRecordId(secret);
  const id2 = await deriveRecordId(secret);
  assert.equal(id1, id2, 'same secret → same record id');
  assert.match(id1, /^[0-9a-f]{64}$/, 'record id is 64 hex chars');
  assert.notEqual(id1, secret, 'record id must not be the secret (server never sees the secret)');
  assert.notEqual(id1, await deriveRecordId('different-secret'), 'different secrets → different ids');
});

test('encrypt/decrypt round-trips with the secret and fails with a wrong secret', async () => {
  const secret = 's3cr3t-value-123';
  const plain = JSON.stringify({ hello: 'world', n: 42 });
  const envelope = await encryptPayload(plain, secret);
  assert.equal(await decryptPayload(envelope, secret), plain);
  await assert.rejects(() => decryptPayload(envelope, 'wrong-secret'), /Decryption failed/);
});

test('content hash is STABLE for identical lists (B1: no volatile timestamp)', async () => {
  const lists = [{ id: 'L1', name: 'Jazz', stations: [{ id: 'S1', url: 'http://a' }] }];
  const a = JSON.stringify(buildExportObject(lists));
  const b = JSON.stringify(buildExportObject(lists));
  assert.equal(await computeContentHash(a), await computeContentHash(b),
    'identical content must hash identically — otherwise every startup re-syncs');
});

test('content hash CHANGES when list content changes', async () => {
  const before = JSON.stringify(buildExportObject([{ id: 'L1', name: 'Jazz', stations: [] }]));
  const after = JSON.stringify(buildExportObject([{ id: 'L1', name: 'Jazz', stations: [{ id: 'S1', url: 'http://a' }] }]));
  assert.notEqual(await computeContentHash(before), await computeContentHash(after));
});

test('buildExportObject keeps ids + empty lists and drops the community list', () => {
  const obj = buildExportObject([
    { id: 'L1', name: 'Empty', stations: [] },
    { id: 'L2', name: 'Full', stations: [{ id: 'S1', name: 'A', url: 'http://a' }] },
    { id: COMMUNITY, name: 'Community', stations: [{ id: 'X', url: 'http://x' }] },
  ]);
  assert.equal(obj.lists.length, 2, 'community excluded, empty list kept');
  assert.deepEqual(obj.lists.map((l) => l.id), ['L1', 'L2']);
  assert.equal('exportDate' in obj, false, 'no timestamp in the hashed object');
});

test('planImport: rename updates in place, no duplicate (B3)', () => {
  const incoming = [{ id: 'L1', name: 'Chillout', stations: [] }];   // renamed on another device
  const existing = [{ id: 'L1', name: 'Chill', stations: [] }];
  const { upserts, deleteIds } = planImport(incoming, existing);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].id, 'L1');
  assert.equal(upserts[0].name, 'Chillout');
  assert.deepEqual(deleteIds, [], 'same id → updated in place, no dup, nothing deleted');
});

test('planImport: a list removed elsewhere is deleted here (B2)', () => {
  const incoming = [{ id: 'L1', name: 'Keep', stations: [] }];
  const existing = [
    { id: 'L1', name: 'Keep', stations: [] },
    { id: 'L2', name: 'Gone', stations: [] },
  ];
  assert.deepEqual(planImport(incoming, existing).deleteIds, ['L2']);
});

test('planImport never deletes the community list', () => {
  const existing = [{ id: COMMUNITY, name: 'Community', stations: [] }];
  assert.deepEqual(planImport([], existing).deleteIds, [], 'community list must survive');
});

test('extractTokenFromInput pulls the secret out of a full sync link', () => {
  const secret = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  assert.equal(extractTokenFromInput(`https://radiodock.app/#sync=${secret}`), secret);
  assert.equal(extractTokenFromInput('   '), null);
});
