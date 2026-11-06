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

// The server answers an oversized body with a bare HTTP 413, which reaches the
// user as "Submission failed (HTTP 413)" and no way forward. Check the size
// locally first so we can say what is too big. Logos are the only field that
// can realistically get a normal submission anywhere near this limit.
const MAX_BODY_BYTES = 256 * 1024;

function bodyBytes(text) {
  return new TextEncoder().encode(text).length;
}

export async function submitStation(payload) {
  // Serialise once and reuse: the size check has to see the exact bytes that
  // go over the wire, not an estimate.
  const body = JSON.stringify(payload);
  const bytes = bodyBytes(body);
  if (bytes > MAX_BODY_BYTES) {
    const kb = Math.round(bytes / 1024);
    const limitKb = Math.round(MAX_BODY_BYTES / 1024);
    throw new SubmitError(
      `That submission is ${kb} KB and our limit is ${limitKb} KB. The logo is usually the biggest part — try a smaller image.`,
      413,
    );
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${STATIONS_BASE}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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
