import test from 'node:test';
import assert from 'node:assert/strict';
import { stationsRow, updateRowNowPlaying } from '../src/ui/stations-row.js';

const base = {
  id: 'd1', name: 'Dublab', url: 'http://d1', countrycode: 'US',
  city: 'Los Angeles', genreLabel: 'Electronic', tags: ['ambient', 'dub'],
  info: 'Dub and ambient from Los Angeles', plays: 20, rank: 1,
};

test('row renders three lines, actions, and rank', () => {
  const html = stationsRow(base, { mode: 'popular', canAdd: true });
  assert.ok(html.includes('data-id="d1"'));
  assert.ok(html.includes('data-action="play"'));
  assert.ok(html.includes('data-action="info"'));
  assert.ok(html.includes('data-action="add"'));
  assert.ok(html.includes('Dub and ambient'));
  assert.ok(html.includes('1'));
  assert.ok(html.includes('20 plays'));
});

test('row actions use the shared icon button style and always show the favorite heart', () => {
  const enabled = stationsRow(base, { canAdd: true });
  assert.match(enabled, /class="stations-icon-btn stations-row-action[^"]*"[^>]*data-action="add"/);
  const disabled = stationsRow(base, { canAdd: false });
  assert.match(disabled, /data-action="add"/);
  assert.match(disabled, /disabled/);
});

test('row escapes untrusted text and highlights the name', () => {
  const html = stationsRow({ ...base, name: '<script>Jazz</script>' }, { query: 'jazz' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<mark>Jazz</mark>'));
});

test('row falls back to tags and then genre', () => {
  const tags = stationsRow({ ...base, info: '' });
  assert.ok(tags.includes('ambient'));
  const genre = stationsRow({ ...base, info: '', tags: [] });
  assert.ok(genre.includes('Electronic'));
});

test('row presents country, genre, stats, and tags as visual chips', () => {
  const html = stationsRow({ ...base, info: '', avgMinutes: 24 }, { mode: 'popular' });
  assert.match(html, /class="stations-row-country"[^>]*title="United States"[^>]*>US</);
  assert.match(html, /class="stations-row-genre"[^>]*>Electronic</);
  assert.match(html, /class="stations-row-stat"[^>]*>.*20/);
  assert.match(html, /class="stations-row-stat"[^>]*>.*24m/);
  assert.match(html, /class="stations-row-tag"/);
  assert.match(html, /class="stations-row-hash">#</);
});

test('row escapes untrusted country, genre, and tag text', () => {
  const html = stationsRow({
    ...base,
    countrycode: 'DE',
    genreLabel: '<b>Jazz</b>',
    tags: ['<img src=x>'],
    info: '',
  });
  assert.ok(!html.includes('<b>Jazz</b>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;b&gt;Jazz&lt;/b&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});

test('updateRowNowPlaying toggles class and aria state', () => {
  const row = { classList: { toggle() {} }, setAttribute() {} };
  let toggled = false;
  row.classList.toggle = () => { toggled = true; };
  updateRowNowPlaying(row, true);
  assert.equal(toggled, true);
});
