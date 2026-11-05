import path from 'node:path';
import { changedFiles, git, resolveCommit } from '../git.js';
import type { EvidenceRef, LogicalMap } from './types.js';
import { isSafeRepoPath } from './types.js';
import { openBlobReader } from './blobs.js';

export interface EvidencePackage {
  repository: string; base: string; head: string;
  changedPaths: string[]; renames: { from: string; to: string }[]; evidence: EvidenceRef[];
  units: { path: string; status: string; patch: string; sources: { id: string; text: string }[] }[];
  context: { id: string; text: string }[];
  warnings: string[];
}
const SOURCE_BYTES = 24_000;
const MAX_BLOB = 1024 * 1024;
// Names the report schema cannot represent (backslashes, control characters, dot segments) are left out of the
// logical analysis with a warning; they stay reviewable in the complete local review.
const representable = (file: { path: string; oldPath?: string }) => isSafeRepoPath(file.path) && (!file.oldPath || isSafeRepoPath(file.oldPath));
// One diff for the whole range, split per file. Patch order matches changedFiles(); any mismatch falls back to per-file diffs.
async function rangePatches(repo: string, base: string, head: string, files: { binary: boolean }[]): Promise<string[] | undefined> {
  try {
    const raw = await git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=8', base, head, '--'], 120_000);
    const chunks = raw ? raw.split(/^(?=diff --git )/m) : [];
    return chunks.length === files.length ? chunks : undefined;
  } catch { return undefined; }
}
export async function collectEvidence(repo: string, baseRef: string, headRef: string, signal?: AbortSignal): Promise<EvidencePackage> {
  const [base, head] = await Promise.all([resolveCommit(repo, baseRef), resolveCommit(repo, headRef)]);
  const all = await changedFiles(repo, base.sha, head.sha);
  if (all.length > 4000) throw new Error('Logical analysis supports at most 4,000 changed paths per comparison. Choose a narrower comparison.');
  const patches = await rangePatches(repo, base.sha, head.sha, all);
  const files = all.map((file, index) => ({ file, patch: patches?.[index] })).filter(item => representable(item.file));
  const result: EvidencePackage = { repository: path.basename(repo), base: base.sha, head: head.sha, changedPaths: files.map(f => f.file.path), renames: files.filter(f => f.file.oldPath).map(f => ({ from: f.file.oldPath!, to: f.file.path })), evidence: [], units: [], context: [], warnings: [] };
  if (files.length < all.length) result.warnings.push(`${all.length - files.length} changed path(s) with names the report format cannot represent (backslash, control characters, or dot segments) were excluded. Review them in the complete local review.`);
  const trees = await Promise.all([base.sha, head.sha].map(sha => git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', sha])));
  const parse = (raw: string) => new Map(raw.split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'), [mode, type, blob, size] = row.slice(0, tab).trim().split(/\s+/);
    return [row.slice(tab + 1), { mode, type, blob, size: Number(size) }] as const;
  }));
  const entries = trees.map(parse);
  const blobs = openBlobReader(repo, signal);
  try {
    const source = async (filename: string, side: 'base' | 'head') => {
      signal?.throwIfAborted(); const entry = entries[side === 'base' ? 0 : 1].get(filename); if (!entry) return;
      if (entry.type !== 'blob') { result.warnings.push(`Submodule omitted: ${filename}`); return; }
      const ref: EvidenceRef = { id: `e${result.evidence.length}`, path: filename, side, blob: entry.blob, lines: 0, suppliedLines: 0 };
      let text = '';
      if (entry.mode === '120000') ref.omitted = 'Symbolic link; not followed.';
      else if (entry.size > MAX_BLOB) ref.omitted = 'Source larger than 1 MiB; content not supplied.';
      else {
        const data = await blobs.read(entry.blob);
        if (data.includes(0)) ref.omitted = 'Binary source; content not supplied.';
        else {
          const lines = data.toString('utf8').split('\n'); if (lines.at(-1) === '') lines.pop(); ref.lines = lines.length;
          let bytes = 0; const selected: string[] = [];
          for (const line of lines) { const size = Buffer.byteLength(line) + 1; if (bytes + size > SOURCE_BYTES) break; selected.push(line); bytes += size; }
          ref.suppliedLines = selected.length; text = selected.map((line, i) => `${i + 1}: ${line}`).join('\n');
          if (selected.length < lines.length) ref.omitted = `Only the first ${selected.length} of ${lines.length} lines supplied (24 KB per-side limit).`;
        }
      }
      result.evidence.push(ref); return { id: ref.id, text };
    };
    for (const { file, patch: ranged } of files) {
      const sources = [];
      const before = await source(file.oldPath ?? file.path, 'base'); if (before) sources.push(before);
      const after = await source(file.path, 'head'); if (after) sources.push(after);
      let patch = '';
      if (!file.binary) {
        const raw = ranged ?? await git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--unified=8', base.sha, head.sha, '--', `:(literal)${file.path}`, ...(file.oldPath ? [`:(literal)${file.oldPath}`] : [])]);
        for (const [side, ref] of [['base', before], ['head', after]] as const) {
          if (!ref) continue; const evidence = result.evidence.find(e => e.id === ref.id)!;
          const ranges = [...raw.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(m => {
            const start = Number(m[side === 'base' ? 1 : 3]), count = Number(m[side === 'base' ? 2 : 4] ?? 1);
            return { start, end: start + count - 1 };
          }).filter(r => r.start > 0 && r.end >= r.start && r.end <= evidence.lines).slice(0, 100);
          if (ranges.length) evidence.ranges = ranges;
        }
        patch = raw;
        if (Buffer.byteLength(raw) > SOURCE_BYTES) {
          patch = raw.slice(0, 10_000) + '\n[PATCH MIDDLE OMITTED]\n' + raw.slice(-10_000);
          result.warnings.push(`Patch excerpts only: ${file.path}`);
        }
      }
      result.units.push({ path: file.path, status: file.status, patch, sources });
    }
    // Small, committed context only. Never discover or execute working-tree instructions.
    for (const name of ['README.md', 'package.json', 'diffslice.modules.json']) {
      if (files.some(f => f.file.path === name) || (entries[1].get(name)?.size ?? Infinity) > SOURCE_BYTES) continue;
      const item = await source(name, 'head'); if (item) result.context.push(item);
    }
  } finally { blobs.close(); }
  if (result.evidence.some(e => e.omitted)) result.warnings.push('Some evidence was omitted or truncated. Inspect coverage and evidence metadata before relying on this interpretation.');
  return result;
}

export async function verifyEvidence(repo: string, map: LogicalMap): Promise<void> {
  // Resolve full SHAs without checkout/fetch. A report cannot substitute HEAD or working files.
  try { await Promise.all([resolveCommit(repo, map.base), resolveCommit(repo, map.head)]); }
  catch { throw new Error('This repository does not contain both report commits. Obtain the required history explicitly, then retry.'); }
  // Same representability filter as collectEvidence, so reports that excluded unsupported names still verify.
  const actual = (await changedFiles(repo, map.base, map.head)).filter(representable);
  const expected = [...map.changedPaths].sort();
  if (JSON.stringify(actual.map(f => f.path).sort()) !== JSON.stringify(expected)) throw new Error('Logical report changed paths do not match the local Git comparison.');
  const renames = (list: { from: string; to: string }[]) => JSON.stringify(list.map(r => [r.to, r.from]).sort());
  if (renames(actual.filter(f => f.oldPath).map(f => ({ from: f.oldPath!, to: f.path }))) !== renames(map.renames ?? [])) throw new Error('Logical report renames do not match the local Git comparison.');
  const manifests = await Promise.all([map.base, map.head].map(async sha => {
    const rows = await git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', sha]);
    return new Map(rows.split('\0').filter(Boolean).map(row => { const tab = row.indexOf('\t'), [mode, type, blob, bytes] = row.slice(0, tab).trim().split(/\s+/); return [row.slice(tab + 1), { mode, type, blob, bytes: Number(bytes) }] as const; }));
  }));
  const lineCounts = new Map<string, number>(), blobs = openBlobReader(repo);
  try { for (const ref of map.evidence) {
    const entry = manifests[ref.side === 'base' ? 0 : 1].get(ref.path);
    if (!entry || entry.type !== 'blob' || entry.blob !== ref.blob) throw new Error(`Report evidence does not match committed content: ${ref.path}`);
    if (ref.lines > 0) {
      if (entry.mode === '120000' || entry.bytes > MAX_BLOB) throw new Error(`Report claims unsupported source ranges: ${ref.path}`);
      let count = lineCounts.get(ref.blob);
      if (count === undefined) { const data = await blobs.read(ref.blob); if (data.includes(0)) throw new Error(`Report claims text lines in binary evidence: ${ref.path}`); const raw = data.toString('utf8'); count = raw ? raw.split('\n').length - Number(raw.endsWith('\n')) : 0; lineCounts.set(ref.blob, count); }
      if (count !== ref.lines) throw new Error(`Report evidence line counts do not match committed content: ${ref.path}`);
    }
  } } finally { blobs.close(); }
}
