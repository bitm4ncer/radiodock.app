import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudModel, ringLayout, matchCloud } from '../src/ui/discover-cloud.js';

function station(uuid, countrycode = 'US') {
  return { stationuuid: uuid, name: 'Station ' + uuid, countrycode };
}

function list(slug, count, countries = ['US']) {
  return {
    slug,
    title: slug,
    source: 'radiodock',
    stations: Array.from({ length: count }, (_, i) => station(slug + i, countries[i % countries.length])),
  };
}

test('builds one node per list', () => {
  const model = buildCloudModel([list('jazz', 10), list('news', 8)]);
  assert.equal(model.nodes.length, 2);
  assert.equal(model.nodeBySlug.get('jazz').count, 10);
});

test('preview uses five to eight stations or all when fewer', () => {
  const ten = buildCloudModel([list('ten', 10)]).nodes[0];
  const four = buildCloudModel([list('four', 4)]).nodes[0];
  const zero = buildCloudModel([list('zero', 0)]);
  assert.equal(ten.preview.length, 8);
  assert.equal(four.preview.length, 4);
  assert.equal(zero.nodes.length, 0);
});

test('uses the documented radius formula and clamps', () => {
  const ten = buildCloudModel([list('ten', 10)]).nodes[0];
  const thousand = buildCloudModel([list('thousand', 1000)]).nodes[0];
  const one = buildCloudModel([list('one', 1)]).nodes[0];
  assert.ok(Math.abs(ten.radius - (72 + Math.sqrt(10) * 7)) < 0.001);
  assert.equal(thousand.radius, 140);
  assert.equal(one.radius, 80);
});

test('is deterministic for the same input', () => {
  const lists = [list('jazz', 10), list('news', 8), list('ambient', 6)];
  const first = buildCloudModel(lists);
  const second = buildCloudModel(lists);
  const shape = (model) => model.nodes.map(({ slug, x, y, radius }) => ({ slug, x, y, radius }));
  assert.deepEqual(shape(first), shape(second));
});

test('does not overlap bubbles', () => {
  const lists = Array.from({ length: 35 }, (_, i) => list('c' + i, 5 + Math.round(i * 55 / 34)));
  const model = buildCloudModel(lists);
  for (let i = 0; i < model.nodes.length; i += 1) {
    for (let j = i + 1; j < model.nodes.length; j += 1) {
      const a = model.nodes[i];
      const b = model.nodes[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance >= a.radius + b.radius + 20 - 0.001, `${a.slug} and ${b.slug} overlap`);
    }
  }
});

test('bounds include 240 world units of padding', () => {
  const model = buildCloudModel([list('jazz', 10), list('news', 8)]);
  const minX = Math.min(...model.nodes.map((node) => node.x - node.radius));
  const maxX = Math.max(...model.nodes.map((node) => node.x + node.radius));
  const minY = Math.min(...model.nodes.map((node) => node.y - node.radius));
  const maxY = Math.max(...model.nodes.map((node) => node.y + node.radius));
  assert.ok(model.bounds.minX <= minX - 240 + 0.001);
  assert.ok(model.bounds.maxX >= maxX + 240 - 0.001);
  assert.ok(model.bounds.minY <= minY - 240 + 0.001);
  assert.ok(model.bounds.maxY >= maxY + 240 - 0.001);
});

test('edges connect similar countries and are deduplicated', () => {
  const model = buildCloudModel([
    list('jazz', 10, ['US', 'GB']),
    list('news', 10, ['US', 'GB']),
    list('ambient', 10, ['DE']),
    list('punk', 10, ['DE']),
    list('silent', 10, ['']),
  ]);
  const jazzNews = model.edges.filter((edge) => (
    (edge.a === 'jazz' && edge.b === 'news') || (edge.a === 'news' && edge.b === 'jazz')
  ));
  assert.equal(jazzNews.length, 1);
  assert.equal(model.edges.some((edge) => edge.a === edge.b), false);
  assert.equal(new Set(model.edges.map((edge) => `${edge.a}|${edge.b}`)).size, model.edges.length);
  assert.deepEqual(model.edges.filter((edge) => edge.a === 'silent' || edge.b === 'silent'), []);
});

test('ringLayout uses one, two, or three rings', () => {
  const five = ringLayout(5);
  const nineteen = ringLayout(19);
  const fiftyFive = ringLayout(55);
  assert.deepEqual([...new Set(five.map((point) => point.ring))], [0]);
  assert.equal(five.length, 5);
  assert.deepEqual([...new Set(nineteen.map((point) => point.ring))], [0, 1]);
  assert.deepEqual([0, 1].map((ring) => nineteen.filter((point) => point.ring === ring).length), [10, 9]);
  assert.deepEqual([0, 1, 2].map((ring) => fiftyFive.filter((point) => point.ring === ring).length), [19, 18, 18]);
  assert.deepEqual(fiftyFive.map((point) => point.index), Array.from({ length: 55 }, (_, i) => i));
});

test('ring points are evenly distributed and unique', () => {
  const layout = ringLayout(55);
  assert.equal(new Set(layout.map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)).size, 55);
  for (const ring of [0, 1, 2]) {
    const points = layout.filter((point) => point.ring === ring);
    const angles = points.map((point) => Math.atan2(point.y, point.x)).sort((a, b) => a - b);
    const gaps = angles.slice(1).map((angle, index) => angle - angles[index]);
    gaps.push(angles[0] + Math.PI * 2 - angles[angles.length - 1]);
    for (const gap of gaps) assert.ok(Math.abs(gap - gaps[0]) < 0.001);
  }
});

test('matchCloud finds collection titles', () => {
  const model = buildCloudModel([list('jazz', 3), list('news', 3)]);
  assert.deepEqual(matchCloud(model, 'jazz').collections.map((item) => item.slug), ['jazz']);
  assert.deepEqual(matchCloud(model, 'JAZZ').collections.map((item) => item.slug), ['jazz']);
});

test('matchCloud finds station names across collections', () => {
  const model = buildCloudModel([
    {
      slug: 'jazz',
      title: 'Jazz',
      stations: [{ stationuuid: 'j1', name: 'Smooth Jazz', countrycode: 'US' }],
    },
    {
      slug: 'night',
      title: 'Late Night',
      stations: [
        { stationuuid: 'n1', name: 'Late Night Jazz', countrycode: 'DE' },
        { stationuuid: 'j1', name: 'Smooth Jazz', countrycode: 'US' },
      ],
    },
  ]);
  const result = matchCloud(model, 'jazz');
  assert.equal(result.stations.find((item) => item.stationuuid === 'n1').collectionSlug, 'night');
  assert.equal(result.stations.filter((item) => item.stationuuid === 'j1').length, 1);
  assert.equal(result.stations.find((item) => item.stationuuid === 'j1').collectionSlug, 'jazz');
});

test('matchCloud respects limits and totals', () => {
  const lists = Array.from({ length: 10 }, (_, i) => ({
    slug: `jazz-${i}`,
    title: `Jazz ${i}`,
    stations: [
      { stationuuid: `s${i}-0`, name: `Jazz Station ${i}-0`, countrycode: 'US' },
      { stationuuid: `s${i}-1`, name: `Jazz Station ${i}-1`, countrycode: 'US' },
    ],
  }));
  const result = matchCloud(buildCloudModel(lists), 'jazz');
  assert.equal(result.collections.length, 6);
  assert.equal(result.collectionTotal, 10);
  assert.equal(result.stations.length, 12);
  assert.equal(result.stationTotal, 20);
});

test('matchCloud returns nothing for an empty query', () => {
  const result = matchCloud(buildCloudModel([list('jazz', 3)]), '   ');
  assert.deepEqual(result.collections, []);
  assert.deepEqual(result.stations, []);
  assert.equal(result.collectionTotal, 0);
  assert.equal(result.stationTotal, 0);
});
