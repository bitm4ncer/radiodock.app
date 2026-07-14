// Thin client for the Stations server-side recording endpoints. Mobile only —
// iOS can't capture audio client-side, so the VPS records and we download the
// finished file. See docs/superpowers/specs/2026-07-14-mobile-server-recording-design.md
const BASE = 'https://stations.radiodock.app';

export class RecordingExpiredError extends Error {}

export async function startRecording(uuid) {
  const res = await fetch(`${BASE}/api/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  return res.json(); // { id, mime }
}

export async function stopRecording(id) {
  const res = await fetch(`${BASE}/api/record/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (res.status === 404) return { id, bytes: 0, mime: 'audio/mpeg', durationMs: 0 };
  if (!res.ok) throw new Error(`stop failed: ${res.status}`);
  return res.json();
}

export async function fetchRecording(id) {
  const res = await fetch(`${BASE}/api/record/fetch?id=${encodeURIComponent(id)}`);
  if (res.status === 404) throw new RecordingExpiredError('recording expired');
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.blob();
}
