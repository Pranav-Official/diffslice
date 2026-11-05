import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { prepareReview } from '../src/review.js';
import { startServer, createDiffLoader, exportHtml } from '../src/server.js';
import { buildHierarchy } from '../src/treemap.js';
import type { Review } from '../src/types.js';

const repo = path.resolve(process.env.DIFFSLICE_TEST_REPO ?? '../Dev-Chestrav');
const modulesPath = path.resolve('examples/devchestra.modules.json');
const artifacts = path.resolve('.artifacts/verification');
let review: Review; let url: string; let emptyUrl: string; const servers: Server[] = []; let errors: string[] = [];
test.skip(!existsSync(path.join(repo, '.git')), 'DevChestra checkout required.');
test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
  review = await prepareReview({ repo, modulesPath, base: '6feeff270299a528f245a91bfc37881771512ff3', head: 'cb3567798e7f31385b457d9fc13f20a1d9ea1f3a' });
  const normal = await startServer({ repo, review, assets: path.resolve('dist/viewer') }); url = normal.url; servers.push(normal.server);
  const empty = await prepareReview({ repo, modulesPath, base: '5fecd6fc127cd1293f583986f0523da463b67fba', head: 'cb3567798e7f31385b457d9fc13f20a1d9ea1f3a' });
  const emptyServer = await startServer({ repo, review: empty, assets: path.resolve('dist/viewer') }); emptyUrl = emptyServer.url; servers.push(emptyServer.server);
  await exportHtml(path.resolve('.artifacts/devchestra-modules.html'), review, createDiffLoader(repo, review), path.resolve('dist/viewer'));
});
test.afterAll(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('named modules occupy the main map and nested logical areas drill into real files', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByTestId('map-tile')).toHaveCount(buildHierarchy(review, 'modules').children.length);
  await expect(page.getByRole('button', { name: /^Execution engine, .*open area$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Web application, .*open area$/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'File diff' })).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'rules-desktop.png') });
  await page.getByRole('button', { name: /^Web application, .*open area$/ }).click();
  await expect(page.getByRole('button', { name: /^Usage, .*open area$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Editor, .*open area$/ })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'rules-web.png') });
  await page.getByRole('button', { name: /^Usage, .*open area$/ }).click();
  await expect(page.getByTestId('map-tile')).toHaveCount(5);
  await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' })).toContainText('Web application');
  await page.screenshot({ path: path.join(artifacts, 'rules-usage.png') });
  await page.getByRole('button', { name: /^ProjectUsage.tsx, .*open file$/ }).click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  await page.screenshot({ path: path.join(artifacts, 'rules-diff.png') });
  await page.getByRole('button', { name: 'Close diff', exact: true }).click();
  await page.getByRole('button', { name: 'Go up one level', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText('Web application');
});

test('all changed files keep exact patches, search/filter and rules provenance', async ({ page }) => {
  await page.goto(url);
  for (const file of review.files) {
    await page.getByRole('button', { name: `Review ${file.path}`, exact: true }).click();
    await expect(page.locator('.diff-file-title strong')).toHaveText(file.path);
    await expect(page.locator('.code-cell.add')).toHaveCount(file.additions);
    await expect(page.locator('.code-cell.delete')).toHaveCount(file.deletions);
  }
  await page.getByRole('button', { name: 'Close diff', exact: true }).click();
  await page.getByRole('button', { name: 'DiffSlice home', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Changes only' }).check();
  await expect(page.getByTestId('map-tile')).toHaveCount(4);
  await page.getByRole('button', { name: /^Web application, .*open area$/ }).click();
  await expect(page.getByTestId('map-tile')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Usage, .*open area$/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Changes only' }).uncheck();
  await page.getByRole('textbox', { name: 'Search modules or files' }).fill('ProjectUsage.tsx');
  await page.locator('.search-results').getByRole('button').first().click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  await page.getByRole('button', { name: 'Map details', exact: true }).click();
  await expect(page.locator('.map-info')).toContainText('one primary module per file');
  await expect(page.locator('.map-info')).toContainText('18 files match no module rule');
  await expect(page.locator('.map-info')).not.toContainText('revision has not been verified');
  await expect(page.locator('.footer-provenance')).toHaveText('Module rules | files verified at head');
});

test('unassigned files, directory mode, sidebar collapse, and identical trees remain available', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: /^Unassigned, .*open area$/ }).click();
  await expect(page.getByRole('navigation', { name: 'Map breadcrumbs' }).getByRole('button').last()).toHaveText('Unassigned');
  await page.getByRole('button', { name: 'Directories', exact: true }).click();
  await expect(page.getByRole('button', { name: /^packages, .*open area$/ })).toBeVisible();
  const before = (await page.getByTestId('treemap').boundingBox())!.width;
  await page.getByRole('button', { name: 'Collapse file tree', exact: true }).click();
  expect((await page.getByTestId('treemap').boundingBox())!.width).toBeGreaterThan(before + 250);
  await page.goto(emptyUrl);
  await expect(page.locator('.no-changes-banner')).toContainText('identical trees');
  await expect(page.getByRole('button', { name: /^Web application, .*open area$/ })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'rules-empty.png') });
});

test('named hierarchy export is fully offline', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path.resolve('.artifacts/devchestra-modules.html')).href);
  await expect(page.getByText('Offline snapshot', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Web application, .*open area$/ }).click();
  await page.getByRole('button', { name: /^Usage, .*open area$/ }).click();
  await page.getByRole('button', { name: /^ProjectUsage.tsx, .*open file$/ }).click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322); expect(requests).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, 'rules-offline.png') });
});

test('mobile keeps named modules legible and opens populated diffs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(url);
  await expect(page.getByRole('button', { name: /^Web application, .*open area$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'rules-mobile.png') });
  await page.getByRole('button', { name: /^Web application, .*open area$/ }).click();
  await page.getByRole('button', { name: /^Usage, .*open area$/ }).click();
  await page.getByRole('button', { name: /^ProjectUsage.tsx, .*open file$/ }).click();
  await expect(page.locator('.code-cell.add')).toHaveCount(322);
  await expect.poll(() => page.locator('.patch-scroll').evaluate(element => element.scrollLeft)).toBeGreaterThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifacts, 'rules-mobile-diff.png') });
});

test('dark workbench has readable contrast and fits the supplied desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1852, height: 1191 }); await page.goto(url);
  await expect(page.getByTestId('map-tile').first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  const contrast = await page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: number[]) => color.map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    return ['.review-bar', '.search input', '.tile-header strong', '.preview-block>span', '.preview-block small', '.tree-name', '.sidebar-summary', '.hover-description small', '.app-footer'].map(selector => {
      const element = document.querySelector(selector)!; const style = getComputedStyle(element);
      let background: Element | null = element;
      while (background?.parentElement && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
      const bg = rgb(getComputedStyle(background!).backgroundColor); const fg = rgb(style.color).map((value, i) => value * Number(style.opacity) + bg[i] * (1 - Number(style.opacity)));
      const a = luminance(fg); const b = luminance(bg);
      return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  for (const sample of contrast) expect(sample.ratio, sample.selector).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Collapse file tree', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'dark-user-1852.png') });
});
