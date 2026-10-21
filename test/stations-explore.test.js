import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORE_PAGE_SIZE,
  buildExploreFeed,
  nextExploreLimit,
  pickExploreStation,
} from '../src/ui/stations-explore.js';

function station(uuid, name = uuid) {
  return { stationuuid: uuid, name, countrycode: 'DE' };
}

function list(slug, stations) {
  return { slug, title: slug, source: 'radiodock', featured: false, stations };
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('tier boundaries at positions 4, 5, 9, and 10', () => {
  const feed = buildExploreFeed([
    list('one', Array.from({ length: 12 }, (_, index) => station(`s${index}`))),
  ], () => 0.5);

  assert.deepEqual(feed.map((entry) => entry.tier), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3]);
  assert.deepEqual(
    feed.map((entry) => entry.position).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test('deduplicates by uuid and keeps the best tier', () => {
  const firstStations = Array.from({ length: 11 }, (_, index) => station(`a${index}`));
  firstStations[10] = station('dup');
  const secondStations = [station('b0'), station('b1'), station('dup')];

  const feed = buildExploreFeed([
    list('first', firstStations),
    list('second', secondStations),
  ], () => 0.5);

  const matches = feed.filter((entry) => entry.stationuuid === 'dup');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, 1);
  assert.equal(matches[0].collectionSlug, 'second');
  assert.equal(matches[0].position, 2);
});

test('keeps the first occurrence when duplicate tiers tie', () => {
  const feed = buildExploreFeed([
    list('first', [station('dup'), station('a1')]),
    list('second', [station('dup'), station('b1')]),
  ], () => 0.5);

  const match = feed.find((entry) => entry.stationuuid === 'dup');
  assert.equal(match.collectionSlug, 'first');
});

test('shuffles each tier deterministically with the injected random', () => {
  const lists = [
    list('one', Array.from({ length: 30 }, (_, index) => station(`s${index}`))),
  ];

  const first = buildExploreFeed(lists, seeded(7)).map((entry) => entry.stationuuid);
  const second = buildExploreFeed(lists, seeded(7)).map((entry) => entry.stationuuid);
  const different = buildExploreFeed(lists, seeded(8)).map((entry) => entry.stationuuid);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
});

test('orders tier one before tier two before tier three', () => {
  const feed = buildExploreFeed([
    list('one', Array.from({ length: 30 }, (_, index) => station(`s${index}`))),
  ], seeded(11));

  for (let index = 1; index < feed.length; index += 1) {
    assert.ok(feed[index - 1].tier <= feed[index].tier);
  }
});

test('does not mutate input lists or stations', () => {
  const lists = [
    list('one', Array.from({ length: 12 }, (_, index) => station(`s${index}`))),
    list('two', Array.from({ length: 7 }, (_, index) => station(`t${index}`))),
  ];
  const before = JSON.stringify(lists);

  buildExploreFeed(lists, seeded(3));

  assert.equal(JSON.stringify(lists), before);
});

test('handles empty and short lists', () => {
  assert.deepEqual(buildExploreFeed([], () => 0.5), []);
  assert.deepEqual(buildExploreFeed([list('empty', [])], () => 0.5), []);

  const three = buildExploreFeed([
    list('three', Array.from({ length: 3 }, (_, index) => station(`s${index}`))),
  ], () => 0.5);
  assert.deepEqual(three.map((entry) => entry.tier), [1, 1, 1]);

  const seven = buildExploreFeed([
    list('seven', Array.from({ length: 7 }, (_, index) => station(`s${index}`))),
  ], () => 0.5);
  assert.deepEqual(seven.map((entry) => entry.tier), [1, 1, 1, 1, 1, 2, 2]);
});

test('returns the documented station shape', () => {
  const feed = buildExploreFeed([list('one', [station('s0')])], () => 0.5);

  assert.deepEqual(Object.keys(feed[0]).sort(), [
    'collectionSlug',
    'collectionTitle',
    'countrycode',
    'id',
    'name',
    'position',
    'stationuuid',
    'tier',
  ]);
  assert.equal(feed[0].id, feed[0].stationuuid);
});

test('nextExploreLimit advances by 60 and clamps', () => {
  assert.equal(EXPLORE_PAGE_SIZE, 60);
  assert.equal(nextExploreLimit(0, 150), 60);
  assert.equal(nextExploreLimit(60, 150), 120);
  assert.equal(nextExploreLimit(120, 150), 150);
  assert.equal(nextExploreLimit(150, 150), 150);
});

test('pickExploreStation is uniform over the feed boundaries', () => {
  const feed = buildExploreFeed([
    list('one', Array.from({ length: 10 }, (_, index) => station(`s${index}`))),
  ], () => 0.5);

  assert.equal(pickExploreStation([], () => 0), null);
  assert.equal(pickExploreStation(feed, () => 0), feed[0]);
  assert.equal(pickExploreStation(feed, () => 0.999999), feed[feed.length - 1]);
  assert.equal(pickExploreStation(feed, () => 1), feed[feed.length - 1]);
});
