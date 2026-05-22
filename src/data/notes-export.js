// JSON export of all notes + pages. Matches the shape of the list-export
// pattern in `data/import-export.js`: a single download with a versioned
// envelope so future schema changes can be detected.

import * as notes from './notes.js';

const EXPORT_VERSION = '1.0';

export async function buildNotesExport() {
  const [pages, allNotes] = await Promise.all([
    notes.getAllPages(),
    notes.getAllNotes(),
  ]);
  return {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      order: p.order,
      createdAt: p.createdAt,
    })),
    notes: allNotes.map((n) => ({
      id: n.id,
      pageId: n.pageId,
      type: n.type,
      body: n.body,
      station: n.station,
      track: n.track,
      createdAt: n.createdAt,
    })),
  };
}

export async function exportNotesPayload() {
  const payload = await buildNotesExport();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `radiodock-notes-${ts}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}
