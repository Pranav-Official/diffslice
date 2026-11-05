import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const run = promisify(execFile);
const project = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? path.join(project, '../Dev-Chestrav'));
const output = path.join(project, '.artifacts', 'init', String(Date.now()));
const repo = path.join(output, 'repo');
const cli = path.join(project, 'dist/cli.js');
await mkdir(output, { recursive: true });
await run('git', ['clone', '--shared', '--quiet', source, repo], { windowsHide: true });
const invoke = async (...args) => {
  const start = performance.now();
  const result = await run(process.execPath, [cli, ...args, '--repo', repo], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { ...result, wallMs: Math.round(performance.now() - start) };
};
const previewCall = await invoke('init', '--dry-run', '--json'); const preview = JSON.parse(previewCall.stdout);
assert.equal(preview.status, 'dry-run');
await assert.rejects(access(path.join(repo, 'diffslice.modules.json')));
const createCall = await invoke('init', '--json'); const created = JSON.parse(createCall.stdout);
assert.equal(created.status, 'created');
assert.equal(created.cache.status, 'ready');
assert.deepEqual(created.unassigned, []); assert.deepEqual(created.ambiguous, []);
const exact = await readFile(created.output, 'utf8');
const repeatCall = await invoke('init', '--json'); assert.equal(JSON.parse(repeatCall.stdout).status, 'existing');
assert.equal(await readFile(created.output, 'utf8'), exact);
const compareCall = await invoke('compare', 'HEAD~1', 'HEAD', '--json'); const review = JSON.parse(compareCall.stdout);
assert.equal(review.map.provenance.kind, 'rules'); assert.equal(review.map.provenance.rulesSource, 'local');
assert.equal(review.timings.mapCacheHit, true);
assert.equal(review.totals.unmapped, 0);
const html = path.join(output, 'review.html');
await invoke('compare', 'HEAD~1', 'HEAD', '--export', html, '--no-open');
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1488, height: 900 } });
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(html).href);
  await page.getByTestId('map-tile').first().waitFor();
  await page.screenshot({ path: path.join(output, 'viewer.png') });
  if (review.files.length) {
    const file = review.files.find(file => !file.binary) ?? review.files[0];
    await page.getByRole('button', { name: `Review ${file.path}`, exact: true }).click();
    await page.getByRole('region', { name: 'File diff' }).waitFor();
    // Wait for the embedded patch, then verify all rendered changed lines.
    await page.waitForFunction(({ added, deleted }) => document.querySelectorAll('.code-cell.add').length === added && document.querySelectorAll('.code-cell.delete').length === deleted, { added: file.additions, deleted: file.deletions });
    await page.screenshot({ path: path.join(output, 'diff.png') });
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
} finally { await browser.close(); }
const summary = {
  source, isolatedRepo: repo, rules: created.output,
  initialization: { ...created.stats, topLevelGroups: created.groups.length, unassigned: created.unassigned.length, ambiguous: created.ambiguous.length },
  wallMs: { preview: previewCall.wallMs, create: createCall.wallMs, repeat: repeatCall.wallMs, compare: compareCall.wallMs },
  comparison: review.totals, rulesSource: review.map.provenance.rulesSource,
  preparedCache: created.cache, comparisonUsedCache: review.timings.mapCacheHit,
  browser: { offline: true, errors: 0, mapAndDiffVerified: true },
};
await writeFile(path.join(output, 'report.json'), JSON.stringify(summary, null, 2));
await writeFile(path.join(output, 'init.json'), JSON.stringify(created, null, 2));
await writeFile(path.join(output, 'review.json'), JSON.stringify(review, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Verified report: ${path.join(output, 'report.json')}`);
