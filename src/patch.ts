import { parsePatch } from 'diff';
import { git } from './git.js';
import type { Review, FileDiff, DiffHunk, DiffCell, DiffRow } from './types.js';

export function parseDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const parsed of parsePatch(patch)) for (const hunk of parsed.hunks) {
    let oldLine = hunk.oldStart; let newLine = hunk.newStart; const rows: DiffRow[] = [];
    let deleted: DiffCell[] = []; let added: DiffCell[] = [];
    const flush = () => { for (let i = 0; i < Math.max(deleted.length, added.length); i++) rows.push({ old: deleted[i], new: added[i] }); deleted = []; added = []; };
    for (const line of hunk.lines) {
      const prefix = line[0]; const text = line.slice(1);
      if (prefix === '-') deleted.push({ line: oldLine++, text, kind: 'delete' });
      else if (prefix === '+') added.push({ line: newLine++, text, kind: 'add' });
      else if (prefix === ' ') { flush(); rows.push({ old: { line: oldLine++, text, kind: 'context' }, new: { line: newLine++, text, kind: 'context' } }); }
    }
    flush(); hunks.push({ header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, rows });
  }
  return hunks;
}
export async function loadDiff(repo: string, review: Review, fileId: string): Promise<FileDiff> {
  const file = review.files.find(f => f.id === fileId);
  if (!file) throw new Error('Unknown changed file.');
  if (file.binary) return { fileId, binary: true, truncated: false, message: 'Binary file changed. A text diff is not available.', hunks: [], patch: '' };
  const paths = [...new Set([file.path, ...(file.oldPath ? [file.oldPath] : [])])].map(p => `:(literal)${p}`);
  const patch = await git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--unified=5', review.base.sha, review.head.sha, '--', ...paths]);
  if (Buffer.byteLength(patch, 'utf8') > 3 * 1024 * 1024) return { fileId, binary: false, truncated: true, message: 'This patch exceeds the 3 MB viewer limit. Inspect it with git diff locally.', hunks: [], patch: '' };
  return { fileId, binary: false, truncated: false, hunks: parseDiff(patch), patch };
}
