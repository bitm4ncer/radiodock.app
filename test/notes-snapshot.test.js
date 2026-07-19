import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTrackSnapshot } from '../src/data/notes.js';

test('sanitizeTrackSnapshot keeps artist/title/nowPlaying (existing behaviour)', () => {
  const snap = sanitizeTrackSnapshot({ artist: 'A', title: 'B', nowPlaying: 'A - B' });
  assert.equal(snap.artist, 'A');
  assert.equal(snap.title, 'B');
  assert.equal(snap.nowPlaying, 'A - B');
});

test('sanitizeTrackSnapshot preserves album/spotify/youtube when present', () => {
  const snap = sanitizeTrackSnapshot({
    artist: 'A',
    title: 'B',
    nowPlaying: 'A - B',
    album: 'Great Album',
    spotify: '4uLU6hMCjMI75M1A2tKUQC',
    youtube: 'dQw4w9WgXcQ',
  });
  assert.equal(snap.album, 'Great Album');
  assert.equal(snap.spotify, '4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(snap.youtube, 'dQw4w9WgXcQ');
});

test('sanitizeTrackSnapshot handles missing album/spotify/youtube like the existing fields', () => {
  const snap = sanitizeTrackSnapshot({ artist: 'A', title: 'B', nowPlaying: null });
  assert.equal(snap.album, null);
  assert.equal(snap.spotify, null);
  assert.equal(snap.youtube, null);
});
