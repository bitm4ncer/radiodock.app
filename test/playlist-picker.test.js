import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleLists, pickerHtml } from '../src/ui/playlist-picker.js';

test('eligibleLists drops read-only, community and empty lists', () => {
  const lists = [
    { id: 'favorites', name: 'Favorites', stations: [{ id: 'a' }] },
    { id: '__community__', name: 'Community Radios', stations: [{ id: 'b' }] },
    { id: 'readonly', name: 'Read only', readOnly: true, stations: [{ id: 'c' }] },
    { id: 'empty', name: 'Empty', stations: [] },
  ];
  assert.deepEqual(eligibleLists(lists).map((l) => l.id), ['favorites']);
});

test('pickerHtml lists shareable playlists with station counts', () => {
  const html = pickerHtml({
    lists: [{ id: 'favorites', name: 'Favorites', stations: [{ id: 'a' }, { id: 'b' }] }],
  });
  assert.match(html, /Favorites/);
  assert.match(html, /2 stations/);
  assert.match(html, /data-playlist-select="favorites"/);
});

test('pickerHtml escapes the selected title and shows the form', () => {
  const html = pickerHtml({
    selected: { id: 'favorites', name: '<img src=x>', stations: [{ id: 'a' }] },
    title: '<b>My list</b>',
  });
  assert.match(html, /&lt;b&gt;My list&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /Submit for review/);
});

test('pickerHtml asks for a required name and an optional contact', () => {
  const html = pickerHtml({
    selected: { id: 'favorites', name: 'Favorites', stations: [{ id: 'a' }] },
  });
  assert.match(html, /id="playlistSubmitterName"[^>]*required/);
  assert.match(html, /id="playlistSubmitterContact"/);
  assert.match(html, /Email or contact/);
  assert.match(html, /Your name and the selected list are sent/);
});

test('pickerHtml shows an honest empty state when nothing is shareable', () => {
  const html = pickerHtml({ lists: [] });
  assert.match(html, /no shareable lists/i);
});

test('pickerHtml shows a success message after submission', () => {
  const html = pickerHtml({ success: true });
  assert.match(html, /Submitted for review/);
  assert.match(html, /reviewed and published/);
});
