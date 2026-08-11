import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsFromTrack, cacheKey, mergeIds } from '../src/data/track-links.js';
import { sanitizeTrackSnapshot, trackCopyText } from '../src/data/notes.js';

test('idsFromTrack pairs the Apple id with its storefront', () => {
  const ids = idsFromTrack({ spotify: 'sp1', apple: '123', appleCountry: 'de', tidal: 't1', youtube: 'y1' });
  assert.deepEqual(ids, { spotify: 'sp1', apple: { id: '123', country: 'de' }, tidal: 't1', youtube: 'y1' });
});

test('the ISRC wins as cache key, so one recording resolves once', () => {
  assert.equal(cacheKey({ isrc: 'gbarl9300135', spotify: 'sp1' }), 'isrc:GBARL9300135');
  assert.equal(cacheKey({ spotify: 'sp1', deezer: '9' }), 'spotify:sp1');
  assert.equal(cacheKey({ deezer: '9' }), 'deezer:9');
  assert.equal(cacheKey({}), '');
});

test('mergeIds fills gaps but never overwrites first-hand ids', () => {
  const merged = mergeIds(
    { spotify: 'mine', apple: { id: '', country: '' }, tidal: '', youtube: '' },
    { spotify: 'theirs', apple: { id: '123', country: 'de' }, tidal: 't', youtube: 'y' },
  );
  assert.equal(merged.spotify, 'mine');
  assert.deepEqual(merged.apple, { id: '123', country: 'de' });
  assert.equal(merged.tidal, 't');
});

test('mergeIds without a resolution returns the note ids unchanged', () => {
  const own = idsFromTrack({ spotify: 'sp1' });
  assert.deepEqual(mergeIds(own, null), own);
});

test('the track snapshot keeps every id the switcher needs', () => {
  const snap = sanitizeTrackSnapshot({
    artist: 'A', title: 'T', spotify: 'sp', youtube: 'yt',
    apple: '123', appleCountry: 'de', deezer: '9', isrc: 'GBARL9300135',
  });
  assert.equal(snap.apple, '123');
  assert.equal(snap.appleCountry, 'de');
  assert.equal(snap.deezer, '9');
  assert.equal(snap.isrc, 'GBARL9300135');
});

test('absent ids stay null in the snapshot, never undefined', () => {
  const snap = sanitizeTrackSnapshot({ artist: 'A', title: 'T' });
  assert.equal(snap.apple, null);
  assert.equal(snap.isrc, null);
});

test('copy text is plain "Artist - Title" with a plain hyphen', () => {
  assert.equal(trackCopyText({ artist: 'Boards of Canada', title: 'Roygbiv' }), 'Boards of Canada - Roygbiv');
  assert.doesNotMatch(trackCopyText({ artist: 'A', title: 'B' }), /—/);
});

test('copy text falls back to the raw now-playing string, else empty', () => {
  assert.equal(trackCopyText({ nowPlaying: '  Live from Berlin  ' }), 'Live from Berlin');
  assert.equal(trackCopyText({ artist: 'A' }), '');
  assert.equal(trackCopyText(null), '');
});
