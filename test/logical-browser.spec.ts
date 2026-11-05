import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { fixture } from './helpers.js';
import { fakeAgent, sampleMap } from './logical-helpers.js';
import { renderLogicalHtml } from '../src/logical/export.js';
import { prepareReview } from '../src/review.js';
import { startServer } from '../src/server.js';

let root: string, report: string, url: string, server: Server, repo: string, fakeRoot: string;
test.beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'diffslice-logical-browser-'));
  const f = await fixture(); repo = f.root;
  const map = await sampleMap(repo, f.base, f.head);
  report = path.join(root, 'logical.html'); await writeFile(report, await renderLogicalHtml(map, path.resolve('dist/viewer')));
  const fake = await fakeAgent(); fakeRoot = fake.root;
  const review = await prepareReview({ repo, base: f.base, head: f.head, mapPath: f.mapPath, cacheDir: path.join(root, 'metrics') });
  review.logical = map;
  ({ server, url } = await startServer({ repo, review, assets: path.resolve('dist/viewer'), logicalCacheDir: path.join(root, 'cache'), agentBin: fake.filename }));
});
test.afterAll(async () => {
  if (server) await new Promise<void>(r => server.close(() => r()));
  for (const dir of [root, repo, fakeRoot]) if (dir) await rm(dir, { recursive: true, force: true });
});

test('standalone mapping works offline, selects capabilities/connections, and has no source/diff UI or network requests', async ({ page }) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); }); page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(report).href);
  await expect(page.getByRole('region', { name: 'Functional change map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modules', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'File diff' })).toHaveCount(0);
  await page.locator('[data-node="login"]').click();
  await expect(page.getByRole('heading', { name: 'Authentication response' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Functional change details' })).toContainText('Users receive the updated response');
  await expect(page.getByRole('complementary')).toContainText('inferred');
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  await expect(page.locator('[data-node="resource"]')).toContainText('Not present in this state');
  await page.getByRole('button', { name: 'After', exact: true }).click();
  await expect(page.locator('[data-edge="relation"]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Find a capability or evidence file' }).fill('resource');
  await expect(page.locator('[data-node="login"]')).toHaveCSS('opacity', '0.25');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download area SVG' }).click();
  expect((await download).suggestedFilename()).toBe('diffslice-all.svg');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('imported map reconnects to local file diffs and preserves Modules/Directories views', async ({ page }) => {
  await page.goto(url);
  await page.locator('[data-node="login"]').click();
  await page.getByRole('button', { name: 'src/auth.ts', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'File diff' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'File diff' })).toContainText('after');
  await expect(page.locator('.diff-row.evidence-target')).toHaveCount(1);
  const drawer = await page.getByRole('region', { name: 'File diff' }).boundingBox();
  expect(drawer!.height).toBeGreaterThan(100); expect(drawer!.height).toBeLessThan(818 * .5);
  await expect(page.getByRole('region', { name: 'Functional change map' })).toBeVisible();
  await page.getByRole('button', { name: 'Close diff', exact: true }).click();
  await page.getByRole('button', { name: 'Directories', exact: true }).click();
  await expect(page.getByTestId('treemap')).toBeVisible();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await expect(page.getByTestId('treemap')).toBeVisible();
  await page.getByRole('button', { name: 'Logical', exact: true }).click();
  await expect(page.locator('[data-node="login"]')).toBeVisible();
});

test('browser generation uses the selected agent and explicit action, and exports only mapping data', async ({ page }) => {
  await page.goto(url);
  const before = await readFile(path.join(fakeRoot, 'calls.jsonl'), 'utf8').catch(() => '');
  await page.getByRole('button', { name: 'Generate mapping', exact: true }).click();
  await page.getByRole('combobox', { name: 'Agent CLI' }).selectOption('pi');
  await page.getByRole('textbox', { name: 'Model ID' }).fill('fixture-model');
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled();
  expect(await readFile(path.join(fakeRoot, 'calls.jsonl'), 'utf8').catch(() => '')).toBe(before);
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.locator('[data-node="capability"]')).toBeVisible();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export HTML' }).click();
  const result = await download; const file = await result.path();
  const html = await readFile(file!, 'utf8'); expect(html).toContain('id="diffslice-logical"'); expect(html).not.toContain('export const login');
});

test('mapping remains usable at mobile width without expanding the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(pathToFileURL(report).href);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-node="login"]').click();
  await expect(page.getByRole('heading', { name: 'Authentication response' })).toBeVisible();
  await page.screenshot({ path: path.join(root, 'mobile.png') });
});
