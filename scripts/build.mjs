import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist/viewer', { recursive: true });
await build({ entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, platform: 'node', target: 'node22', format: 'esm', banner: { js: '#!/usr/bin/env node' }, sourcemap: true });
await build({ entryPoints: ['src/viewer/main.tsx'], outfile: 'dist/viewer/app.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife', minify: true, jsx: 'automatic', loader: { '.woff2': 'file' }, assetNames: 'fonts/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile('dist/viewer/index.html', '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>DiffSlice</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
console.log('Built DiffSlice CLI and offline browser viewer.');
