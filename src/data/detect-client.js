import { STATIONS_BASE } from './stations-api.js';

export class DetectError extends Error {
  constructor(status, reason, message) {
    super(message || reason || `HTTP ${status}`);
    this.name = 'DetectError';
    this.status = status;
    this.reason = reason;
  }
}

// Returns { ok, track?, reason? } for a 200 (including ok:false no-match).
// Throws DetectError for rate-limit / disabled / budget / server / network errors.
export async function detectTrack(uuid) {
  let res;
  try {
    res = await fetch(`${STATIONS_BASE}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    const reason = e?.name === 'TimeoutError' ? 'timeout' : 'network';
    throw new DetectError(0, reason, e?.message);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 200) return data;
  throw new DetectError(res.status, data.reason || 'error', data.reason);
}
