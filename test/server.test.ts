import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { prepareReview } from '../src/review.js';
import { startServer, exportHtml, createDiffLoader, serializeEmbedded } from '../src/server.js';

test('read-only HTTP review serves real patches and rejects unknown files', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const review = await prepareReview({ repo: f.root, base: f.base, head: f.head, mapPath: f.mapPath, cacheDir: path.join(f.root, '.cache') });
  const { server, url } = await startServer({ repo: f.root, review, assets: path.resolve('dist/viewer') });
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  assert.equal((await fetch(url)).status, 200);
  assert.match(await (await fetch(`${url}/app.js`)).text(), /DiffSlice/);
  const manifest = await (await fetch(`${url}/api/review`)).json(); assert.equal(manifest.totals.files, 5);
  const file = review.files.find(file => file.path === 'src/auth.ts')!;
  const response = await fetch(`${url}/api/files/${file.id}/diff`); assert.equal(response.status, 200);
  assert.match((await response.json()).patch, /after/);
  assert.equal((await fetch(`${url}/api/files/file-999/diff`)).status, 404);
  assert.equal((await fetch(`${url}/api/review`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${url}/package.json`)).status, 404);
});

test('portable export embeds all diffs and escapes script injection', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const review = await prepareReview({ repo: f.root, base: f.base, head: f.head, mapPath: f.mapPath, cacheDir: path.join(f.root, '.cache') });
  review.repository = '</script><script>alert(1)</script>';
  const output = path.join(f.root, 'review.html');
  await exportHtml(output, review, createDiffLoader(f.root, review), path.resolve('dist/viewer'));
  const html = await readFile(output, 'utf8');
  assert.match(html, /data:font\/woff2;base64/);
  const licenses = JSON.parse(html.match(/<script id="diffslice-licenses" type="application\/json">([\s\S]*?)<\/script>/)![1]);
  assert.match(licenses, /@fontsource-variable\/manrope/);
  assert.match(licenses, /SIL OPEN FONT LICENSE/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  const raw = html.match(/<script id="diffslice-data" type="application\/json">([\s\S]*?)<\/script>/)![1];
  const data = JSON.parse(raw); assert.equal(Object.keys(data.diffs).length, 5);
  assert.equal(data.review.repository, review.repository);
  assert.equal(serializeEmbedded('</script>'), '"\\u003c/script>"');
});
