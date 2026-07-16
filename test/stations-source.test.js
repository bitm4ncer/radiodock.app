import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStationsSource } from '../src/data/stations-source.js';

function makeClient(name, impl = {}) {
  const calls = { search: 0, byuuid: 0 };
  return {
    calls,
    searchStations: async (opts, transport) => {
      calls.search++;
      if (impl.search) return impl.search(opts, transport);
      return [{ id: `${name}-1`, name: `${name} result` }];
    },
    getStationByUuid: async (uuid, transport) => {
      calls.byuuid++;
      if (impl.byuuid) return impl.byuuid(uuid, transport);
      return { id: uuid, name: `${name} station` };
    },
  };
}

test('primary success: fallback is never called', async () => {
  const primary = makeClient('primary');
  const fallback = makeClient('fallback');
  const src = createStationsSource({ primary, fallback });

  const out = await src.searchStations({ query: 'x', filter: 'name' });
  assert.equal(out[0].id, 'primary-1');
  assert.equal(fallback.calls.search, 0);
});

test('primary error: falls back to Radio Browser', async () => {
  const primary = makeClient('primary', { search: async () => { throw new Error('down'); } });
  const fallback = makeClient('fallback');
  const src = createStationsSource({ primary, fallback });

  const out = await src.searchStations({ query: 'x', filter: 'name' });
  assert.equal(out[0].id, 'fallback-1');
  assert.equal(fallback.calls.search, 1);
});

test('getStationByUuid: a primary 404 (null) falls back (the tombstone case)', async () => {
  const primary = makeClient('primary', { byuuid: async () => null });
  const fallback = makeClient('fallback');
  const src = createStationsSource({ primary, fallback });

  const s = await src.getStationByUuid('tombstoned');
  assert.equal(s.id, 'tombstoned');
  assert.equal(s.name, 'fallback station');
  assert.equal(fallback.calls.byuuid, 1);
});

test('a primary 404 does NOT trip the cooldown — the next call still tries primary', async () => {
  let primaryReturnsNull = true;
  const primary = makeClient('primary', {
    byuuid: async (uuid) => (primaryReturnsNull ? null : { id: uuid, name: 'primary station' }),
  });
  const fallback = makeClient('fallback');
  const src = createStationsSource({ primary, fallback });

  await src.getStationByUuid('a');       // 404 -> fallback, no cooldown
  primaryReturnsNull = false;
  const s = await src.getStationByUuid('b');
  assert.equal(s.name, 'primary station'); // primary tried again
  assert.equal(primary.calls.byuuid, 2);
});

test('a primary error trips the cooldown: the next call skips primary until it expires', async () => {
  let clock = 1000;
  const now = () => clock;
  let primaryThrows = true;
  const primary = makeClient('primary', {
    search: async () => { if (primaryThrows) throw new Error('down'); return [{ id: 'primary-1', name: 'p' }]; },
  });
  const fallback = makeClient('fallback');
  const src = createStationsSource({ primary, fallback, retryAfterMs: 60000, now });

  await src.searchStations({ query: 'x' });     // primary throws -> fallback, cooldown set
  assert.equal(primary.calls.search, 1);

  primaryThrows = false;
  clock += 30000;                                // still inside cooldown
  const during = await src.searchStations({ query: 'x' });
  assert.equal(during[0].id, 'fallback-1');      // skipped primary
  assert.equal(primary.calls.search, 1);         // not retried

  clock += 40000;                                // now past 60s
  const after = await src.searchStations({ query: 'x' });
  assert.equal(after[0].id, 'primary-1');        // primary tried again
  assert.equal(primary.calls.search, 2);
});

test('a user-cancelled request rethrows and does not fall back', async () => {
  const primary = makeClient('primary', {
    search: async (_opts, transport) => { const e = new Error('aborted'); throw e; },
  });
  const fallback = makeClient('fallback');
  const ctl = new AbortController();
  ctl.abort();
  const src = createStationsSource({ primary, fallback });

  await assert.rejects(() => src.searchStations({ query: 'x' }, { signal: ctl.signal }));
  assert.equal(fallback.calls.search, 0);
});
