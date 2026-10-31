import { defineConfig } from 'tsup';
export default defineConfig({ entry: { index: 'src/index.ts' }, format: ['esm'], target: 'node20', platform: 'node', clean: true, sourcemap: true, noExternal: ['@vpn/shared'] });
