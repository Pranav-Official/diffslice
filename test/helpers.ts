import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { git } from '../src/git.js';

export async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'diffslice-test-'));
  await git(root, ['init', '-q']); await git(root, ['config', 'user.name', 'DiffSlice tests']); await git(root, ['config', 'user.email', 'diffslice@example.invalid']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  const put = async (file: string, text: string | Buffer) => { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); };
  await put('src/auth.ts', 'export const login = () => "before";\n');
  await put('src/rename old.ts', 'export const unchanged = true;\n');
  await put('removed.ts', 'export const removed = true;\n');
  await put('binary.bin', Buffer.from([0, 1, 2, 3]));
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'Before']); const base = (await git(root, ['rev-parse', 'HEAD'])).trim();
  await put('src/auth.ts', 'export const login = () => "after";\n');
  await git(root, ['mv', 'src/rename old.ts', 'src/rename new.ts']);
  await git(root, ['rm', 'removed.ts']);
  await put('new file.ts', 'export const added = "<script>";\n');
  await put('binary.bin', Buffer.from([0, 3, 4, 5]));
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'After']); const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const graph = { graph: { graphify_version: 'test' }, built_at_commit: head, nodes: [
    { id: 'login', source_file: 'src/auth.ts', community: 1, community_name: 'Authentication' },
    { id: 'renamed', source_file: 'src/rename old.ts', community: 2, community_name: 'Utilities' },
    { id: 'removed', source_file: 'removed.ts', community: 1 },
  ], links: [{ source: 'login', target: 'renamed' }] };
  const mapPath = path.join(root, 'graph.json'); await writeFile(mapPath, JSON.stringify(graph));
  return { root, base, head, mapPath, graph, put };
}
