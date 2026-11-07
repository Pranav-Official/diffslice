import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ChangedFile, Commit } from './types.js';

const run = promisify(execFile);
export async function git(repo: string, args: string[], timeout = 30_000): Promise<string> {
  try { return (await run('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true })).stdout; }
  catch (error: any) { throw new Error(`Git failed: ${String(error.stderr || error.message).trim()}`); }
}
export async function repositoryRoot(input: string): Promise<string> { return (await git(path.resolve(input), ['rev-parse', '--show-toplevel'])).trim(); }
export async function resolveCommit(repo: string, ref: string): Promise<Commit> {
  const sha = (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  const [subject, author, date] = (await git(repo, ['show', '-s', '--format=%s%x00%an%x00%aI', sha])).trimEnd().split('\0');
  return { sha, subject, author, date };
}
export function parseChangedFiles(names: string, stats: string): Omit<ChangedFile, 'moduleIds'>[] {
  const numbers = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const statTokens = stats.split('\0');
  for (let i = 0; i < statTokens.length; i++) {
    const entry = statTokens[i]; if (!entry) continue;
    const first = entry.indexOf('\t'); const second = entry.indexOf('\t', first + 1);
    if (first < 0 || second < 0) throw new Error('Unexpected Git numstat output.');
    const added = entry.slice(0, first); const removed = entry.slice(first + 1, second);
    let file = entry.slice(second + 1);
    if (!file) { i++; file = statTokens[++i]; }
    numbers.set(file, { additions: added === '-' ? 0 : Number(added), deletions: removed === '-' ? 0 : Number(removed), binary: added === '-' || removed === '-' });
  }
  const tokens = names.split('\0'); const files: Omit<ChangedFile, 'moduleIds'>[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]; if (!code) continue;
    const from = tokens[++i]; const paired = code[0] === 'R' || code[0] === 'C'; const file = paired ? tokens[++i] : from;
    const status = ({ A: 'added', D: 'deleted', M: 'modified', R: 'renamed', C: 'copied', T: 'typechanged' } as const)[code[0] as 'A'];
    if (!status || !file) throw new Error(`Unsupported Git change status: ${code}`);
    files.push({ id: `file-${files.length}`, path: file, ...(paired ? { oldPath: from } : {}), status, ...(numbers.get(file) ?? { additions: 0, deletions: 0, binary: false }) });
  }
  return files;
}
export async function changedFiles(repo: string, base: string, head: string) {
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '-z'];
  const [names, stats] = await Promise.all([git(repo, [...common, '--name-status', base, head, '--']), git(repo, [...common, '--numstat', base, head, '--'])]);
  return parseChangedFiles(names, stats);
}
export function parsePrUrl(url: string): { owner: string; name: string; number: number } {
  let parsed; try { parsed = new URL(url); } catch { throw new Error('Expected a GitHub PR URL: https://github.com/owner/repo/pull/123'); }
  const match = parsed.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !match) throw new Error('Expected a GitHub PR URL: https://github.com/owner/repo/pull/123');
  return { owner: match[1], name: match[2], number: Number(match[3]) };
}
export async function resolvePr(repo: string, url: string, options: { fetchMissing?: boolean } = {}) {
  const pr = parsePrUrl(url);
  const repository = `${pr.owner}/${pr.name}`;
  let result;
  try { result = await run('gh', ['api', `repos/${repository}/pulls/${pr.number}`], { encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }); }
  catch (error: any) { throw new Error(`Unable to resolve PR with gh. Install GitHub CLI and authenticate using gh auth login.\n${String(error.stderr || error.message).trim()}`); }
  const data = JSON.parse(result.stdout);
  if (!/^[a-f0-9]{40,64}$/.test(data.base?.sha) || !/^[a-f0-9]{40,64}$/.test(data.head?.sha)) throw new Error('GitHub returned invalid commit IDs.');
  const remoteUrl = `https://github.com/${repository}.git`;
  for (const sha of [data.base.sha, data.head.sha]) {
    try { await git(repo, ['cat-file', '-e', `${sha}^{commit}`]); }
    catch { if (options.fetchMissing === false) throw new Error('Logical review requires the PR commits locally. Fetch the history explicitly, then retry.'); await git(repo, ['fetch', '--no-tags', remoteUrl, sha], 120_000); }
  }
  // A PR compares its contribution since divergence, not unrelated base-branch changes.
  const mergeBase = (await git(repo, ['merge-base', data.base.sha, data.head.sha])).trim();
  return { base: mergeBase, head: data.head.sha as string, pr: { url, number: pr.number, title: String(data.title) } };
}
