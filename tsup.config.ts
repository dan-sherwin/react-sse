import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    splitting: false,
    clean: true,
    dts: true,
    sourcemap: true,
    target: 'es2020',
    jsx: 'automatic',
    treeshake: true,
    minify: false
});