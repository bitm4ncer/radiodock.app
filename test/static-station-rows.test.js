import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStaticStationRows } from '../scripts/static-station-rows.mjs';

const S = [
  { id: 'a1', name: 'Kiosk Radio', countrycode: 'BE' },
  { id: 'a2', name: 'NTS Radio 1', countrycode: 'GB' },
];

test('renders one adoptable rows host with a row per station', () => {
  const html = renderStaticStationRows(S);
  assert.equal(html.match(/class="station-list-rows"/g).length, 1);
  assert.equal(html.match(/class="station-item"/g).length, 2);
  assert.match(html, /data-prerendered="community"/);
  assert.match(html, /<div class="station-item-name">Kiosk Radio<\/div>/);
  assert.match(html, /<div class="station-item-country">GB<\/div>/);
  assert.match(html, /data-id="a2"/);
});

test('escapes names, ids and country codes', () => {
  const html = renderStaticStationRows([
    { id: '"><script>x</script>', name: 'Radio <b>&</b> "Co"', countrycode: '<i>' },
  ]);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /Radio &lt;b&gt;&amp;&lt;\/b&gt; &quot;Co&quot;/);
  assert.match(html, /data-id="&quot;&gt;&lt;script&gt;/);
});

test('skips entries without a usable name', () => {
  const html = renderStaticStationRows([{ id: 'x' }, { id: 'y', name: '   ' }, ...S]);
  assert.equal(html.match(/class="station-item"/g).length, 2);
});

test('caps the number of rows', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `Station ${i}` }));
  assert.equal(renderStaticStationRows(many, { limit: 50 }).match(/class="station-item"/g).length, 50);
});

test('returns an empty string when there is nothing to render', () => {
  assert.equal(renderStaticStationRows([]), '');
  assert.equal(renderStaticStationRows(null), '');
  assert.equal(renderStaticStationRows([{ id: 'x' }]), '');
});
