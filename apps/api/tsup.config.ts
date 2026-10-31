import { defineConfig } from 'tsup';
import { cpSync } from 'node:fs';

export default defineConfig({
  entry: { server: 'src/server.ts', worker: 'src/worker.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: ['@vpn/shared'],
  onSuccess: async () => {
    cpSync('migrations', 'dist/migrations', { recursive: true });
  },
});
