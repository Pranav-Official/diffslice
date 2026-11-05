import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { git } from '../src/git.js';
import { updateModuleIndex } from '../src/module-index.js';

test('staged hierarchy updates correctly through real pre-commit hooks and rule changes', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'diffslice-hook-'));
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.name', 'DiffSlice hook tests']);
  await git(repo, ['config', 'user.email', 'diffslice@example.invalid']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  const put = async (file: string, content: string) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), content); };
  const config = { schema: 1, exclude: ['ignored/**'], modules: [
    { id: 'app', name: 'App', include: ['src/**'], children: [{ id: 'auth', name: 'Authentication', include: ['src/auth/**'] }] },
    { id: 'conflict', name: 'Conflicting', include: ['src/clash.ts'] },
    { id: 'config', name: 'Configuration', include: ['*.json'] },
  ] };
  await put('diffslice.modules.json', JSON.stringify(config));
  await put('src/auth/login.ts', 'staged\n'); await put('src/old name.ts', 'rename me\n');
  await put('src/remove.ts', 'remove me\n'); await put('ignored/generated.ts', 'ignored\n');
  await git(repo, ['add', '.']);
  // Unborn branch and partially staged content: the index has one line, worktree two.
  await put('src/auth/login.ts', 'unstaged\nsecond\n');
  const cold = await updateModuleIndex({ repo });
  assert.equal(cold.stats.measuredBlobs, 4);
  assert.equal(cold.index.files['src/auth/login.ts'].metric.lines, 1);
  assert.equal(cold.index.files['src/auth/login.ts'].moduleId, 'auth');
  assert.equal(cold.index.modules.find(m => m.id === 'app')!.files, 3);
  assert.equal(cold.index.files['ignored/generated.ts'], undefined);
  const warm = await updateModuleIndex({ repo }); assert.equal(warm.stats.cacheHit, true); assert.equal(warm.stats.measuredBlobs, 0);
  // Install a real hook only in this disposable repository. No global configuration changes.
  const quote = (value: string) => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  const cli = path.resolve('dist/cli.js');
  await writeFile(path.join(repo, '.git/hooks/pre-commit'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} modules update --staged\n`, { mode: 0o755 });
  assert.match(await git(repo, ['commit', '-m', 'Initial with staged-only contents']), /Initial with staged-only contents/);
  assert.equal(await git(repo, ['show', 'HEAD:src/auth/login.ts']), 'staged\n');
  await git(repo, ['mv', 'src/old name.ts', 'src/new name.ts']);
  await git(repo, ['rm', 'src/remove.ts']);
  await put('src/new.ts', 'new\nline\n'); await put('unknown/new.ts', 'unassigned\n'); await put('src/clash.ts', 'ambiguous\n');
  await git(repo, ['add', 'src/auth/login.ts', 'src/new.ts', 'unknown/new.ts', 'src/clash.ts']);
  const update = await updateModuleIndex({ repo });
  assert.equal(update.stats.measuredBlobs, 4); // Modified, added, unassigned, ambiguous; rename reuses blob.
  assert.equal(update.index.files['src/old name.ts'], undefined); assert.equal(update.index.files['src/remove.ts'], undefined);
  assert.equal(update.index.files['src/new name.ts'].metric.lines, 1);
  assert.equal(update.index.files['src/auth/login.ts'].metric.lines, 2);
  assert.deepEqual(update.stats.unassigned, ['unknown/new.ts']);
  assert.deepEqual(update.stats.ambiguous[0].candidates, ['app', 'conflict']);
  await git(repo, ['commit', '-qm', 'Incremental hook update']);
  // A staged rule edit remaps files, but unstaged rule edits cannot change hook behavior.
  config.modules[0].name = 'Application'; config.modules[0].children![0].include = ['unknown/**'];
  await put('diffslice.modules.json', JSON.stringify(config)); await git(repo, ['add', 'diffslice.modules.json']);
  await put('diffslice.modules.json', 'INVALID UNSTAGED RULES');
  const remapped = await updateModuleIndex({ repo });
  assert.equal(remapped.index.files['unknown/new.ts'].moduleId, 'auth');
  assert.equal(remapped.index.files['src/auth/login.ts'].moduleId, 'app');
  assert.equal(remapped.stats.measuredBlobs, 1); // Only the changed config blob.
  await git(repo, ['commit', '-qm', 'Staged rules only']);
  const persisted = JSON.parse(await readFile(remapped.cachePath, 'utf8'));
  assert.equal(persisted.tree, (await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim());
  assert.equal(await git(repo, ['status', '--porcelain']), ' M diffslice.modules.json\n');
  await git(repo, ['mv', 'src/new name.ts', 'unknown/moved name.ts']);
  const moved = await updateModuleIndex({ repo });
  assert.equal(moved.index.files['unknown/moved name.ts'].moduleId, 'auth');
  assert.equal(moved.index.files['src/new name.ts'], undefined);
  assert.equal(moved.stats.measuredBlobs, 0);
  // An unresolved index must fail clearly rather than writing a misleading snapshot.
  const a = moved.index.files['src/auth/login.ts'].blob;
  const b = moved.index.files['unknown/new.ts'].blob;
  const conflict = path.join(repo, '.git', 'conflict-index-info');
  await writeFile(conflict, `0 ${'0'.repeat(40)}\tsrc/conflict.ts\n100644 ${a} 1\tsrc/conflict.ts\n100644 ${a} 2\tsrc/conflict.ts\n100644 ${b} 3\tsrc/conflict.ts\n`);
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', repo, 'update-index', '--index-info'], { input: await readFile(conflict), windowsHide: true });
  await assert.rejects(updateModuleIndex({ repo }), /Git failed/);
  assert.equal(JSON.parse(await readFile(moved.cachePath, 'utf8')).tree, moved.index.tree);
});
