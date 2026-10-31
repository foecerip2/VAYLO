import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: true, proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: true } } },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
});
