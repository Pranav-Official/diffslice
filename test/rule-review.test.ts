import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture } from './helpers.js';
import { git } from '../src/git.js';
import { prepareReview } from '../src/review.js';
import { buildHierarchy, collectNodes } from '../src/treemap.js';
import { updateModuleIndex } from '../src/module-index.js';

test('rules drive historical reviews and nested treemaps without a Graphify map', async () => {
  const f = await fixture();
  const config = { schema: 1, exclude: ['binary.bin'], modules: [
    { id: 'app', name: 'Application', include: ['src/**'], children: [
      { id: 'auth', name: 'Authentication', include: ['src/auth.ts', 'removed.ts'] },
      { id: 'utils', name: 'Utilities', include: ['src/rename new.ts'] },
    ] },
    { id: 'old', name: 'Legacy', include: ['src/rename old.ts'] },
    { id: 'meta', name: 'Repository settings', include: ['*.json'] },
  ] };
  const modulesPath = path.join(f.root, 'diffslice.modules.json');
  await f.put('diffslice.modules.json', JSON.stringify(config));
  await git(f.root, ['add', 'diffslice.modules.json']); await git(f.root, ['commit', '-qm', 'Add hierarchy']);
  const head = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  const headIndex = await updateModuleIndex({ repo: f.root });
  // Working/staged files are deliberately ahead of the requested revision.
  await f.put('src/auth.ts', 'not in selected head\nsecond\nthird\n'); await git(f.root, ['add', 'src/auth.ts']);
  await f.put('diffslice.modules.json', 'INVALID UNSTAGED RULES');
  const options = { repo: f.root, modulesPath, base: f.base, head, cacheDir: path.join(f.root, '.review-cache') };
  const review = await prepareReview(options);
  assert.equal(review.map.provenance.kind, 'rules'); assert.equal(review.map.provenance.revisionVerified, true);
  assert.equal(review.files.length, 6);
  assert.equal(review.metrics.files['src/auth.ts'].lines, 1);
  assert.equal(review.metrics.files['removed.ts'].lines, 1);
  assert.deepEqual(review.files.find(file => file.status === 'renamed')!.moduleIds, ['utils']);
  assert.deepEqual(review.map.files['removed.ts'], ['auth']);
  assert.equal(review.map.files['src/rename old.ts'], undefined);
  assert.deepEqual(review.map.files['binary.bin'], ['diffslice-excluded']);
  assert.deepEqual(review.map.files['new file.ts'], ['unassigned']);
  const tree = buildHierarchy(review, 'modules');
  assert.equal(tree.children.some(module => module.name === 'Legacy'), false);
  const app = tree.children.find(module => module.moduleId === 'app')!;
  assert.deepEqual(new Set(app.children.map(child => child.name)), new Set(['Authentication', 'Utilities']));
  assert.equal(app.changed, 3); // Auth + removed + rename, each once.
  const leaves = collectNodes(tree).filter(node => node.kind === 'file');
  assert.equal(leaves.length, new Set(leaves.map(node => node.path)).size);
  assert.equal(tree.loc, review.metrics.totalLines); assert.equal(tree.changed, 6);
  assert.equal(tree.additions, review.totals.additions); assert.equal(tree.deletions, review.totals.deletions);
  const warm = await prepareReview(options); assert.equal(warm.timings.mapCacheHit, true); assert.equal(warm.metrics.cacheHit, true);
  const automatic = await prepareReview({ ...options, modulesPath: undefined });
  assert.equal(automatic.map.provenance.kind, 'rules');
  const directories = buildHierarchy(review, 'directories'); assert.equal(directories.loc, tree.loc);
  const { readFile } = await import('node:fs/promises');
  assert.equal(JSON.parse(await readFile(headIndex.cachePath, 'utf8')).tree, headIndex.index.tree); // Comparison preserves hook cache.
});
