import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  splitting: false,
  shims: true, // Adds shims for import.meta.url in CJS
  external: [
    'fs',
    'path',
    'url',
    'module',
    /\.node$/,
  ],
  platform: 'node',
  target: 'node18',
});

