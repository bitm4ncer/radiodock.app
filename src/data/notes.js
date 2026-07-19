// Notes + pages facade on top of storage.js.
//
// Data model:
//   notePages: { id, name, order, createdAt }
//   notes:     { id, pageId, type: 'note'|'capture', body, station, track, createdAt }
//
// Conventions:
//   - The 'journal' page is the default; lazily created on first read.
//     It can be renamed but not deleted (UI hides the delete option).
//   - Track snapshots are immutable after capture — the metadata-poller
//     does not mutate stored captures.

import * as storage from './storage.js';

export const JOURNAL_PAGE_ID = 'journal';

function genNoteId() {
  return 'note_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function genPageId() {
  return 'page_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function now() {
  return Date.now();
}

// ---------- Pages ----------

export async function getAllPages() {
  let pages = await storage.getAllNotePages();
  if (!pages.length || !pages.some((p) => p.id === JOURNAL_PAGE_ID)) {
    const journal = {
      id: JOURNAL_PAGE_ID,
      name: 'Journal',
      order: 0,
      createdAt: now(),
    };
    await storage.putNotePage(journal);
    pages = [journal, ...pages.filter((p) => p.id !== JOURNAL_PAGE_ID)];
  }
  return pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function createPage(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Page name is required.');
  if (trimmed.length > 50) throw new Error('Page name is too long (max 50 characters).');
  const existing = await storage.getAllNotePages();
  if (existing.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A page with that name already exists.');
  }
  const maxOrder = existing.reduce((m, p) => Math.max(m, p.order ?? 0), 0);
  const page = {
    id: genPageId(),
    name: trimmed,
    order: maxOrder + 1,
    createdAt: now(),
  };
  await storage.putNotePage(page);
  return page;
}

export async function renamePage(id, name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Page name is required.');
  if (trimmed.length > 50) throw new Error('Page name is too long (max 50 characters).');
  const existing = await storage.getAllNotePages();
  if (existing.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A page with that name already exists.');
  }
  const page = existing.find((p) => p.id === id);
  if (!page) throw new Error('Page not found.');
  page.name = trimmed;
  await storage.putNotePage(page);
  return page;
}

export async function deletePage(id) {
  if (id === JOURNAL_PAGE_ID) throw new Error('The Journal page cannot be deleted.');
  await storage.deleteNotesForPage(id);
  await storage.deleteNotePage(id);
}

// ---------- Notes ----------

export async function getAllNotes() {
  return storage.getAllNotes();
}

export async function getNotesForPage(pageId) {
  return storage.getNotesForPage(pageId);
}

export async function createNote({ pageId, body = '' } = {}) {
  if (!pageId) throw new Error('pageId is required.');
  const note = {
    id: genNoteId(),
    pageId,
    type: 'note',
    body: String(body ?? ''),
    station: null,
    track: null,
    createdAt: now(),
  };
  await storage.putNote(note);
  return note;
}

export async function createCapture({ pageId, station = null, track = null, body = '' } = {}) {
  if (!pageId) throw new Error('pageId is required.');
  const note = {
    id: genNoteId(),
    pageId,
    type: 'capture',
    body: String(body ?? ''),
    station: station ? sanitizeStationSnapshot(station) : null,
    track: track ? sanitizeTrackSnapshot(track) : null,
    createdAt: now(),
  };
  await storage.putNote(note);
  return note;
}

export async function createRecording({ pageId, station = null, track = null, blob, mime, durationMs = 0, bytes = 0 } = {}) {
  if (!pageId) throw new Error('pageId is required.');
  if (!blob) throw new Error('recording blob is required.');
  const note = {
    id: genNoteId(),
    pageId,
    type: 'recording',
    body: '',
    station: station ? sanitizeStationSnapshot(station) : null,
    track: track ? sanitizeTrackSnapshot(track) : null,
    mime: mime ?? blob.type ?? 'audio/webm',
    durationMs,
    bytes: bytes || blob.size,
    createdAt: now(),
  };
  await storage.putRecordingAudio(note.id, blob);
  await storage.putNote(note);
  return note;
}

export async function getRecordingBlob(id) {
  return storage.getRecordingAudio(id);
}

export async function updateNoteBody(id, body) {
  const all = await storage.getAllNotes();
  const note = all.find((n) => n.id === id);
  if (!note) throw new Error('Note not found.');
  note.body = String(body ?? '');
  await storage.putNote(note);
  return note;
}

export async function moveNote(id, targetPageId) {
  const all = await storage.getAllNotes();
  const note = all.find((n) => n.id === id);
  if (!note) throw new Error('Note not found.');
  const pages = await storage.getAllNotePages();
  if (!pages.some((p) => p.id === targetPageId)) throw new Error('Target page not found.');
  note.pageId = targetPageId;
  await storage.putNote(note);
  return note;
}

export async function deleteNote(id) {
  await storage.deleteRecordingAudio(id); // no-op for non-recordings
  await storage.deleteNote(id);
}

export async function restoreNote(note) {
  // Used by undo-toast — re-puts a previously deleted note. Caller
  // guarantees the original record (no mutation since deletion).
  if (!note?.id) throw new Error('Invalid note for restore.');
  await storage.putNote(note);
  return note;
}

// ---------- Snapshot helpers ----------

function sanitizeStationSnapshot(station) {
  // Keep only the fields a capture needs to display + reload. Avoids
  // storing whole Radio-Browser station rows (large + transient).
  return {
    id: station.id ?? null,
    name: station.name ?? '',
    countrycode: station.countrycode ?? '',
    url: station.url ?? '',
    favicon: station.favicon ?? '',
    homepage: station.homepage ?? '',
  };
}

export function sanitizeTrackSnapshot(track) {
  return {
    artist: track.artist ?? null,
    title: track.title ?? null,
    nowPlaying: track.nowPlaying ?? null,
    // Additive: carries external ids so a detected-track note can render an
    // expandable embed later. Same null-when-absent style as the fields above.
    album: track.album ?? null,
    spotify: track.spotify ?? null,
    youtube: track.youtube ?? null,
  };
}
