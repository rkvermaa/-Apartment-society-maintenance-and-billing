/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  const apiPort = Number(env.ARC_DEV_PORT) || 8003;

  return {
    plugins: [react()],
    server: {
      port: Number(env.ARC_WEB_PORT) || 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/vitest.setup.ts'],
    },
  };
});
