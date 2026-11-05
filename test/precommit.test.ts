import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, chmod, realpath, copyFile, rename, rm, symlink, unlink } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { git } from '../src/git.js';
import { shellQuote } from '../src/precommit.js';
import { GRAPHIFY_UPDATE, REBASE_CACHE } from '../src/graphify-update.js';

const python = path.resolve(process.env.DIFFSLICE_GRAPHIFY_PYTHON ?? `.artifacts/graphify-tool/venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`);
const run = promisify(execFile);
const cli = (repo: string, ...args: string[]) => run(process.execPath, [path.resolve('dist/cli.js'), ...args, '--repo', repo, '--json'], { windowsHide: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });

test('project-local hooks survive reinstall and relocation, preserve originals, and serve linked worktrees', { skip: process.platform === 'win32' }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'diffslice-local hook-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let repo = path.join(temporary, "original project 'quoted'");
  await mkdir(repo);
  await git(repo, ['init', '-q']); await git(repo, ['config', 'user.name', 'DiffSlice tests']); await git(repo, ['config', 'user.email', 'diffslice@example.invalid']);
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
  await writeFile(path.join(repo, 'diffslice.modules.json'), JSON.stringify({ schema: 1, exclude: ['**/node_modules/**'], modules: [{ id: 'all', name: 'All files', include: ['**'] }] }));
  await git(repo, ['add', '.']); await git(repo, ['commit', '-qm', 'Initial']);
  const localCli = () => path.join(repo, 'node_modules/diffslice/dist/cli.js');
  const store = path.join(repo, 'node_modules/.store/diffslice-v1');
  await mkdir(path.join(store, 'dist'), { recursive: true });
  await symlink('.store/diffslice-v1', path.join(repo, 'node_modules/diffslice'));
  await writeFile(path.join(repo, 'node_modules/diffslice/package.json'), '{"type":"module","version":"0.1.0"}');
  await copyFile(path.resolve('dist/cli.js'), localCli());
  const invoke = (target: string, ...args: string[]) => run(process.execPath, [localCli(), ...args, '--repo', target, '--json'], { timeout: 30_000 });
  // Only the version probe is faked. Warm-cache hook execution below uses real Git/module caches.
  const interpreter = path.join(repo, '.git/diffslice/tools/python');
  await mkdir(path.dirname(interpreter), { recursive: true });
  await writeFile(interpreter, '#!/bin/sh\necho 0.9.102\n', { mode: 0o755 });
  const original = '#!/bin/sh\nprintf preserved >> "$(git rev-parse --git-path original.log)"\n';
  await writeFile(path.join(repo, '.git/hooks/pre-commit'), original, { mode: 0o755 });
  const installed = JSON.parse((await invoke(repo, 'hook', 'install', '--graphify-python', interpreter)).stdout);
  const managed = await readFile(installed.hookPath, 'utf8');
  assert.ok(!managed.includes(repo), 'Launcher must not capture the absolute checkout path.');
  const seed = async (target: string) => {
    const modules = JSON.parse((await invoke(target, 'modules', 'update', '--staged')).stdout);
    const status = JSON.parse((await invoke(target, 'hook', 'status')).stdout);
    const root = path.resolve(target, (await git(target, ['rev-parse', '--git-path', 'diffslice'])).trim());
    const index = JSON.parse(await readFile(path.join(root, 'modules-index-v1.json'), 'utf8'));
    const graphPath = path.join(root, 'graphify/graph.json');
    await mkdir(path.dirname(graphPath), { recursive: true });
    await writeFile(graphPath, JSON.stringify({ nodes: [], diffslice_staged_tree: modules.index.tree }));
    await writeFile(path.join(root, 'precommit-ready.json'), JSON.stringify({ tree: modules.index.tree, rulesHash: index.rulesHash, python: status.python, version: status.graphifyVersion, sql: status.sql }));
  };
  const runHook = (target: string) => run('sh', [path.join(repo, '.git/hooks/pre-commit')], { cwd: target, timeout: 30_000 });
  await seed(repo);
  assert.equal(JSON.parse((await runHook(repo)).stdout).cached, true);
  await writeFile(installed.hookPath, managed.replace(shellQuote(process.execPath), shellQuote(path.join(repo, 'missing-node'))));
  assert.equal(JSON.parse((await runHook(repo)).stdout).cached, true, 'Missing recorded Node should fall back to PATH.');
  await writeFile(installed.hookPath, managed);
  // A pnpm-style reinstall can change the physical store path while keeping the public alias.
  await unlink(path.join(repo, 'node_modules/diffslice'));
  await rename(store, path.join(repo, 'node_modules/.store/diffslice-v2'));
  await symlink('.store/diffslice-v2', path.join(repo, 'node_modules/diffslice'));
  assert.equal(JSON.parse((await runHook(repo)).stdout).cached, true);
  await rm(localCli());
  await assert.rejects(runHook(repo), /Install project dependencies/);
  await copyFile(path.resolve('dist/cli.js'), localCli());
  assert.equal(JSON.parse((await runHook(repo)).stdout).cached, true);

  const moved = path.join(temporary, "moved project 'quoted'");
  await rename(repo, moved); repo = moved;
  const status = JSON.parse((await invoke(repo, 'hook', 'status')).stdout);
  assert.equal(status.installed, true);
  assert.equal(status.python, path.join(repo, '.git/diffslice/tools/python'));
  await seed(repo);
  assert.equal(JSON.parse((await runHook(repo)).stdout).cached, true);
  assert.match(await readFile(path.join(repo, '.git/original.log'), 'utf8'), /preserved/);

  const linked = path.join(temporary, 'linked worktree');
  await git(repo, ['worktree', 'add', '--detach', linked, 'HEAD']);
  assert.equal(existsSync(path.join(linked, 'node_modules')), false);
  await seed(linked);
  assert.equal(JSON.parse((await runHook(linked)).stdout).cached, true);
  const linkedLog = path.resolve(linked, (await git(linked, ['rev-parse', '--git-path', 'original.log'])).trim());
  assert.equal(await readFile(linkedLog, 'utf8'), 'preserved');

  await writeFile(path.join(repo, '.git/hooks/pre-commit.diffslice-original'), '#!/bin/sh\nexit 23\n', { mode: 0o755 });
  await assert.rejects(runHook(repo), (error: any) => error.code === 23);
  await writeFile(path.join(repo, '.git/hooks/pre-commit.diffslice-original'), original, { mode: 0o755 });

  await writeFile(path.join(repo, '.git/hooks/pre-commit'), managed + '# user edit\n');
  await assert.rejects(invoke(repo, 'hook', 'uninstall'), /edited; left untouched/);
  await writeFile(path.join(repo, '.git/hooks/pre-commit'), managed);
  await invoke(repo, 'hook', 'uninstall');
  assert.equal(await readFile(path.join(repo, '.git/hooks/pre-commit'), 'utf8'), original);
});

test('real combined pre-commit indexes only staged code, preserves hooks, and handles incremental changes', { skip: !existsSync(python), timeout: 240_000 }, async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'diffslice-combined space-'));
  await git(repo, ['init', '-q']); await git(repo, ['config', 'user.name', 'DiffSlice tests']); await git(repo, ['config', 'user.email', 'diffslice@example.invalid']); await git(repo, ['config', 'core.autocrlf', 'false']);
  await mkdir(path.join(repo, 'src'));
  await writeFile(path.join(repo, 'src/helper.py'), 'def helper_target():\n    return 1\n');
  await writeFile(path.join(repo, 'src/api.py'), 'from helper import helper_target\ndef staged_only():\n    return helper_target()\n');
  await writeFile(path.join(repo, 'src/remove.py'), 'def removed_later():\n    return 1\n');
  await writeFile(path.join(repo, 'src/schema.sql'), 'CREATE TABLE diffslice_sql_probe (id INTEGER PRIMARY KEY);\n');
  const original = '#!/bin/sh\nprintf existing-hook-ran >> "$(git rev-parse --git-path existing-hook.log)"\nexit 0\n';
  await writeFile(path.join(repo, '.git/hooks/pre-commit'), original, { mode: 0o755 }); await chmod(path.join(repo, '.git/hooks/pre-commit'), 0o755);
  const initialized = JSON.parse((await cli(repo, 'init', '--install-hook', '--graphify-python', python)).stdout);
  assert.equal(initialized.hook.status, 'installed');
  assert.equal(await readFile(path.join(repo, '.git/hooks/pre-commit.diffslice-original'), 'utf8'), original);
  const installAgain = JSON.parse((await cli(repo, 'hook', 'install', '--graphify-python', python)).stdout); assert.equal(installAgain.status, 'updated');
  await git(repo, ['add', 'src']);
  await assert.rejects(git(repo, ['commit', '-qm', 'Rules must be staged first'], 180_000), /Stage diffslice.modules.json/);
  await git(repo, ['add', 'src', 'diffslice.modules.json']);
  const stagedTree = (await git(repo, ['write-tree'])).trim();
  await writeFile(path.join(repo, 'src/api.py'), 'from helper import helper_target\ndef unstaged_only():\n    return helper_target() + 2\n');
  await writeFile(path.join(repo, 'untracked.py'), 'def untracked_only():\n    return 9\n');
  const start = performance.now();
  await git(repo, ['commit', '-qm', 'Combined first commit'], 180_000);
  const statePath = path.join(repo, '.git/diffslice/precommit-ready.json');
  let ready = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(ready.tree, stagedTree); assert.equal((await git(repo, ['rev-parse', 'HEAD^{tree}'])).trim(), stagedTree);
  const graph = JSON.parse(await readFile(ready.graphPath, 'utf8'));
  const labels = graph.nodes.map((node: any) => node.label ?? '').join('\n');
  assert.match(labels, /\bstaged_only\b/); assert.doesNotMatch(labels, /\bunstaged_only\b|\buntracked_only\b/);
  assert.equal(graph.diffslice_staged_tree, stagedTree);
  assert.equal(await readFile(path.join(repo, 'src/api.py'), 'utf8'), 'from helper import helper_target\ndef unstaged_only():\n    return helper_target() + 2\n');
  for (const value of Object.values(ready.timings)) assert.ok(typeof value === 'number' && value >= 0);
  const diagnostic = JSON.parse(await readFile(ready.graphifyTimingsPath, 'utf8'));
  assert.equal(diagnostic.profiled, false);
  if (diagnostic.version === '0.9.102') {
    assert.ok(diagnostic.stages.clusterMs > 0, 'Native clustering must still run.');
    assert.equal(diagnostic.rebaseCache.enabled, true);
  }
  if (ready.sql) assert.ok(graph.nodes.some((node: any) => node.source_file === 'src/schema.sql' && node.label.includes('diffslice_sql_probe')), 'Installed SQL parser must contribute SQL symbols.');
  assert.match(await readFile(path.join(repo, '.git/existing-hook.log'), 'utf8'), /existing-hook-ran/);
  assert.equal(JSON.parse(await readFile(path.join(repo, '.git/diffslice/modules-index-v1.json'), 'utf8')).tree, stagedTree);
  assert.equal(JSON.parse((await cli(repo, 'hook', 'run')).stdout).cached, true);
  // Default Git hooks are shared across linked worktrees; caches must stay separate.
  const linked = await mkdtemp(path.join(os.tmpdir(), 'diffslice-linked-'));
  await git(repo, ['worktree', 'add', '--detach', linked, 'HEAD']);
  await writeFile(path.join(linked, 'src/linked.py'), 'def linked_only():\n    return 4\n');
  await git(linked, ['add', 'src/linked.py']); await git(linked, ['commit', '-qm', 'Linked worktree commit'], 180_000);
  const linkedCache = path.resolve(linked, (await git(linked, ['rev-parse', '--git-path', 'diffslice'])).trim());
  const linkedReady = JSON.parse(await readFile(path.join(linkedCache, 'precommit-ready.json'), 'utf8'));
  assert.equal(linkedReady.tree, (await git(linked, ['rev-parse', 'HEAD^{tree}'])).trim());
  assert.notEqual(linkedReady.tree, stagedTree);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).tree, stagedTree);
  // A staged rename/delete/change updates the persistent private snapshot and graph.
  await git(repo, ['mv', 'src/api.py', 'src/renamed api.py']); await git(repo, ['rm', 'src/remove.py']);
  await git(repo, ['add', 'src/renamed api.py']);
  await git(repo, ['commit', '-qm', 'Incremental combined update'], 180_000);
  ready = JSON.parse(await readFile(statePath, 'utf8'));
  const nextGraph = JSON.parse(await readFile(ready.graphPath, 'utf8'));
  const nextLabels = nextGraph.nodes.map((node: any) => node.label ?? '').join('\n');
  assert.match(nextLabels, /\bunstaged_only\b/); assert.doesNotMatch(nextLabels, /\bstaged_only\b|\bremoved_later\b/);
  const nodes = new Map(nextGraph.nodes.map((node: any) => [node.id, node]));
  assert.ok(nextGraph.links.some((edge: any) => edge.relation === 'calls' && (nodes.get(edge.source) as any)?.label.includes('unstaged_only') && (nodes.get(edge.target) as any)?.label.includes('helper_target')), 'Changed source must retain its call to an unchanged helper.');
  assert.equal(ready.materialized.removed, 2); assert.equal(ready.materialized.written, 1);
  assert.equal(existsSync(path.join(repo, '.git/diffslice/staged-source/src/remove.py')), false);
  // Missing runtime makes commit fail, without advancing HEAD or the ready marker.
  const savedHead = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const configuration = path.join(repo, '.git/diffslice/precommit.json'); const saved = JSON.parse(await readFile(configuration, 'utf8'));
  await writeFile(configuration, JSON.stringify({ ...saved, python: path.join(repo, 'missing-python') }));
  await writeFile(path.join(repo, 'src/new.py'), 'def new_function():\n    return 3\n'); await git(repo, ['add', 'src/new.py']);
  await assert.rejects(git(repo, ['commit', '-qm', 'Must fail'], 180_000));
  assert.equal((await git(repo, ['rev-parse', 'HEAD'])).trim(), savedHead);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).tree, ready.tree);
  await writeFile(configuration, JSON.stringify(saved));
  // A parser added during hook installation must invalidate a ready marker even
  // when version, interpreter, rules, and staged tree otherwise match.
  await git(repo, ['reset', '-q', 'HEAD', '--', 'src/new.py']);
  await writeFile(statePath, JSON.stringify({ ...ready, sql: !saved.sql }));
  const profiled = JSON.parse((await run(process.execPath, [path.resolve('dist/cli.js'), 'hook', 'run', '--repo', repo, '--json'], { env: { ...process.env, DIFFSLICE_PROFILE_GRAPHIFY: '1' }, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })).stdout);
  assert.equal(profiled.cached, false);
  assert.ok((await readFile(profiled.graphifyProfilePath)).length > 0);
  assert.equal(JSON.parse(await readFile(profiled.graphifyTimingsPath, 'utf8')).profiled, true);
  const publishedBeforeRace = await readFile(ready.graphPath, 'utf8');
  const markerBeforeRace = await readFile(statePath, 'utf8');
  await git(repo, ['add', 'src/new.py']);
  const child = spawn(process.execPath, [path.resolve('dist/cli.js'), 'hook', 'run', '--repo', repo, '--json'], { windowsHide: true });
  child.stdout.resume();
  let stderr = ''; let mutation: Promise<unknown> | undefined;
  child.stderr.on('data', chunk => {
    stderr += chunk;
    if (!mutation && stderr.includes('updating Graphify')) mutation = (async () => {
      await writeFile(path.join(repo, 'src/raced.py'), 'def raced_index():\n    return 8\n');
      await git(repo, ['add', 'src/raced.py']);
    })();
  });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.ok(mutation); await mutation;
  assert.notEqual(code, 0);
  assert.match(stderr, /Git index changed/);
  assert.equal(await readFile(ready.graphPath, 'utf8'), publishedBeforeRace);
  assert.equal(await readFile(statePath, 'utf8'), markerBeforeRace);
  assert.equal(JSON.parse((await cli(repo, 'hook', 'status')).stdout).installed, true);
  await cli(repo, 'hook', 'uninstall');
  assert.equal(await readFile(path.join(repo, '.git/hooks/pre-commit'), 'utf8'), original);
  assert.equal(JSON.parse((await cli(repo, 'hook', 'status')).stdout).installed, false);
  console.log(`Combined real Graphify lifecycle verified in ${Math.round(performance.now() - start)} ms; fixture: ${repo}`);
});

test('rebase memoization delegates native path semantics and stays isolated to each resolver', { skip: !existsSync(python) }, async () => {
  await run(python, ['-I', '-c', REBASE_CACHE + String.raw`
import copy, pathlib, tempfile
from graphify.watch import _StoredSourcePaths
from graphify.build import _norm_source_file
with tempfile.TemporaryDirectory(prefix='diffslice-rebase-') as temporary:
    base = pathlib.Path(temporary)
    project, other = base / 'project with spaces', base / 'other'
    project.mkdir(); other.mkdir()
    (project / 'src').mkdir()
    (project / 'src' / 'file.py').write_text('pass')
    def resolver(root):
        return _StoredSourcePaths({}, out=root, project_root=root, watch_root=root, normalize_source=_norm_source_file)
    sources = ['src/file.py', './src/../src/file.py', str(project / 'src/file.py'), str(other / 'missing.py'), '../other/missing.py', '', None, 'gdoc://virtual/source']
    inputs = [{'source_file': source, 'label': 'unchanged metadata'} for source in sources] + [{'label': 'no source'}]
    native = _StoredSourcePaths.rebase_preserved
    expected = []
    for root in (project, other):
        rows = copy.deepcopy(inputs)
        for row in rows:
            native(resolver(root), row)
        expected.append(rows)
    counters = {'hits': 0, 'misses': 0}
    install_rebase_cache(_StoredSourcePaths, counters)
    for root, reference in zip((project, other), expected):
        instance = resolver(root)
        for _ in range(2):
            rows = copy.deepcopy(inputs)
            for row in rows:
                instance.rebase_preserved(row)
            assert rows == reference, (rows, reference)
    assert counters['hits'] > 0 and counters['misses'] > 0, counters
`], { timeout: 30_000 });
});

test('unknown Graphify versions dispatch natively without touching pinned private APIs', { skip: !existsSync(python) }, async () => {
  await run(python, ['-I', '-c', String.raw`
import importlib.metadata, io, json, pathlib, shutil, sys, tempfile, types
root = pathlib.Path(tempfile.mkdtemp(prefix='diffslice-native-fallback-'))
try:
    package = types.ModuleType('graphify')
    package.__path__ = []
    entry = types.ModuleType('graphify.__main__')
    calls = []
    entry.main = lambda: calls.append(list(sys.argv))
    sys.modules['graphify'] = package
    sys.modules['graphify.__main__'] = entry
    importlib.metadata.version = lambda name: '9.0.0'
    sys.stdin = io.StringIO(json.dumps({'snapshot': str(root), 'timings': str(root / 'timings.json')}))
    exec(${JSON.stringify(GRAPHIFY_UPDATE)})
    assert calls == [['graphify', 'update', str(root)]], calls
    assert 'graphify.watch' not in sys.modules
    report = json.loads((root / 'timings.json').read_text())
    assert report['rebaseCache']['enabled'] is False
finally:
    shutil.rmtree(root)
`], { timeout: 30_000 });
});

test('Husky dispatcher remains untouched and edited managed hooks are protected', { skip: !existsSync(python), timeout: 60_000 }, async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'diffslice-husky-'));
  await git(repo, ['init', '-q']); await git(repo, ['config', 'core.hooksPath', '.husky/_']);
  await mkdir(path.join(repo, '.husky/_'), { recursive: true });
  const dispatcher = '#!/bin/sh\n. "$(dirname "$0")/../pre-commit"\n';
  const original = '#!/bin/sh\nexit 0\n';
  await writeFile(path.join(repo, '.husky/_/pre-commit'), dispatcher);
  await writeFile(path.join(repo, '.husky/pre-commit'), original);
  await writeFile(path.join(repo, 'diffslice.modules.json'), JSON.stringify({ schema: 1, modules: [{ id: 'src', name: 'Source', include: ['**'] }] }));
  const installed = JSON.parse((await cli(repo, 'hook', 'install', '--graphify-python', python)).stdout);
  assert.equal(await realpath(installed.hookPath), await realpath(path.join(repo, '.husky/pre-commit')));
  assert.equal(await readFile(path.join(repo, '.husky/_/pre-commit'), 'utf8'), dispatcher);
  const managed = await readFile(installed.hookPath, 'utf8');
  await writeFile(installed.hookPath, managed + '# user modification\n');
  await assert.rejects(cli(repo, 'hook', 'uninstall'), /edited; left untouched/);
  assert.equal(await readFile(installed.hookPath, 'utf8'), managed + '# user modification\n');
  await writeFile(installed.hookPath, managed);
  await cli(repo, 'hook', 'uninstall');
  assert.equal(await readFile(installed.hookPath, 'utf8'), original);
  assert.equal(await readFile(path.join(repo, '.husky/_/pre-commit'), 'utf8'), dispatcher);
});
