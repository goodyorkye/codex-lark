import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli/index.ts' },
    outDir: 'dist',
    format: ['cjs'],
    target: 'node20',
    platform: 'node',
    clean: true,
    sourcemap: false,
    splitting: false,
    dts: false,
    outExtension: () => ({ js: '.cjs' }),
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    dts: true,
  },
  {
    entry: { 'desktop-sea': 'src/desktop/sea-entry.ts' },
    outDir: 'dist',
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    dts: false,
    noExternal: [/.*/],
  },
]);
