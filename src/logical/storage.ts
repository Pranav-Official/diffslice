import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../git.js';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const logicalCacheRoot = () => path.join(process.env.LOCALAPPDATA ?? process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'diffslice', 'logical');
const inside = (root: string, file: string) => { const r = path.relative(root, file); return !r || r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
// Resolve existing ancestors too: a not-yet-created child of a symlink is not safe.
export async function canonical(filename: string): Promise<string> {
  try { return await realpath(filename); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(filename); if (parent === filename) throw error; return path.join(await canonical(parent), path.basename(filename)); }
}
export async function externalPath(repo: string, filename: string): Promise<string> {
  const target = await canonical(path.resolve(filename));
  // Only the source repository, its Git directories and its linked worktrees are off limits. An enclosing or unrelated
  // repository (e.g. a dotfiles repo at $HOME) must not make the default cache location unusable.
  const roots = new Set(await Promise.all([realpath(repo), git(repo, ['rev-parse', '--git-common-dir']).then(p => canonical(path.resolve(repo, p.trim()))), git(repo, ['rev-parse', '--git-dir']).then(p => canonical(path.resolve(repo, p.trim())))]));
  try {
    const listing = await git(repo, ['worktree', 'list', '--porcelain', '-z']);
    for (const field of listing.split('\0')) if (field.startsWith('worktree ')) roots.add(await canonical(field.slice(9)));
  } catch { /* older Git: the checkout and Git directories are still covered */ }
  if ([...roots].some(root => inside(root, target))) throw new Error('Logical output, cache, and temporary files must be outside the source repository, its Git directory, and its worktrees.');
  return target;
}
export async function writeExternal(repo: string, filename: string, contents: string, overwrite = false): Promise<string> {
  const target = await externalPath(repo, filename); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  if (!overwrite) {
    const file = await open(target, 'wx', 0o600); try { await file.writeFile(contents); } finally { await file.close(); } return target;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(contents); } finally { await file.close(); } await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  return target;
}
export async function boundedRead(filename: string, max = 32 * 1024 * 1024): Promise<string> {
  const file = await open(filename, 'r');
  try { if ((await file.stat()).size > max) throw new Error('Logical report exceeds the size limit.'); return await file.readFile('utf8'); }
  finally { await file.close(); }
}
