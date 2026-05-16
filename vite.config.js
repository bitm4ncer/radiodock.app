import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';

function buildId() {
  let sha = '';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {}
  return `${Date.now()}${sha ? '-' + sha : ''}`;
}

// User-facing version label. Major.minor is fixed in code; the patch
// auto-increments with every commit on main. Formula: (commit count) -
// VERSION_BASELINE_COMMIT_COUNT. Baseline is the commit count BEFORE
// the change that introduced the version display, so the first commit
// that ships this feature reads as patch 1 (→ v1.0.1).
//
// To start a new minor cycle (e.g. v1.1), bump VERSION_MAJOR_MINOR and
// reset VERSION_BASELINE_COMMIT_COUNT to the current `git rev-list
// --count HEAD` value.
const VERSION_MAJOR_MINOR = '1.0';
const VERSION_BASELINE_COMMIT_COUNT = 38;

function appVersion() {
  try {
    const out = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const count = Number.parseInt(out, 10);
    if (!Number.isFinite(count)) return `${VERSION_MAJOR_MINOR}.0`;
    const patch = Math.max(count - VERSION_BASELINE_COMMIT_COUNT, 0);
    return `${VERSION_MAJOR_MINOR}.${patch}`;
  } catch {
    return `${VERSION_MAJOR_MINOR}.0`;
  }
}

// Replace __BUILD_ID__ in the final dist/sw.js so the cache name changes on
// every deploy. We do this in writeBundle (post-emit) because sw.js comes
// from /public and Vite copies it verbatim.
function injectBuildIdPlugin() {
  const id = buildId();
  return {
    name: 'inject-build-id',
    apply: 'build',
    async closeBundle() {
      const swPath = path.resolve('dist/sw.js');
      try {
        const src = await readFile(swPath, 'utf8');
        if (!src.includes('__BUILD_ID__')) return;
        await writeFile(swPath, src.replaceAll('__BUILD_ID__', id), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`  injected BUILD_ID=${id} into sw.js`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [injectBuildIdPlugin()],
  define: {
    // Inlined as a string literal at build time. Code reads this as a
    // bare identifier (no import needed), Vite replaces it pre-bundle.
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700, // hls.js is ~520 kB, lazy-loaded.
  },
  server: {
    // Port from $PORT env (set by Claude Preview); fallback 5173 for plain `npm run dev`.
    port: Number(process.env.PORT) || 5173,
    host: true,
    strictPort: false,
  },
});
