import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLists } from '../src/data/sync.js';

const st = (id) => ({ id, name: id, url: `http://${id}` });
const list = (id, ids) => ({ id, name: id, stations: ids.map(st) });
const obj = (...lists) => ({ version: '2.0', lists });

test('mergeLists: Favorites [A] merged with [B] yields [A,B], never silently [A]', () => {
  const base = obj(list('favorites', []));
  const local = obj(list('favorites', ['A']));
  const remote = obj(list('favorites', ['B']));
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, false);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['A', 'B']);
});

test('mergeLists: a local delete of an unchanged station tombstones it', () => {
  const base = obj(list('favorites', ['A', 'B']));
  const local = obj(list('favorites', ['A']));
  const remote = obj(list('favorites', ['A', 'B']));
  const r = mergeLists(base, local, remote);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['A']);
});

test('mergeLists: surfaces a conflict when the same station was edited on both sides', () => {
  const mk = (name) => ({ version: '2.0', lists: [{ id: 'favorites', name: 'favorites', stations: [{ id: 'A', name, url: 'http://a' }] }] });
  assert.equal(mergeLists(mk('v1'), mk('v2'), mk('v3')).conflict, true);
});

test('mergeLists: surfaces a conflict on delete vs edit', () => {
  const base = { version: '2.0', lists: [{ id: 'favorites', name: 'favorites', stations: [{ id: 'A', name: 'v1', url: 'http://a' }] }] };
  const local = { version: '2.0', lists: [{ id: 'favorites', name: 'favorites', stations: [{ id: 'A', name: 'v2', url: 'http://a' }] }] };
  const remote = { version: '2.0', lists: [{ id: 'favorites', name: 'favorites', stations: [] }] };
  assert.equal(mergeLists(base, local, remote).conflict, true);
});

test('mergeLists: whole-list delete with no change on the other side deletes cleanly', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const local = obj(); // device A removed the whole list
  const remote = obj(list('rock', ['X', 'Y'])); // device B left it unchanged
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, false);
  assert.equal(r.lists.length, 0);
});

test('mergeLists: whole-list delete vs add surfaces a conflict and retains the added data', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const local = obj(); // device A deleted the list
  const remote = obj(list('rock', ['X', 'Y', 'Z'])); // device B added Z
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['X', 'Y', 'Z'], 'X and Y must not be tombstoned');
});

test('mergeLists: whole-list delete vs edit surfaces a conflict and retains the edit', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const local = obj(); // device A deleted the list
  const remote = obj({ id: 'rock', name: 'rock', stations: [
    { id: 'X', name: 'X2', url: 'http://X' },
    { id: 'Y', name: 'Y', url: 'http://Y' },
  ] }); // device B edited X
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, true);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['X', 'Y']);
  assert.equal(r.lists[0].stations.find((s) => s.id === 'X').name, 'X2');
});

test('mergeLists: both sides deleting the same list drops it without a conflict', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const r = mergeLists(base, obj(), obj());
  assert.equal(r.conflict, false);
  assert.equal(r.lists.length, 0);
});

test('mergeLists: a list present on only one side with no base still merges', () => {
  const base = obj();
  const local = obj(list('rock', ['A']));
  const remote = obj();
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, false);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['A']);
});

test('mergeLists: delete vs an empty list resolves cleanly (no false conflict)', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const local = obj();                 // device A removed the whole list
  const remote = obj(list('rock', [])); // device B emptied it
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, false, 'both sides agree the stations are gone');
  assert.equal(r.lists.length, 0);
});

test('mergeLists: with no base a delete is restored by union without losing any station', () => {
  const base = obj();                   // upgrading user: no stored base
  const local = obj();                  // device A removed the list
  const remote = obj(list('rock', ['X', 'Y'])); // device B still has it
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, false);
  assert.deepEqual(r.lists[0].stations.map((s) => s.id), ['X', 'Y'], 'no station may be lost');
});

test('mergeLists: delete vs reorder surfaces a conflict (station order matters)', () => {
  const base = obj(list('rock', ['X', 'Y']));
  const local = obj(); // device A deleted
  const remote = obj({ id: 'rock', name: 'rock', stations: [st('Y'), st('X')] }); // device B reordered
  const r = mergeLists(base, local, remote);
  assert.equal(r.conflict, true, 'a reorder is a real change, not a clean delete');
});
