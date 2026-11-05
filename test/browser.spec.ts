import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { prepareReview } from '../src/review.js';
import { startServer, createDiffLoader, exportHtml } from '../src/server.js';
import type { Review } from '../src/types.js';
import { buildHierarchy, fileTrail } from '../src/treemap.js';

const repo = path.resolve(process.env.DIFFSLICE_TEST_REPO ?? '../Dev-Chestrav');
const mapPath = path.resolve(process.env.DIFFSLICE_TEST_MAP ?? '.artifacts/devchestra/graphify-out/graph.json');
const artifacts = path.resolve('.artifacts/verification');
let review: Review; let url: string; let emptyUrl: string; const servers: Server[] = []; let errors: string[] = [];
test.skip(!existsSync(mapPath) || !existsSync(path.join(repo, '.git')), 'Prepare the DevChestra Graphify map before running real-repository verification.');
test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
  review = await prepareReview({ repo, mapPath, base: '6feeff270299a528f245a91bfc37881771512ff3', head: 'cb3567798e7f31385b457d9fc13f20a1d9ea1f3a' });
  const normal = await startServer({ repo, review, assets: path.resolve('dist/viewer') }); url = normal.url; servers.push(normal.server);
  const empty = await prepareReview({ repo, mapPath, base: '5fecd6fc127cd1293f583986f0523da463b67fba', head: 'cb3567798e7f31385b457d9fc13f20a1d9ea1f3a' });
  const emptyServer = await startServer({ repo, review: empty, assets: path.resolve('dist/viewer') }); emptyUrl = emptyServer.url; servers.push(emptyServer.server);
  await exportHtml(path.resolve('.artifacts/devchestra-review.html'), review, createDiffLoader(repo, review), path.resolve('dist/viewer'));
  await exportHtml(path.resolve('.artifacts/devchestra-latest-two.html'), empty, createDiffLoader(repo, empty), path.resolve('dist/viewer'));
});
test.afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('LOC treemap takes center stage with no initially open diff, and file tree collapses', async ({ page }) => {
  await page.goto(url); await expect(page.getByTestId('map-tile').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'File diff' })).toHaveCount(0);
  const before = await page.getByTestId('treemap').boundingBox();
  expect(before!.width).toBeGreaterThan(1000); expect(before!.height).toBeGreaterThan(450);
  await expect(page.getByTestId('map-tile')).toHaveCount(review.map.modules.length + 1);
  const sizes = await page.getByTestId('map-tile').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return r.width * r.height; }));
  expect(Math.max(...sizes) / Math.min(...sizes.filter(value => value > 0))).toBeGreaterThan(20);
  await page.screenshot({ path: path.join(artifacts, 'treemap-desktop.png') });
  await page.getByRole('button', { name: 'Collapse file tree', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Changed files sidebar' })).toHaveCount(0);
  expect((await page.getByTestId('treemap').boundingBox())!.width).toBeGreaterThan(before!.width + 250);
  await page.getByRole('button', { name: 'Show file tree', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Changed files sidebar' })).toBeVisible();
});

test('logical module drill-down opens nested directory, file diff, and returns to the full map', async ({ page }) => {
  await page.goto(url); await page.getByRole('checkbox', { name: 'Changes only' }).check();
  // Community numbers and directory groupings change when a real map is rebuilt.
  const trail = fileTrail(buildHierarchy(review, 'modules'), 'apps/web/src/pages/usage/ProjectUsage.tsx')!;
  expect(trail.some(entry => entry.kind === 'module')).toBe(true);
  expect(trail.some(entry => entry.kind === 'directory')).toBe(true);
  for (const entry of trail.slice(1, -1)) {
    await page.locator(`.map-tile[data-node-id=${JSON.stringify(entry.id)}]`).click();
    await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText(entry.name);
  }
  await page.locator(`.map-tile[data-node-id=${JSON.stringify(trail.at(-1)!.id)}]`).click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322); await expect(page.locator('.code-cell.delete')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'treemap-diff.png') });
  await page.getByRole('button', { name: 'Close diff', exact: true }).click();
  await expect(page.getByRole('region', { name: 'File diff' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText(trail.at(-2)!.name);
  for (let index = trail.length - 3; index >= 0; index--) {
    await page.getByRole('button', { name: 'Go up one level', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText(trail[index].name);
  }
});

test('directory mode drills one level per click and file rectangles follow physical LOC', async ({ page }) => {
  await page.goto(url); await page.getByRole('button', { name: 'Directories', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'treemap-directories.png') });
  for (const directory of ['apps', 'web', 'src', 'pages', 'usage']) {
    await page.getByRole('button', { name: new RegExp(`^${directory}, .*open area$`) }).click();
    await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText(directory);
  }
  const large = await page.getByRole('button', { name: /^ProjectUsage.tsx, .*open file$/ }).boundingBox();
  const small = await page.getByRole('button', { name: /^shared.tsx, .*open file$/ }).boundingBox();
  const ratio = large!.width * large!.height / (small!.width * small!.height);
  const expected = review.metrics.files['apps/web/src/pages/usage/ProjectUsage.tsx'].lines / review.metrics.files['apps/web/src/pages/usage/shared.tsx'].lines;
  expect(ratio).toBeGreaterThan(expected * 0.9); expect(ratio).toBeLessThan(expected * 1.1);
  await page.screenshot({ path: path.join(artifacts, 'treemap-drilled.png') });
  await page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button', { name: review.repository, exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button')).toHaveCount(1);
});

test('right directory tree selects every real changed file with exact Git diff counts', async ({ page }) => {
  await page.goto(url);
  for (const file of review.files) {
    await page.getByRole('button', { name: `Review ${file.path}`, exact: true }).click();
    await expect(page.locator('.diff-file-title strong')).toHaveText(file.path);
    await expect(page.locator('.code-cell.add')).toHaveCount(file.additions);
    await expect(page.locator('.code-cell.delete')).toHaveCount(file.deletions);
  }
  await page.getByRole('button', { name: 'Collapse apps/web', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review apps/web/src/pages/UsagePanel.tsx', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand apps/web', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review apps/web/src/pages/UsagePanel.tsx', exact: true })).toBeVisible();
});

test('search finds a nested file; changes filter and provenance remain available', async ({ page }) => {
  await page.goto(url); const search = page.getByRole('textbox', { name: 'Search modules or files' });
  await search.fill('ProjectUsage.tsx');
  await page.locator('.search-results').getByRole('button').first().click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  await page.getByRole('button', { name: 'Close diff', exact: true }).click();
  await search.fill('a-path-that-does-not-exist'); await expect(page.getByText('No modules or files match this search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('button', { name: 'DiffSlice home', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Changes only' }).check();
  await expect(page.getByTestId('map-tile')).toHaveCount(review.totals.modules + 1);
  await page.getByRole('button', { name: 'Map details', exact: true }).click();
  await expect(page.locator('.map-info')).toContainText('revision has not been verified');
  await expect(page.locator('.map-info')).toContainText('Shared files are apportioned');
});

test('identical last two commit trees keep the entire treemap usable', async ({ page }) => {
  await page.goto(emptyUrl);
  await expect(page.locator('.no-changes-banner')).toContainText('identical trees');
  await expect(page.getByTestId('map-tile')).toHaveCount(review.map.modules.length);
  await expect(page.locator('.review-counts')).toContainText('0 changed files');
  await page.screenshot({ path: path.join(artifacts, 'treemap-empty.png') });
});

test('standalone treemap and file diffs work without network requests', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path.resolve('.artifacts/devchestra-review.html')).href);
  await expect(page.getByText('Offline snapshot', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Directories', exact: true }).click();
  await page.getByRole('button', { name: 'Review apps/web/src/pages/usage/ProjectUsage.tsx', exact: true }).click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  expect(requests).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, 'treemap-offline.png') });
});

test('mobile keeps map primary and opens a readable diff from the collapsible file tree', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url);
  await expect(page.getByTestId('map-tile').first()).toBeVisible();
  expect((await page.getByTestId('treemap').boundingBox())!.width).toBeGreaterThan(360);
  await expect(page.getByRole('region', { name: 'File diff' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'treemap-mobile.png') });
  await page.getByRole('button', { name: 'Show file tree', exact: true }).click();
  await page.getByRole('button', { name: 'Review apps/web/src/pages/usage/ProjectUsage.tsx', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Changed files sidebar' })).toHaveCount(0);
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect.poll(() => page.locator('.patch-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(400);
  expect((await page.locator('.code-cell.add').first().boundingBox())!.width).toBeGreaterThan(500);
  await page.screenshot({ path: path.join(artifacts, 'treemap-mobile-diff.png') });
});
