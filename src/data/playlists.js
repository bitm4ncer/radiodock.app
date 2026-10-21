import { STATIONS_BASE } from './stations-api.js';

const TIMEOUT_MS = 12000;

export class PlaylistSubmitError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'PlaylistSubmitError';
    this.status = status;
  }
}

/**
 * Submit a snapshot of a local list for editorial review. The title, note,
 * station UUIDs, your name and an optional contact leave the device; the
 * contact is only used to reach you about this submission, never published.
 */
export async function submitPlaylist({ title, note = '', stationUuids = [], submitterName = '', submitterContact = '' }, { timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${STATIONS_BASE}/api/playlist-submissions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title, note, stationUuids, submitterName, submitterContact }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new PlaylistSubmitError(data?.error || `HTTP ${res.status}`, res.status);
    }
    return data ?? { ok: true };
  } catch (err) {
    if (err instanceof PlaylistSubmitError) throw err;
    if (err?.name === 'AbortError') throw new PlaylistSubmitError('The submission timed out. Try again.');
    throw new PlaylistSubmitError(err?.message || 'Could not submit the collection.');
  } finally {
    clearTimeout(timer);
  }
}
