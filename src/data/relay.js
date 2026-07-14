// Builds the recording-relay URL on the Stations VPS. UUID-only — the server
// resolves the stream URL from its own DB (SSRF-safe). Recording requires the
// live VPS; there is no local relay unless the Stations server runs locally.
const RELAY_BASE = 'https://stations.radiodock.app';

export function relayUrl(uuid) {
  return `${RELAY_BASE}/api/relay?uuid=${encodeURIComponent(uuid)}`;
}
