import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('dist/viewer', { recursive: true });
const cli = await build({ entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, platform: 'node', target: 'node24', format: 'esm', banner: { js: '#!/usr/bin/env node' }, sourcemap: true, metafile: true });
const viewer = await build({ entryPoints: ['src/viewer/main.tsx'], outfile: 'dist/viewer/app.js', bundle: true, platform: 'browser', target: 'es2022', format: 'iife', minify: true, jsx: 'automatic', loader: { '.woff2': 'file' }, assetNames: 'fonts/[name]-[hash]', define: { 'process.env.NODE_ENV': '"production"' }, metafile: true });
// Bundled libraries/fonts no longer ship as runtime dependencies; retain their license texts.
const packages = new Set();
for (const input of [...Object.keys(cli.metafile.inputs), ...Object.keys(viewer.metafile.inputs)]) {
  const match = [...input.matchAll(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+/g)].at(-1);
  if (match) packages.add(input.slice(0, match.index + match[0].length));
}
const notices = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const licenses = (await readdir(directory)).filter(file => /^(?:licen[sc]e|copying|ofl|notice)(?:[.-]|$)/i.test(file)).sort();
  if (!licenses.length) throw new Error(`Missing license text for bundled package ${pkg.name}.`);
  notices.push(`${pkg.name}@${pkg.version}\n${(await Promise.all(licenses.map(file => readFile(path.join(directory, file), 'utf8')))).join('\n')}`);
}
await writeFile('dist/viewer/THIRD_PARTY_NOTICES.txt', notices.join('\n\n--------------------\n\n'));
await writeFile('dist/viewer/index.html', '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>DiffSlice</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
console.log('Built DiffSlice CLI and offline browser viewer.');
