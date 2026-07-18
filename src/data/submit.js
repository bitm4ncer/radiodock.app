// Public station-submission client. POSTs to the Stations server's one public
// write endpoint. No auth; the server rate-limits, honeypots, and dedupes.
import { STATIONS_BASE } from './stations-api.js';

export class SubmitError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SubmitError';
    this.status = status;
  }
}

const TIMEOUT_MS = 15000;

export async function submitStation(payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${STATIONS_BASE}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } catch {
    throw new SubmitError('Could not reach the server. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok || !data?.ok) {
    throw new SubmitError(data?.error || `Submission failed (HTTP ${res.status}).`, res.status);
  }
  return data;
}
