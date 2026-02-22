import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function toWsTarget(httpTarget: string): string {
  if (httpTarget.startsWith('https://')) return `wss://${httpTarget.slice('https://'.length)}`;
  if (httpTarget.startsWith('http://')) return `ws://${httpTarget.slice('http://'.length)}`;
  return httpTarget;
}

// Basic Vite configuration enabling React support.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devHost = env.VITE_DEV_SERVER_HOST || 'localhost';
  const apiProxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8787';
  const wsProxyTarget = env.VITE_PROXY_WS_TARGET || toWsTarget(apiProxyTarget);

  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: devHost,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: wsProxyTarget,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
      },
    },
  };
});
