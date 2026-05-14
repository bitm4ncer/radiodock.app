// Rasterize the brand SVG into the PWA icon set.
// Run with `npm run icons`. Outputs to public/icons/.
//
// Maskable icon: PWA platforms crop the icon to various shapes (circle on
// Android, squircle on Windows). The inner 80% "safe zone" must contain the
// brand mark; the outer 20% is background-only. We composite the brand at
// 75% scale onto a solid dark background to give plenty of safe-zone room.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'icons', 'icon.svg');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const BG = '#0d0d0d'; // matches the brand SVG's dark background fill

async function renderSquare(size, { padding = 0 } = {}) {
  const innerSize = Math.round(size * (1 - padding * 2));
  const innerSvg = await sharp(SRC).resize(innerSize, innerSize, { fit: 'contain' }).png().toBuffer();
  const offset = Math.round(size * padding);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: innerSvg, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const targets = [
    { name: 'icon-192.png',          size: 192, padding: 0 },
    { name: 'icon-512.png',          size: 512, padding: 0 },
    { name: 'icon-maskable-512.png', size: 512, padding: 0.125 }, // 12.5% padding each side
    { name: 'apple-touch-icon.png',  size: 180, padding: 0 },
    { name: 'favicon-32.png',        size: 32,  padding: 0 },
    { name: 'favicon-16.png',        size: 16,  padding: 0 },
  ];

  for (const { name, size, padding } of targets) {
    const buf = await renderSquare(size, { padding });
    await writeFile(path.join(OUT_DIR, name), buf);
    console.log(`✓ ${name}  ${size}×${size}  padding=${padding}`);
  }
}

main().catch((err) => {
  console.error('icon generation failed:', err);
  process.exit(1);
});
