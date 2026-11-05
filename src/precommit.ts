import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './git.js';
import { compileModuleRules, updateModuleIndex } from './module-index.js';
import { STAGED_COPY } from './staged-copy.js';
import { GRAPHIFY_UPDATE } from './graphify-update.js';

const run = promisify(execFile);
const MARKER = '# diffslice-managed-pre-commit-v1';
const VERSION = '0.9.102';
interface HookConfig { schema: 1; repo: string; root?: string; relativeRepo?: string; python: string; version: string; sql?: boolean; modulesPath: string; hookPath: string; original?: string; originalMode?: number; originalActive?: boolean; wrapper: string }
export const shellQuote = (value: string) => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
const configPath = (root: string) => path.join(root, 'precommit.json');
async function privateRoot(repo: string) { return path.resolve(repo, (await git(repo, ['rev-parse', '--git-path', 'diffslice'])).trim()); }
async function managementRoot(repo: string) { return path.resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim(), 'diffslice'); }
async function atomicWrite(filename: string, value: string) { const temporary = `${filename}.${randomUUID()}.tmp`; await writeFile(temporary, value); await rename(temporary, filename); }
async function config(root: string): Promise<HookConfig> {
  try {
    const value: HookConfig = JSON.parse(await readFile(configPath(root), 'utf8'));
    if (value.schema === 1) {
      // The common Git directory also locates the installing checkout for linked worktrees.
      if (value.relativeRepo !== undefined && value.root) {
        const repo = path.resolve(root, value.relativeRepo);
        const relocate = (filename: string) => {
          for (const [before, after] of [[value.root!, root], [value.repo, repo]]) {
            const relative = within(before, filename);
            if (relative !== undefined) return path.resolve(after, relative);
          }
          return filename;
        };
        return { ...value, repo, root, python: relocate(value.python), modulesPath: relocate(value.modulesPath), hookPath: relocate(value.hookPath), original: value.original ? relocate(value.original) : undefined };
      }
      return value;
    }
  } catch { /* not configured */ }
  throw new Error('Combined hook is not installed. Run diffslice hook install.');
}
function within(directory: string, filename: string): string | undefined {
  const relative = path.relative(directory, filename);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? undefined : relative;
}
async function pythonVersion(python: string): Promise<string> {
  const result = await run(python, ['-I', '-X', 'utf8', '-c', 'import importlib.metadata; print(importlib.metadata.version("graphifyy"))'], { windowsHide: true, timeout: 30_000 });
  const version = result.stdout.trim(); const parts = version.split('.').map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN) || parts[0] === 0 && (parts[1] < 9 || parts[1] === 9 && parts[2] < 102)) throw new Error(`Graphify ${version} is too old; version 0.9.102 or newer is required.`);
  return version;
}
async function sqlAvailable(python: string): Promise<boolean> {
  try { await run(python, ['-I', '-X', 'utf8', '-c', 'import tree_sitter_sql'], { windowsHide: true, timeout: 30_000 }); return true; }
  catch { return false; }
}
async function ensurePython(root: string, supplied?: string): Promise<{ python: string; version: string; sql: boolean }> {
  if (supplied) { const python = path.resolve(supplied); return { python, version: await pythonVersion(python), sql: await sqlAvailable(python) }; }
  const environment = path.join(root, 'tools', 'graphify');
  const python = path.join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  let createEnvironment = true;
  try {
    const version = await pythonVersion(python);
    createEnvironment = false;
    if (await sqlAvailable(python)) return { python, version, sql: true };
    // Upgrade only our private environment, never a user-supplied interpreter.
  } catch { /* provision a private environment */ }
  await mkdir(path.dirname(environment), { recursive: true });
  console.error('Preparing isolated Graphify runtime...');
  try { if (createEnvironment) await run('uv', ['venv', '--python', '3.12', environment], { windowsHide: true, timeout: 120_000 }); }
  catch (error: any) { throw new Error(`Cannot prepare Graphify: ${error.message}. Install uv or pass --graphify-python with an existing Graphify interpreter.`); }
  await run('uv', ['pip', 'install', '--python', python, `graphifyy[watch,sql]==${VERSION}`], { windowsHide: true, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  if (!await sqlAvailable(python)) throw new Error('The private Graphify SQL parser could not be loaded. Retry hook installation.');
  return { python, version: await pythonVersion(python), sql: true };
}
async function hookPath(repo: string): Promise<string> {
  let directory = path.resolve(repo, (await git(repo, ['rev-parse', '--git-path', 'hooks'])).trim());
  // Husky 9's _ directory contains generated dispatchers; edit its user hook instead.
  if (path.basename(directory) === '_' && path.basename(path.dirname(directory)) === '.husky') directory = path.dirname(directory);
  return path.join(directory, 'pre-commit');
}
async function wrapperText(repo: string, root: string, originalActive: boolean, original: string | undefined): Promise<string> {
  const entry = fileURLToPath(import.meta.url);
  const cli = entry.endsWith('.ts') ? path.resolve(path.dirname(entry), '../dist/cli.js') : entry;
  let relativeCli = within(repo, cli);
  // Node resolves pnpm/npm-link symlinks; persist the public package path, not a versioned store path.
  const projectCli = path.join(repo, 'node_modules/diffslice/dist/cli.js');
  try { if (await realpath(projectCli) === await realpath(cli)) relativeCli = path.relative(repo, projectCli); }
  catch { /* source/global CLI, without a matching local dependency */ }
  const located = (filename: string) => {
    const relative = within(repo, filename);
    return relative === undefined ? shellQuote(filename) : `"$_diffslice_install"/${shellQuote(relative)}`;
  };
  return `#!/bin/sh
${MARKER}
_diffslice_common=$(git rev-parse --git-common-dir) || exit $?
_diffslice_install="$_diffslice_common"/${shellQuote(path.relative(path.dirname(root), repo))}
${originalActive ? `${located(original!)} "$@"
_diffslice_original_status=$?
[ "$_diffslice_original_status" -eq 0 ] || exit "$_diffslice_original_status"
` : ''}_diffslice_node=${shellQuote(process.execPath)}
if [ ! -x "$_diffslice_node" ]; then _diffslice_node=node; fi
${relativeCli === undefined ? `_diffslice_cli=${shellQuote(cli)}` : `_diffslice_repo=$(git rev-parse --show-toplevel) || exit $?
_diffslice_cli="$_diffslice_repo"/${shellQuote(relativeCli)}
if [ ! -f "$_diffslice_cli" ]; then _diffslice_cli="$_diffslice_install"/${shellQuote(relativeCli)}; fi`}
if [ ! -f "$_diffslice_cli" ]; then
  echo 'DiffSlice is missing. Install project dependencies, then run npx diffslice hook install.' >&2
  exit 1
fi
"$_diffslice_node" "$_diffslice_cli" hook run
exit $?
`;
}

export async function installPrecommit(options: { repo: string; python?: string; modulesPath?: string }) {
  const root = await managementRoot(options.repo); await mkdir(root, { recursive: true });
  const modulesPath = options.modulesPath ?? path.join(options.repo, 'diffslice.modules.json');
  compileModuleRules(JSON.parse(await readFile(modulesPath, 'utf8')));
  const runtime = await ensurePython(root, options.python);
  const target = await hookPath(options.repo);
  let existing: Buffer | undefined; let mode: number | undefined;
  try {
    const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Existing pre-commit hook is not a regular file; left untouched.');
    existing = await readFile(target); mode = stat.mode;
  } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  if (existing?.includes(Buffer.from(MARKER))) {
    const saved = await config(root);
    if (existing.toString('utf8') !== saved.wrapper) throw new Error('Managed hook was edited; left untouched.');
    const wrapper = await wrapperText(options.repo, root, !!saved.originalActive, saved.original);
    await atomicWrite(target, wrapper); await chmod(target, 0o755);
    await atomicWrite(configPath(root), JSON.stringify({ ...saved, ...runtime, repo: options.repo, root, relativeRepo: path.relative(root, options.repo), modulesPath, wrapper }, null, 2));
    return { status: 'updated', hookPath: target, ...runtime };
  }
  const original = existing ? `${target}.diffslice-original` : undefined;
  if (original) { try { await access(original); throw new Error(`Backup already exists: ${original}. Left hook untouched.`); } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  const originalActive = !!existing && (process.platform === 'win32' || !!(mode! & 0o111));
  const wrapper = await wrapperText(options.repo, root, originalActive, original);
  const saved: HookConfig = { schema: 1, repo: options.repo, root, relativeRepo: path.relative(root, options.repo), ...runtime, modulesPath, hookPath: target, original, originalMode: mode, originalActive, wrapper };
  await mkdir(path.dirname(target), { recursive: true });
  if (original) await rename(target, original);
  try {
    await writeFile(target, wrapper, { mode: 0o755 }); await chmod(target, 0o755);
    await atomicWrite(configPath(root), JSON.stringify(saved, null, 2));
  } catch (error) {
    await unlink(target).catch(() => {}); if (original) await rename(original, target); throw error;
  }
  return { status: 'installed', hookPath: target, preservedExisting: !!existing, ...runtime };
}
export async function uninstallPrecommit(repo: string) {
  const root = await managementRoot(repo); const saved = await config(root);
  const current = await readFile(saved.hookPath, 'utf8');
  if (current !== saved.wrapper) throw new Error('Managed hook was edited; left untouched.');
  if (saved.original) { await access(saved.original); await unlink(saved.hookPath); await rename(saved.original, saved.hookPath); if (saved.originalMode !== undefined) await chmod(saved.hookPath, saved.originalMode & 0o777); }
  else await unlink(saved.hookPath);
  await unlink(configPath(root));
  return { status: 'uninstalled', restoredExisting: !!saved.original };
}
export async function precommitStatus(repo: string) {
  const root = await managementRoot(repo);
  try { const saved = await config(root); return { installed: (await readFile(saved.hookPath, 'utf8')) === saved.wrapper, hookPath: saved.hookPath, python: saved.python, graphifyVersion: saved.version, sql: saved.sql }; }
  catch { return { installed: false }; }
}

async function acquireLock(root: string) {
  const filename = path.join(root, 'precommit.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await open(filename, 'wx'); await handle.writeFile(JSON.stringify({ pid: process.pid })); return async () => { await handle.close(); await unlink(filename); }; }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(filename, 'utf8'));
      try { process.kill(previous.pid, 0); }
      catch (probe: any) { if (probe.code === 'ESRCH') { await unlink(filename); continue; } }
      throw new Error('Another DiffSlice pre-commit update is running.');
    }
  }
  throw new Error('Could not acquire the pre-commit update lock.');
}
function pythonProcess(python: string, args: string[], options: { cwd: string; input?: unknown; env?: NodeJS.ProcessEnv; echo?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', ...args], { cwd: options.cwd, windowsHide: true, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; const timer = setTimeout(() => child.kill(), 600_000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-1024 * 1024); if (options.echo) process.stderr.write(chunk); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); if (options.echo) process.stderr.write(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`Graphify process failed (${code}): ${(errors || output).slice(-2000)}`)); });
    child.stdin.on('error', () => {}); child.stdin.end(options.input ? JSON.stringify(options.input) : undefined);
  });
}
export async function runPrecommit(repo: string) {
  const started = performance.now(); const [root, settings] = await Promise.all([privateRoot(repo), managementRoot(repo)]); const saved = await config(settings);
  const timings = { prepareMs: 0, snapshotMs: 0, graphifyMs: 0, normalizeMs: 0, moduleIndexMs: 0, graphPublishMs: 0 };
  await mkdir(root, { recursive: true });
  const originalRelative = path.relative(saved.repo ?? repo, saved.modulesPath);
  const modulesPath = originalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(originalRelative) ? saved.modulesPath : path.join(repo, originalRelative);
  const release = await acquireLock(root);
  try {
    const tree = (await git(repo, ['write-tree'])).trim();
    const relative = path.relative(repo, modulesPath).replace(/\\/g, '/');
    let rulesText: string;
    try { rulesText = relative.startsWith('../') || path.isAbsolute(relative) ? await readFile(modulesPath, 'utf8') : await git(repo, ['show', `${tree}:${relative}`]); }
    catch { throw new Error('Stage diffslice.modules.json before committing, or configure an external rules file.'); }
    const rules = compileModuleRules(JSON.parse(rulesText));
    const rulesHash = createHash('sha256').update(rulesText).digest('hex');
    const readyPath = path.join(root, 'precommit-ready.json');
    const graphPath = path.join(root, 'graphify', 'graph.json');
    let previous: any; try { previous = JSON.parse(await readFile(readyPath, 'utf8')); } catch { /* first run */ }
    if (previous?.tree === tree && previous.rulesHash === rulesHash && previous.python === saved.python && previous.version === saved.version && previous.sql === saved.sql) {
      let complete = false;
      try {
        const published = JSON.parse(await readFile(graphPath, 'utf8'));
        const cachedModules = JSON.parse(await readFile(path.join(root, 'modules-index-v1.json'), 'utf8'));
        complete = published.diffslice_staged_tree === tree && cachedModules.tree === tree && cachedModules.rulesHash === rulesHash;
      } catch { /* incomplete cache: rebuild */ }
      if (complete) {
        if ((await git(repo, ['write-tree'])).trim() !== tree) throw new Error('The Git index changed during cached validation. Retry the commit.');
        timings.prepareMs = Math.round(performance.now() - started);
        return { tree, graphPath, cached: true, timings, elapsedMs: Math.round(performance.now() - started) };
      }
    }
    const listed = await git(repo, ['ls-tree', '-r', '-z', '--full-tree', tree]);
    const files: Record<string, string> = Object.create(null);
    for (const record of listed.split('\0')) {
      const tab = record.indexOf('\t'); if (tab < 0) continue;
      const [mode, type, sha] = record.slice(0, tab).split(' '); const filename = record.slice(tab + 1);
      if (type !== 'blob' || mode === '120000' || filename.startsWith('graphify-out/') || rules.exclude.some(pattern => pattern.test(filename))) continue;
      files[filename] = sha;
    }
    const snapshot = path.join(root, 'staged-source');
    timings.prepareMs = Math.round(performance.now() - started);
    console.error('DiffSlice pre-commit: preparing staged files...');
    let stage = performance.now();
    const materialized = JSON.parse(await pythonProcess(saved.python, ['-c', STAGED_COPY], { cwd: repo, input: { root: snapshot, repo, state: path.join(root, 'staged-files.json'), files } }));
    timings.snapshotMs = Math.round(performance.now() - stage);
    const raw = path.join(root, 'graphify', 'raw'); await mkdir(raw, { recursive: true });
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) if (key.startsWith('GIT_') || key === 'PYTHONPATH') delete environment[key];
    Object.assign(environment, { GRAPHIFY_OUT: raw, GRAPHIFY_NO_TIPS: '1', PYTHONHASHSEED: '0', GRAPHIFY_MAX_WORKERS: '1' });
    console.error('DiffSlice pre-commit: updating Graphify (staged code only)...');
    stage = performance.now();
    const graphifyTimingsPath = path.join(root, 'graphify', 'timings.json');
    try { await unlink(graphifyTimingsPath); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    const profile = process.env.DIFFSLICE_PROFILE_GRAPHIFY === '1' ? path.join(root, 'graphify', 'last-update.pstats') : undefined;
    await pythonProcess(saved.python, ['-c', GRAPHIFY_UPDATE], { cwd: snapshot, env: environment, echo: true, input: { snapshot, timings: graphifyTimingsPath, profile, native: process.env.DIFFSLICE_GRAPHIFY_NATIVE === '1' } });
    timings.graphifyMs = Math.round(performance.now() - stage);
    stage = performance.now();
    const graph = JSON.parse(await readFile(path.join(raw, 'graph.json'), 'utf8'));
    if (!Array.isArray(graph.nodes)) throw new Error('Graphify did not produce a valid graph.');
    const prefix = snapshot.replace(/\\/g, '/') + '/';
    const normalize = (value: any) => { if (value && typeof value.source_file === 'string') { const file = value.source_file.replace(/\\/g, '/'); if (file.toLowerCase().startsWith(prefix.toLowerCase())) value.source_file = file.slice(prefix.length); } };
    graph.nodes.forEach(normalize); (graph.links ?? graph.edges ?? []).forEach(normalize);
    graph.diffslice_staged_tree = tree;
    if ((await git(repo, ['write-tree'])).trim() !== tree) throw new Error('The Git index changed during Graphify extraction. Retry the commit.');
    timings.normalizeMs = Math.round(performance.now() - stage);
    console.error('DiffSlice pre-commit: updating module cache...');
    stage = performance.now();
    const updated = await updateModuleIndex({ repo, configPath: modulesPath });
    if (updated.index.tree !== tree || (await git(repo, ['write-tree'])).trim() !== tree) throw new Error('The Git index changed during module update. Retry the commit.');
    timings.moduleIndexMs = Math.round(performance.now() - stage);
    stage = performance.now();
    await atomicWrite(graphPath, JSON.stringify(graph));
    timings.graphPublishMs = Math.round(performance.now() - stage);
    const result = { tree, graphPath, python: saved.python, version: saved.version, sql: saved.sql, rulesHash, cached: false, materialized, files: updated.stats.files, measuredBlobs: updated.stats.measuredBlobs, timings, graphifyTimingsPath, ...(profile ? { graphifyProfilePath: profile } : {}), elapsedMs: Math.round(performance.now() - started) };
    await atomicWrite(readyPath, JSON.stringify(result, null, 2));
    return result;
  } finally { await release(); }
}
