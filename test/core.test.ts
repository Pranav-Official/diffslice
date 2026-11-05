import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { normalizeGraph, normalizeSource } from '../src/graphify.js';
import { parsePrUrl, resolveCommit } from '../src/git.js';
import { prepareReview } from '../src/review.js';
import { loadDiff, parseDiff } from '../src/patch.js';
import { buildHierarchy, buildChangedTree, collectNodes } from '../src/treemap.js';

test('Graphify adapter preserves multi-community membership and accepts edge aliases', () => {
  const graph = normalizeGraph({ nodes: [
    { id: 'a', source_file: 'src\\auth.ts', community: 1 },
    { id: 'b', source_file: 'src/auth.ts', community: 2, community_name: 'Identity' },
    { id: 'c', source_file: '../escape.ts', community: 3 },
  ], edges: [{ source: 'a', target: 'b' }] }, 'D:/repo', '/graph.json', '', 'fingerprint');
  assert.deepEqual(graph.files['src/auth.ts'], ['community:1', 'community:2']);
  assert.equal(graph.modules.length, 2); assert.equal(graph.links[0].count, 1);
  assert.equal(graph.provenance.revisionVerified, false);
  assert.equal(normalizeSource('D:\\repo\\src\\a.ts', 'D:/repo'), 'src/a.ts');
  assert.equal(normalizeSource('D:/outside/a.ts', 'D:/repo'), null);
  assert.throws(() => normalizeGraph({}, '', '', '', ''), /nodes array/);
});

test('real Git comparison handles additions, deletions, renames, binaries and cache', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const options = { repo: f.root, base: f.base, head: f.head, mapPath: f.mapPath, cacheDir: path.join(f.root, '.cache') };
  const review = await prepareReview(options);
  assert.equal(review.files.length, 5);
  assert.deepEqual(new Set(review.files.map(file => file.status)), new Set(['added', 'modified', 'deleted', 'renamed']));
  const rename = review.files.find(file => file.status === 'renamed')!;
  assert.equal(rename.oldPath, 'src/rename old.ts'); assert.equal(rename.path, 'src/rename new.ts');
  assert.deepEqual(rename.moduleIds, ['community:2']);
  assert.equal(review.totals.additions, 2); assert.equal(review.totals.deletions, 2);
  assert.equal(review.totals.unmapped, 2);
  assert.equal(review.metrics.files['src/auth.ts'].lines, 1);
  assert.equal(review.metrics.files['removed.ts'].lines, 1);
  assert.equal(review.metrics.files['src/rename new.ts'].lines, 1);
  assert.equal(Object.hasOwn(review.metrics.files, 'src/rename old.ts'), false);
  assert.equal(review.metrics.files['binary.bin'].binary, true);
  assert.equal(review.metrics.files['binary.bin'].lines, 0);
  assert.equal(review.timings.mapCacheHit, false);
  const warm = await prepareReview(options);
  assert.equal(warm.timings.mapCacheHit, true); assert.equal(warm.metrics.cacheHit, true);
  const directories = buildHierarchy(review, 'directories');
  const leaves = collectNodes(directories).filter(node => node.kind === 'file');
  assert.equal(leaves.length, 5);
  assert.equal(new Set(leaves.map(node => node.path)).size, 5);
  assert.equal(directories.changed, 5);
  assert.equal(directories.loc, review.metrics.totalLines);
  assert.equal(collectNodes(buildChangedTree(review)).filter(node => node.kind === 'file').length, 5);
  // Shared membership gets a proportional area share without double-counting source.
  const modules = buildHierarchy(review, 'modules');
  assert.equal(modules.area, directories.area);
  const auth = review.files.find(file => file.path === 'src/auth.ts')!;
  const diff = await loadDiff(f.root, review, auth.id);
  const row = diff.hunks[0].rows.find(row => row.old?.kind === 'delete')!;
  assert.match(row.old!.text, /before/); assert.match(row.new!.text, /after/);
  assert.equal((await loadDiff(f.root, review, rename.id)).hunks.length, 0);
  assert.equal((await loadDiff(f.root, review, review.files.find(file => file.binary)!.id)).binary, true);
  const added = await loadDiff(f.root, review, review.files.find(file => file.status === 'added')!.id);
  assert.equal(added.hunks[0].rows[0].old, undefined); assert.match(added.hunks[0].rows[0].new!.text, /<script>/);
  assert.equal((await prepareReview({ ...options, base: f.head })).totals.files, 0);
  await assert.rejects(resolveCommit(f.root, '--help'), /Git failed/);
});

test('diff alignment keeps context and unequal change blocks correctly numbered', () => {
  const patch = '--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,4 @@\n same\n-old\n+new\n+extra\n end\n';
  const rows = parseDiff(patch)[0].rows;
  assert.equal(rows.length, 4); assert.equal(rows[1].old?.line, 2); assert.equal(rows[1].new?.line, 2);
  assert.equal(rows[2].old, undefined); assert.equal(rows[2].new?.line, 3); assert.equal(rows[3].old?.line, 3); assert.equal(rows[3].new?.line, 4);
});

test('PR inputs are validated before calling gh', () => {
  assert.deepEqual(parsePrUrl('https://github.com/org/repo/pull/25'), { owner: 'org', name: 'repo', number: 25 });
  for (const value of ['https://evil.test/a/b/pull/1', 'file:///a/b/pull/1', 'https://github.com/a/b/issues/1', '--help']) assert.throws(() => parsePrUrl(value), /GitHub PR URL/);
});
