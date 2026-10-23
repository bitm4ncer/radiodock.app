import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudModel, ringLayout, matchCloud } from '../src/ui/discover-cloud.js';
import { CLOUD_DIMENSIONS, CLOUD_GENRE_VECTORS } from '../src/ui/cloud-genre-map.js';
import { axisPairKey } from '../src/ui/cloud-geometry.js';
import { COLLECTION_NOTES } from '../src/ui/collection-notes.js';

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

test('carries editorial notes into the cloud model', () => {
  const node = buildCloudModel([list('jungle', 3)]).nodes[0];
  assert.equal(node.info.short, COLLECTION_NOTES.jungle.short);
  assert.equal(node.info.long, COLLECTION_NOTES.jungle.long);
});

test('supports compact preview and layout options for mobile', () => {
  const lists = [list('metal', 20), list('pop', 20), list('news', 20)];
  const compact = buildCloudModel(lists, { previewLimit: 4, layoutSpread: 1.6 });
  const desktop = buildCloudModel(lists, { previewLimit: 8, layoutSpread: 3 });
  assert.equal(compact.nodes[0].preview.length, 4);
  assert.equal(desktop.nodes[0].preview.length, 8);
  assert.ok(compact.bounds.width < desktop.bounds.width);
});

test('preview uses five to eight stations or all when fewer', () => {
  const ten = buildCloudModel([list('ten', 10)]).nodes[0];
  const four = buildCloudModel([list('four', 4)]).nodes[0];
  const zero = buildCloudModel([list('zero', 0)]);
  assert.equal(ten.preview.length, 8);
  assert.equal(four.preview.length, 4);
  assert.equal(zero.nodes.length, 0);
});

test('scales bubble radius with the station count', () => {
  const model = buildCloudModel([list('small', 5), list('mid', 20), list('large', 55)]);
  const small = model.nodeBySlug.get('small');
  const mid = model.nodeBySlug.get('mid');
  const large = model.nodeBySlug.get('large');
  assert.equal(small.radius, 80);
  assert.equal(large.radius, 190);
  assert.ok(mid.radius > small.radius && mid.radius < large.radius);
  assert.ok(large.radius > small.radius * 2);
});

test('clamps radius for tiny and huge collections', () => {
  const one = buildCloudModel([list('one', 1)]).nodes[0];
  const thousand = buildCloudModel([list('thousand', 1000)]).nodes[0];
  assert.equal(one.radius, 80);
  assert.equal(thousand.radius, 190);
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

test('bounds include 180 world units of padding', () => {
  const model = buildCloudModel([list('jazz', 10), list('news', 8)]);
  const minX = Math.min(...model.nodes.map((node) => node.x - node.radius));
  const maxX = Math.max(...model.nodes.map((node) => node.x + node.radius));
  const minY = Math.min(...model.nodes.map((node) => node.y - node.radius));
  const maxY = Math.max(...model.nodes.map((node) => node.y + node.radius));
  assert.ok(model.bounds.minX <= minX - 180 + 0.001);
  assert.ok(model.bounds.maxX >= maxX + 180 - 0.001);
  assert.ok(model.bounds.minY <= minY - 180 + 0.001);
  assert.ok(model.bounds.maxY >= maxY + 180 - 0.001);
});

test('edges use the curated genre graph and are deduplicated', () => {
  const slugs = [
    'black-metal-doom', 'metal', 'punk', 'hardcore', 'classic-rock', 'blues',
    'soul', 'funk', 'news', 'pop', 'dubby', 'hiphop', 'grime', 'trap-drill',
    'noise', 'techno', 'drum-and-bass', 'jungle',
  ];
  const model = buildCloudModel(slugs.map((slug) => list(slug, 5)));
  const keys = new Set(model.edges.map((edge) => (
    edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`
  )));
  assert.equal(model.edges.some((edge) => edge.a === edge.b), false);
  assert.equal(keys.size, model.edges.length);
  for (const expected of [
    'black-metal-doom|metal',
    'classic-rock|metal',
    'blues|classic-rock',
    'funk|soul',
    'news|pop',
    'grime|hiphop',
    'grime|trap-drill',
    'noise|techno',
    'drum-and-bass|hardcore',
    'hardcore|jungle',
  ]) {
    assert.equal(keys.has(expected), true, `${expected} is missing`);
  }
  assert.equal(keys.has('dubby|news'), false);
  assert.equal(keys.has('hardcore|punk'), false);
});

function orderedAxisPairs() {
  const dimensions = Object.keys(CLOUD_DIMENSIONS);
  return dimensions.flatMap((x) => dimensions
    .filter((y) => y !== x)
    .map((y) => ({ x, y, key: axisPairKey(x, y) })));
}

test('keeps semantic positions and layouts for every ordered axis pair', () => {
  const model = buildCloudModel([list('metal', 10), list('pop', 10), list('news', 10)]);
  const metal = model.nodeBySlug.get('metal');
  const pop = model.nodeBySlug.get('pop');
  const news = model.nodeBySlug.get('news');
  for (const { key } of orderedAxisPairs()) {
    assert.ok(metal.layouts[key], `metal has no ${key} layout`);
    assert.ok(pop.layouts[key], `pop has no ${key} layout`);
    assert.ok(news.layouts[key], `news has no ${key} layout`);
  }
  assert.ok(metal.y < pop.y, 'metal should sit above pop on the energy axis');
  assert.ok(news.x < pop.x, 'news should sit left of pop on the electronic axis');
  assert.deepEqual(metal.vector, CLOUD_GENRE_VECTORS.metal);
  for (const key of ['x', 'y', 'z']) {
    assert.equal(Number.isFinite(metal.point3d[key]), true, `point3d.${key} is not finite`);
    assert.ok(Math.abs(metal.point3d[key]) <= 1.0001, `point3d.${key} is outside the unit cube`);
  }
});

test('transposes reversed pairs without overlaps and includes every pair in bounds', () => {
  const slugs = Object.keys(CLOUD_GENRE_VECTORS);
  const model = buildCloudModel(slugs.map((slug, index) => list(slug, 5 + (index % 40))));
  for (const { x, y, key } of orderedAxisPairs()) {
    const reverseKey = axisPairKey(y, x);
    for (let i = 0; i < model.nodes.length; i += 1) {
      const point = model.nodes[i].layouts[key];
      const reverse = model.nodes[i].layouts[reverseKey];
      assert.equal(point.x, -reverse.y);
      assert.equal(point.y, -reverse.x);
      assert.ok(model.bounds.minX <= point.x - model.nodes[i].radius - 180 + 0.001);
      assert.ok(model.bounds.maxX >= point.x + model.nodes[i].radius + 180 - 0.001);
      assert.ok(model.bounds.minY <= point.y - model.nodes[i].radius - 180 + 0.001);
      assert.ok(model.bounds.maxY >= point.y + model.nodes[i].radius + 180 - 0.001);
      for (let j = i + 1; j < model.nodes.length; j += 1) {
        const a = model.nodes[i];
        const b = model.nodes[j];
        const first = a.layouts[key];
        const second = b.layouts[key];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        assert.ok(
          distance >= a.radius + b.radius + 20 - 0.001,
          `${a.slug} and ${b.slug} overlap in ${key}`,
        );
      }
    }
  }
});

test('keeps an unknown collection vector stable when collections are reordered or added', () => {
  const first = buildCloudModel([list('future-one', 6), list('jazz', 6)]);
  const changed = buildCloudModel([list('new-first', 6), list('jazz', 6), list('future-one', 6)]);
  assert.deepEqual(first.nodeBySlug.get('future-one').vector, changed.nodeBySlug.get('future-one').vector);
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
