/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    // Backend tests under test/ use Node's built-in test runner (see `npm run test:server`)
    // and must not be picked up by vitest, which only exercises the frontend under src/.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
