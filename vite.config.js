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
