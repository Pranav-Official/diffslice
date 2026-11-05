import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { git } from '../src/git.js';
import { initializeModules } from '../src/init.js';
import { assignModule, compileModuleRules } from '../src/module-index.js';
import { fixture } from './helpers.js';

const run = promisify(execFile);
const cli = (repo: string, ...args: string[]) => run(process.execPath, [path.resolve('dist/cli.js'), ...args, '--repo', repo], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
async function emptyRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'diffslice-init-'));
  await git(repo, ['init', '-q']); await git(repo, ['config', 'core.autocrlf', 'false']);
  const put = async (file: string, text: string) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), text); };
  return { repo, put };
}

test('init detects polyglot projects, nested source areas, exclusions, and preserves existing rules', async () => {
  const { repo, put } = await emptyRepo();
  const entries: Record<string, string> = {
    'package.json': '{"name":"workspace","workspaces":["apps/*","services/*"]}',
    '.gitignore': 'ignored/\n',
    'apps/web/package.json': '{"name":"@example/web"}',
    'apps/web/src/editor/model.ts': 'export {};\n', 'apps/web/src/editor/view.ts': 'export {};\n',
    'apps/web/src/pages/usage/index.tsx': 'export {};\n', 'apps/web/src/pages/usage/shared.tsx': 'export {};\n',
    'apps/web/test/first.ts': '// test\n', 'apps/web/test/second.ts': '// test\n',
    'crates/engine/Cargo.toml': '[package]\nname = "engine"\nversion = "0.1.0"\n',
    'crates/engine/src/planner/plan.rs': 'fn plan() {}\n', 'crates/engine/src/planner/types.rs': 'struct Plan;\n',
    'services/api/pyproject.toml': '[project]\nname = "identity-api"\n',
    'services/api/src/auth/login.py': 'pass\n', 'services/api/src/auth/session.py': 'pass\n',
    'services/gateway/go.mod': 'module example.com/gateway\n', 'services/gateway/main.go': 'package main\n',
    'dotnet/Agent/Agent.csproj': '<Project />', 'dotnet/Agent/Program.cs': 'class Agent {}\n',
    'setup.py': 'raise RuntimeError("Initialization must never execute this")\n',
    'Feature One/first.ts': '// one\n', 'Feature One/second.ts': '// two\n',
    'ignored/private.ts': 'must not be scanned\n',
    '.agents/skills/tool/SKILL.md': 'tooling noise\n',
    'apps/web/dist/bundle.js': 'generated output\n',
  };
  for (const [file, text] of Object.entries(entries)) await put(file, text);
  await git(repo, ['add', '.']);
  await put('removed.ts', '// removed\n'); await git(repo, ['add', 'removed.ts']);
  const { unlink } = await import('node:fs/promises'); await unlink(path.join(repo, 'removed.ts'));
  const preview = await initializeModules({ repo, dryRun: true });
  assert.equal(preview.status, 'dry-run'); await assert.rejects(access(preview.output));
  assert.deepEqual(preview.unassigned, []); assert.deepEqual(preview.ambiguous, []);
  assert.equal(preview.stats.detectedProjects, 7); // root JS, web, Rust, Python, Go, .NET, setup.py.
  const compiled = compileModuleRules(preview.config);
  const rule = (file: string) => compiled.rules.find(rule => rule.id === assignModule(compiled.rules, file).moduleId)!;
  assert.equal(rule('apps/web/src/editor/model.ts').name, 'Editor');
  assert.equal(rule('apps/web/src/pages/usage/shared.tsx').name, 'Usage');
  assert.equal(rule('crates/engine/src/planner/plan.rs').name, 'Planner');
  assert.equal(rule('services/api/src/auth/session.py').name, 'Auth');
  assert.equal(rule('services/gateway/main.go').name, 'Gateway');
  assert.equal(rule('dotnet/Agent/Program.cs').name, 'Agent');
  assert.equal(rule('Feature One/first.ts').name, 'Feature One');
  assert.equal(compiled.rules.some(rule => rule.patterns.some(pattern => pattern.test('removed.ts')) && rule.name !== 'Repository files'), false);
  assert.equal(preview.stats.excludedFiles, 2);
  assert.equal(preview.stats.discoveredFiles, Object.keys(entries).length - 1); // Git-ignored file absent, deleted file absent.
  const created = await initializeModules({ repo }); assert.equal(created.status, 'created');
  assert.deepEqual(created.config, preview.config); // deterministic generation.
  const web = created.config.modules.find(module => module.name === 'Web application')!;
  assert.match(web.description!, /apps\/web\/package.json/);
  const custom = { schema: 1, modules: [{ id: 'mine', name: 'My architecture', include: ['apps/web/**'] }] };
  const exact = `\n${JSON.stringify(custom, null, 4)}\n\n`;
  await put('diffslice.modules.json', exact);
  const existing = await initializeModules({ repo });
  assert.equal(existing.status, 'existing'); assert.equal(await readFile(existing.output, 'utf8'), exact);
  assert.ok(existing.unassigned.includes('services/gateway/main.go'));
  await put('diffslice.modules.json', 'null');
  await assert.rejects(initializeModules({ repo }), /Cannot read existing module rules/);
  assert.equal(await readFile(existing.output, 'utf8'), 'null');
});

test('CLI init supports immediate historical comparison with local rules, then committed rules', async () => {
  const f = await fixture();
  const before = await git(f.root, ['status', '--porcelain']);
  const dry = JSON.parse((await cli(f.root, 'init', '--dry-run', '--json')).stdout);
  assert.equal(dry.status, 'dry-run'); assert.equal(await git(f.root, ['status', '--porcelain']), before);
  const created = JSON.parse((await cli(f.root, 'init', '--json')).stdout);
  assert.equal(created.status, 'created');
  assert.equal(created.cache.status, 'ready');
  await f.put('src/auth.ts', 'unstaged contents\nextra line\n');
  await f.put('src/untracked.ts', '// untracked\n');
  const comparison = JSON.parse((await cli(f.root, 'compare', f.base, f.head, '--json')).stdout);
  assert.equal(comparison.map.provenance.kind, 'rules');
  assert.equal(comparison.map.provenance.rulesSource, 'local');
  assert.equal(comparison.timings.mapCacheHit, true);
  assert.equal(comparison.metrics.files['src/auth.ts'].lines, 1);
  assert.equal(comparison.map.files['src/untracked.ts'], undefined);
  assert.equal(comparison.files.length, 5);
  assert.ok(comparison.warnings.some((warning: string) => warning.includes('local configuration')));
  await git(f.root, ['add', 'diffslice.modules.json']); await git(f.root, ['commit', '-qm', 'Keep module rules']);
  const head = (await git(f.root, ['rev-parse', 'HEAD'])).trim();
  await f.put('diffslice.modules.json', 'INVALID UNSTAGED RULES');
  const committed = JSON.parse((await cli(f.root, 'compare', f.base, head, '--json')).stdout);
  assert.equal(committed.map.provenance.rulesSource, 'head');
  const fallback = JSON.parse((await cli(f.root, 'compare', f.base, f.head, '--map', f.mapPath, '--json')).stdout);
  assert.notEqual(fallback.map.provenance.kind, 'rules');
  await assert.rejects(cli(f.root, 'compare', f.base, f.head, '--dry-run'), /--dry-run is only supported/);
  await assert.rejects(cli(f.root, 'init', 'extra'), /Usage: diffslice init/);
});
