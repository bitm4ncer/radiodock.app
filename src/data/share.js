// Share-link encoding for station lists. The list (in extension-compatible
// export shape) is gzipped and base64url-encoded, then placed in the URL
// fragment so it never reaches a server — GitHub Pages access logs,
// Umami, and any intermediate proxies all see the URL but the fragment
// is stripped client-side. Round-trips cleanly with parseExport() from
// data/import-export.js, so the receiving side reuses the existing
// import pipeline (no parallel parser to maintain).

import { exportListAsJson } from './import-export.js';

const PREFIX = '#s=';

async function gzipString(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
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

/** Try to decode an inbound location.hash. Returns the parsed export
 *  payload (same shape as JSON file import) or null if the hash isn't
 *  a share link. Throws on malformed data so the caller can toast it. */
export async function tryDecodeShareHash(hash) {
  if (!hash || !hash.startsWith(PREFIX)) return null;
  const encoded = hash.slice(PREFIX.length);
  if (!encoded) return null;
  const bytes = base64UrlToBytes(encoded);
  const json = await gunzipBytes(bytes);
  return JSON.parse(json);
}
