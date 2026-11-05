import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const project = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? process.env.DIFFSLICE_TEST_REPO ?? '../Dev-Chestrav');
const output = path.join(project, '.artifacts', 'precommit-benchmark', String(Date.now()));
const repo = path.join(output, 'repo');
const root = path.join(repo, '.git/diffslice');
const execute = (command, args, options = {}) => run(command, args, { windowsHide: true, timeout: 600_000, maxBuffer: 32 * 1024 * 1024, ...options });
const git = (...args) => execute('git', ['-C', repo, ...args]);
const cli = (native, ...args) => execute(process.execPath, [path.join(project, 'dist/cli.js'), ...args, '--repo', repo, '--json'], { env: { ...process.env, DIFFSLICE_GRAPHIFY_NATIVE: native ? '1' : '0', DIFFSLICE_PROFILE_GRAPHIFY: '0' } });
await mkdir(output, { recursive: true });
await execute('git', ['clone', '--shared', '--quiet', source, repo]);
await git('config', 'user.name', 'DiffSlice benchmark'); await git('config', 'user.email', 'diffslice@example.invalid'); await git('config', 'core.autocrlf', 'false');
const install = ['init', '--install-hook'];
if (process.env.DIFFSLICE_GRAPHIFY_PYTHON) install.push('--graphify-python', path.resolve(process.env.DIFFSLICE_GRAPHIFY_PYTHON));
const setupStart = performance.now();
const installed = JSON.parse((await cli(false, ...install)).stdout);
const setupMs = Math.round(performance.now() - setupStart);
const probe = 'diffslice-benchmark-probe.ts';
await writeFile(path.join(repo, probe), 'export function diffsliceBenchmarkStaged() { return 1; }\n');
await git('add', 'diffslice.modules.json', probe);
await writeFile(path.join(repo, probe), 'export function diffsliceBenchmarkUnstaged() { return 999; }\n');
await writeFile(path.join(repo, 'diffslice-benchmark-untracked.ts'), 'export function diffsliceBenchmarkUntracked() {}\n');

// Restore only this benchmark clone's generated state. Keep its environment and
// hook config in place; all variants see identical paths, index, and native caches.
const excluded = new Set(['tools', 'precommit.json', 'precommit.lock']);
async function save(name) {
  const destination = path.join(output, name); await mkdir(destination);
  for (const entry of await readdir(root)) if (!excluded.has(entry)) await cp(path.join(root, entry), path.join(destination, entry), { recursive: true, preserveTimestamps: true });
}
async function restore(name) {
  for (const entry of await readdir(root)) if (!excluded.has(entry)) await rm(path.join(root, entry), { recursive: true, force: true });
  for (const entry of await readdir(path.join(output, name))) await cp(path.join(output, name, entry), path.join(root, entry), { recursive: true, preserveTimestamps: true });
  // Node's timestamp copy rounds nanoseconds; restore the exact staged-copy stat
  // signatures so the one-file scenario doesn't accidentally rewrite the corpus.
  await execute(installed.hook.python, ['-I', '-c', String.raw`
import json, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
state = root / 'staged-files.json'
if state.exists():
    for name, row in json.loads(state.read_text(encoding='utf-8')).items():
        file = root / 'staged-source' / name
        os.utime(file, ns=(file.stat().st_atime_ns, row['mtime']))
`, root]);
}
const results = [];
const references = new Map();
async function measure(scenario, native, repetition = 0) {
  const tree = (await git('write-tree')).stdout.trim();
  const start = performance.now();
  const invocation = await cli(native, 'hook', 'run');
  const wallMs = Math.round(performance.now() - start);
  const ready = JSON.parse(invocation.stdout);
  if (scenario === 'one-file') assert.equal(ready.materialized.written, 1, 'A one-file update must materialize exactly one blob.');
  assert.equal((await git('write-tree')).stdout.trim(), tree, 'The index changed.');
  const graph = JSON.parse(await readFile(ready.graphPath, 'utf8'));
  assert.equal(graph.diffslice_staged_tree, tree);
  const labels = graph.nodes.map(node => node.label ?? '').join('\n');
  assert.match(labels, /diffsliceBenchmarkStaged/);
  assert.doesNotMatch(labels, /diffsliceBenchmarkUnstaged|diffsliceBenchmarkUntracked/);
  const reference = references.get(scenario);
  if (reference) assert.deepEqual(graph, reference, 'Native and adapted graphs differ.');
  else references.set(scenario, graph);
  const diagnostic = ready.cached ? undefined : JSON.parse(await readFile(ready.graphifyTimingsPath, 'utf8'));
  const variant = native ? 'native' : 'adapted';
  const name = `${scenario}-${variant}-${repetition}`;
  await writeFile(path.join(output, `${name}.log`), invocation.stdout + invocation.stderr);
  const row = { scenario, variant, repetition, wallMs, cached: ready.cached, timings: ready.timings, diagnostic, materialized: ready.materialized, nodes: graph.nodes.length, edges: (graph.links ?? graph.edges).length, exactGraphEquality: true };
  results.push(row);
  console.log(`${name}: ${wallMs} ms (${row.nodes} nodes, ${row.edges} edges)`);
}

await save('before-cold');
await measure('cold', true);
await save('after-cold');
await restore('before-cold');
await measure('cold', false);
await writeFile(path.join(repo, probe), 'export function diffsliceBenchmarkStaged() { return 2; }\nexport function diffsliceBenchmarkCaller() { return diffsliceBenchmarkStaged(); }\n');
await git('add', probe);
await writeFile(path.join(repo, probe), 'export function diffsliceBenchmarkUnstaged() { return 999; }\n');
for (let repetition = 0; repetition < 2; repetition++) {
  for (const native of (repetition ? [false, true] : [true, false])) {
    await restore('after-cold');
    await measure('one-file', native, repetition);
    await measure('unchanged', native, repetition);
  }
}
const report = { source, sourceHead: (await execute('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim(), isolatedRepo: repo, platform: process.platform, node: process.version, graphifyVersion: installed.hook.version, sql: installed.hook.sql, setupMs, results };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
await cli(false, 'hook', 'uninstall');
console.log(`Equivalent native/adapted graphs and staged isolation verified. Report: ${path.join(output, 'report.json')}`);
