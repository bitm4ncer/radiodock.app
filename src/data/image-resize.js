// Client-side image downscale → data-URL. Used by the Add panel: submit logos
// (512px) and local custom-stream thumbnails (256px) both travel as data-URLs,
// so we shrink before they hit the network / IndexedDB. Canvas-based; the pure
// fitDimensions helper is split out so it can be unit-tested headless.

export function fitDimensions(w, h, maxPx) {
  const longest = Math.max(w, h);
  if (longest <= maxPx) return { w, h };
  const scale = maxPx / longest;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export async function resizeToDataUrl(file, maxPx) {
  if (!file || !/^image\//.test(file.type || '')) {
    throw new Error('Please choose an image file.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = fitDimensions(bitmap.width, bitmap.height, maxPx);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    // PNG keeps transparency for logos; it is the safest universal choice.
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close?.();
  }
}
