import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const environmentRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, environmentRoot, 'API_PROXY_');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': env.API_PROXY_TARGET || 'http://127.0.0.1:7001',
      },
    }
  };
});
