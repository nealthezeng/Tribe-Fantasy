import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Tribe-Fantasy/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    // freshDb() runs in hooks and boots PGlite; with every DB file starting at once it can take >10 s.
    hookTimeout: 60_000,
  },
});
