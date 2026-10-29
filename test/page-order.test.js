import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPageOrder } from '../src/ui/page-order.js';

function makePage(id) {
  return { id, scrollTop: 0 };
}

// Minimal stand-in for the carousel element: live `children`, plus an
// insertBefore that mimics Chromium resetting a re-inserted element's
// scroll offset to zero.
function makeHost(children) {
  const list = [...children];
  let moves = 0;
  return {
    get children() { return list; },
    get moves() { return moves; },
    insertBefore(node, reference) {
      moves++;
      const from = list.indexOf(node);
      if (from !== -1) list.splice(from, 1);
      const to = reference == null ? list.length : list.indexOf(reference);
      list.splice(to, 0, node);
      node.scrollTop = 0;
    },
  };
}

test('syncPageOrder leaves an unchanged order alone', () => {
  const a = makePage('a');
  const b = makePage('b');
  const c = makePage('c');
  a.scrollTop = 480;
  b.scrollTop = 120;
  const host = makeHost([a, b, c]);

  syncPageOrder(host, [a, b, c]);

  assert.equal(host.moves, 0, 'an unchanged order must not re-insert pages');
  assert.deepEqual(host.children.map((page) => page.id), ['a', 'b', 'c']);
  assert.equal(a.scrollTop, 480);
  assert.equal(b.scrollTop, 120);
});

test('syncPageOrder reorders pages and restores their scroll offsets', () => {
  const a = makePage('a');
  const b = makePage('b');
  const c = makePage('c');
  a.scrollTop = 300;
  b.scrollTop = 90;
  c.scrollTop = 15;
  const host = makeHost([a, b, c]);

  syncPageOrder(host, [c, a, b]);

  assert.deepEqual(host.children.map((page) => page.id), ['c', 'a', 'b']);
  assert.equal(a.scrollTop, 300);
  assert.equal(b.scrollTop, 90);
  assert.equal(c.scrollTop, 15);
});

test('syncPageOrder appends new pages without disturbing existing ones', () => {
  const a = makePage('a');
  const b = makePage('b');
  const d = makePage('d');
  a.scrollTop = 210;
  b.scrollTop = 45;
  const host = makeHost([a, b]);

  syncPageOrder(host, [a, b, d]);

  assert.deepEqual(host.children.map((page) => page.id), ['a', 'b', 'd']);
  assert.equal(a.scrollTop, 210);
  assert.equal(b.scrollTop, 45);
});
