import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** t327: dist/sw.js = src/sw.js under this build's cache name and file list, so each deploy is a new worker. */
function serviceWorker(): Plugin {
  return {
    name: 'tribe-service-worker', apply: 'build', enforce: 'post', // post: index.html is in the bundle by then
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== 'index.html').sort();
      const html = bundle['index.html'];
      const version = createHash('sha256').update(files.join('\n'))
        .update(html?.type === 'asset' ? String(html.source) : '').digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js',
        source: `const CACHE = 'tribe-shell-${version}';\nconst FILES = ${JSON.stringify(files)};\n${template}` });
    },
  };
}

export default defineConfig({
  base: '/Tribe-Fantasy/',
  plugins: [react(), serviceWorker()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 30_000,
    // freshDb() runs in hooks and boots PGlite; with every DB file starting at once it can take >10 s.
    hookTimeout: 60_000,
  },
});
