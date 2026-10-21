import test from 'node:test';
import assert from 'node:assert/strict';
import { buildListItemEvent, searchEventData } from '../src/analytics/stations-events.js';

test('buildListItemEvent normalises the list change payload', () => {
  assert.deepEqual(
    buildListItemEvent({ action: 'remove', uuid: 'u1', listId: 'l1', listKind: 'user', source: 'stations' }),
    {
      name: 'list-item',
      data: { action: 'remove', uuid: 'u1', listId: 'l1', listKind: 'user', source: 'stations' },
    },
  );
});

test('buildListItemEvent defaults action, listId, listKind and source', () => {
  const event = buildListItemEvent({});
  assert.equal(event.data.action, 'add');
  assert.equal(event.data.listId, '');
  assert.equal(event.data.listKind, 'user');
  assert.equal(event.data.source, 'unknown');
});

test('buildListItemEvent keeps the community kind', () => {
  assert.equal(buildListItemEvent({ listKind: 'community' }).data.listKind, 'community');
});

test('searchEventData reports the length only, never the query text', () => {
  const out = searchEventData('  drum and bass ', 7);
  assert.deepEqual(out, { queryLength: 13, resultCount: 7 });
  assert.equal(Object.keys(out).includes('query'), false);
});

test('searchEventData coerces a missing result count to zero', () => {
  assert.equal(searchEventData('jazz', undefined).resultCount, 0);
});
