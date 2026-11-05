import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const run = promisify(execFile);
const project = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] ?? path.join(project, '../Dev-Chestrav'));
const output = path.join(project, '.artifacts', 'module-hook', String(Date.now()));
const repo = path.join(output, 'repo');
const cli = path.join(project, 'dist/cli.js');
const config = path.join(project, 'examples/devchestra.modules.json');
await mkdir(output, { recursive: true });
const git = (...args) => run('git', ['-C', repo, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
await run('git', ['clone', '--shared', '--quiet', source, repo], { windowsHide: true });
await git('config', 'user.name', 'DiffSlice benchmark'); await git('config', 'user.email', 'diffslice@example.invalid');
await git('config', 'core.autocrlf', 'false');
await writeFile(path.join(repo, 'diffslice.modules.json'), await readFile(config));
await git('add', 'diffslice.modules.json');
const samples = [];
async function measure(name) {
  const start = performance.now();
  const { stdout } = await run(process.execPath, [cli, 'modules', 'update', '--staged', '--repo', repo, '--json'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const wallMs = Math.round(performance.now() - start);
  const result = JSON.parse(stdout);
  const sample = { name, wallMs, ...result.stats, unassigned: result.stats.unassigned.length, ambiguous: result.stats.ambiguous.length };
  samples.push(sample); console.log(sample); return result;
}
await measure('cold initialization');
for (let i = 0; i < 5; i++) await measure(`warm unchanged ${i + 1}`);
const usage = 'apps/web/src/pages/usage/ProjectUsage.tsx';
await writeFile(path.join(repo, usage), `${await readFile(path.join(repo, usage), 'utf8')}\n// staged benchmark edit\n`);
await git('add', usage);
await measure('one staged file edit');
await mkdir(path.join(repo, 'packages/engine/src/benchmark'), { recursive: true });
for (let i = 0; i < 20; i++) await writeFile(path.join(repo, `packages/engine/src/benchmark/new-${i}.ts`), `export const value${i} = ${i};\n`);
await git('add', 'packages/engine/src/benchmark');
await measure('twenty staged additions');
const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
await writeFile(path.join(repo, '.git/hooks/pre-commit'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} modules update --staged\n`, { mode: 0o755 });
await writeFile(path.join(repo, usage), `${await readFile(path.join(repo, usage), 'utf8')}// actual hook edit\n`);
await git('add', usage);
const commitStart = performance.now();
const commit = await git('commit', '-m', 'Verify DiffSlice pre-commit hook');
const hook = { commitWallMs: Math.round(performance.now() - commitStart), stdout: commit.stdout, stderr: commit.stderr };
if (!hook.stderr.includes('DiffSlice hierarchy:')) throw new Error('The actual pre-commit hook did not execute.');
console.log(hook);
const commits = [];
await mkdir(path.join(output, 'no-hooks'), { recursive: true });
for (let i = 0; i < 3; i++) {
  for (const enabled of [false, true]) {
    const start = performance.now();
    const args = enabled ? [] : ['-c', `core.hooksPath=${path.join(output, 'no-hooks').replace(/\\/g, '/')}`];
    const result = await git(...args, 'commit', '--allow-empty', '-m', `Measure ${enabled ? 'with' : 'without'} hook ${i + 1}`);
    const sample = { hook: enabled, wallMs: Math.round(performance.now() - start), hookOutput: result.stderr };
    commits.push(sample); console.log(sample);
  }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify({ source, isolatedRepo: repo, samples, hook, commits }, null, 2));
console.log(`Results: ${path.join(output, 'results.json')}`);
