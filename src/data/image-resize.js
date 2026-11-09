// Client-side image downscale → data-URL. Used by the Add panel: submit logos
// (512px) and local custom-stream thumbnails (256px) both travel as data-URLs,
// so we shrink before they hit the network / IndexedDB. Canvas-based; the pure
// helpers are split out so they can be unit-tested headless.

// A lossless PNG at 512px is small for flat logo art but routinely 200-500 KB
// for anything photographic. Those submissions came back as a bare HTTP 413
// from the Stations server, which is impossible to act on from the UI, so we
// now encode lossily and step the dimensions down until the payload fits this
// budget. WebP first (keeps alpha, roughly half the bytes of PNG); JPEG as the
// fallback for engines that ignore the quality argument on WebP.
export const MAX_LOGO_BYTES = 120 * 1024;

const ENCODERS = [
  { type: 'image/webp', quality: 0.82 },
  { type: 'image/webp', quality: 0.62 },
  { type: 'image/jpeg', quality: 0.82 },
  { type: 'image/jpeg', quality: 0.6 },
  { type: 'image/png' },
];

export function fitDimensions(w, h, maxPx) {
  const longest = Math.max(w, h);
  if (longest <= maxPx) return { w, h };
  const scale = maxPx / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/** Byte length of the payload behind a data-URL. Pure, so it is testable. */
export function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.endsWith(';base64')) return payload.length;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function encodeCanvas(canvas, encoder) {
  // JPEG has no alpha channel, so a transparent logo would render with black
  // fringes. Flatten onto white first so it stays legible on any surface.
  if (encoder.type !== 'image/jpeg') {
    return canvas.toDataURL(encoder.type, encoder.quality);
  }
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat.toDataURL(encoder.type, encoder.quality);
}

export async function resizeToDataUrl(file, maxPx, { maxBytes = MAX_LOGO_BYTES } = {}) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new Error('Please choose an image file.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let { w, h } = fitDimensions(bitmap.width, bitmap.height, maxPx);
    let smallest = null;
    let smallestBytes = Infinity;
    // The first pass at full size almost always fits; the retry loop only
    // matters for photographic art or a tighter budget passed by the caller.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const encoder of ENCODERS) {
        const dataUrl = encodeCanvas(canvas, encoder);
        const bytes = dataUrlBytes(dataUrl);
        if (bytes <= maxBytes) return dataUrl;
        if (bytes < smallestBytes) {
          smallestBytes = bytes;
          smallest = dataUrl;
        }
      }
      w = Math.max(1, Math.round(w * 0.75));
      h = Math.max(1, Math.round(h * 0.75));
    }
    // Nothing fit the budget. Hand back the smallest candidate rather than
    // throwing: the submit path re-checks the total body size and reports it.
    return smallest;
  } finally {
    bitmap.close?.();
  }
}
