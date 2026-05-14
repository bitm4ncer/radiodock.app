import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
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
