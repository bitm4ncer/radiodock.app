// Share-link encoding for station lists. The list (in extension-compatible
// export shape) is gzipped and base64url-encoded, then placed in the URL
// fragment so it never reaches a server — GitHub Pages access logs,
// Umami, and any intermediate proxies all see the URL but the fragment
// is stripped client-side. Round-trips cleanly with parseExport() from
// data/import-export.js, so the receiving side reuses the existing
// import pipeline (no parallel parser to maintain).

import { exportListAsJson } from './import-export.js';

const PREFIX = '#s=';

export const MAX_SHARE_INPUT_CHARS = 2_000_000;
export const MAX_SHARE_OUTPUT_BYTES = 5_000_000;
export const MAX_SHARE_LISTS = 100;
export const MAX_SHARE_STATIONS = 5000;

async function gzipString(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SHARE_OUTPUT_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('Share link is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

function bytesToBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build a full share URL for the given list, e.g.
 *  https://radiodock.app/#s=<base64url(gzip(json))>
 *  Origin is taken from window.location so the same fn works in
 *  dev (localhost) and prod without configuration. */
export async function buildShareUrl(list) {
  const json = JSON.stringify(exportListAsJson(list));
  const bytes = await gzipString(json);
  return `${window.location.origin}/${PREFIX}${bytesToBase64Url(bytes)}`;
}

function countShareShape(parsed) {
  if (Array.isArray(parsed?.lists)) {
    let stationCount = 0;
    for (const l of parsed.lists) {
      stationCount += Array.isArray(l?.stations) ? l.stations.length : 0;
    }
    return { listCount: parsed.lists.length, stationCount };
  }
  if (Array.isArray(parsed?.stations)) {
    return { listCount: 1, stationCount: parsed.stations.length };
  }
  return { listCount: 0, stationCount: 0 };
}

/** Try to decode an inbound location.hash. Returns the parsed export
 *  payload (same shape as JSON file import) or null if the hash isn't
 *  a share link. Throws on malformed or oversized data so the caller can
 *  toast it before confirmation. */
export async function tryDecodeShareHash(hash) {
  if (!hash || !hash.startsWith(PREFIX)) return null;
  const encoded = hash.slice(PREFIX.length);
  if (!encoded) return null;
  if (encoded.length > MAX_SHARE_INPUT_CHARS) throw new Error('Share link is too large.');
  const bytes = base64UrlToBytes(encoded);
  const json = await gunzipBytes(bytes);
  const parsed = JSON.parse(json);
  const { listCount, stationCount } = countShareShape(parsed);
  if (listCount > MAX_SHARE_LISTS || stationCount > MAX_SHARE_STATIONS) {
    throw new Error('Share link has too many lists or stations.');
  }
  return parsed;
}
