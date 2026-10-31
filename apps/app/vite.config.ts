import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BUILD_ID = String(Date.now());

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      // version.json нужен, чтобы уже открытая (закешированная) копия мини-аппа сама обновлялась после деплоя
      name: 'emit-version',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) }); },
    },
  ],
  server: { port: 5173, host: true, proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: true } } },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 600, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
