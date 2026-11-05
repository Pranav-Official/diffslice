import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';
import type { FileMetric, SourceMetrics } from './types.js';

type BlobMetric = Omit<FileMetric, 'available'>;
function treeEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const record of text.split('\0')) {
    const tab = record.indexOf('\t'); if (tab < 0) continue;
    const [, type, sha] = record.slice(0, tab).split(' ');
    if (type === 'blob') entries.set(record.slice(tab + 1), sha);
  }
  return entries;
}

// One streaming Git process, not a git-show subprocess for every file. Blob IDs
// come from ls-tree, so names with spaces/tabs/newlines never enter this protocol.
export function readBlobMetrics(repo: string, ids: string[]): Promise<Record<string, BlobMetric>> {
  if (!ids.length) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], { windowsHide: true });
    const results: Record<string, BlobMetric> = {};
    let pending: Buffer = Buffer.alloc(0); let stderr = ''; let failed = false;
    let current: { sha: string; bytes: number; remaining: number; breaks: number; binary: boolean; lastByte: number } | null = null;
    const fail = (error: Error) => { if (failed) return; failed = true; child.kill(); reject(error); };
    const timer = setTimeout(() => fail(new Error('Timed out measuring source line counts.')), 30_000);
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 2000); });
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      try {
        while (pending.length) {
          if (!current) {
            const end = pending.indexOf(10); if (end < 0) break;
            const header = pending.subarray(0, end).toString('ascii'); pending = pending.subarray(end + 1);
            const match = header.match(/^([a-f0-9]+) blob (\d+)$/);
            if (!match) throw new Error(`Unexpected Git blob response: ${header.slice(0, 120)}`);
            current = { sha: match[1], bytes: Number(match[2]), remaining: Number(match[2]), breaks: 0, binary: false, lastByte: -1 };
          }
          if (current.remaining) {
            const length = Math.min(current.remaining, pending.length); const body = pending.subarray(0, length);
            for (const byte of body) { if (byte === 10) current.breaks++; if (byte === 0) current.binary = true; }
            if (length) current.lastByte = body[length - 1];
            current.remaining -= length; pending = pending.subarray(length);
            if (current.remaining) break;
          }
          if (!pending.length) break;
          if (pending[0] !== 10) throw new Error('Invalid Git blob boundary.');
          results[current.sha] = { lines: current.binary ? 0 : current.breaks + (current.bytes > 0 && current.lastByte !== 10 ? 1 : 0), bytes: current.bytes, binary: current.binary };
          current = null; pending = pending.subarray(1);
        }
      } catch (error) { fail(error as Error); }
    });
    child.on('error', fail); child.stdin.on('error', fail);
    child.on('close', code => {
      clearTimeout(timer); if (failed) return;
      if (code || Object.keys(results).length !== ids.length) reject(new Error(`Could not measure source line counts: ${stderr.trim() || 'incomplete Git response'}`));
      else resolve(results);
    });
    child.stdin.end(`${ids.join('\n')}\n`);
  });
}

export async function sourceMetrics(repo: string, base: string, head: string, paths: string[], cacheDir: string): Promise<SourceMetrics> {
  const files = [...new Set(paths)].sort();
  const key = createHash('sha256').update(JSON.stringify([1, base, head, files])).digest('hex');
  const manifestPath = path.join(cacheDir, 'metrics', `${key}.json`);
  try { const cached = JSON.parse(await readFile(manifestPath, 'utf8')); if (cached.schema === 1) return { ...cached.metrics, cacheHit: true }; } catch { /* first use or expired derived data */ }
  const headTree = treeEntries(await git(repo, ['ls-tree', '-r', '--full-tree', '-z', head]));
  const missing = files.filter(file => !headTree.has(file));
  const baseTree = missing.length ? treeEntries(await git(repo, ['ls-tree', '-r', '--full-tree', '-z', base])) : new Map<string, string>();
  const blobIds = new Map<string, string>();
  for (const file of files) { const sha = headTree.get(file) ?? baseTree.get(file); if (sha) blobIds.set(file, sha); }
  const blobCachePath = path.join(cacheDir, 'metrics', 'blobs-v1.json');
  let cachedBlobs: Record<string, BlobMetric> = {};
  try { cachedBlobs = JSON.parse(await readFile(blobCachePath, 'utf8')); } catch { /* no blob cache */ }
  const uncached = [...new Set(blobIds.values())].filter(sha => !Object.hasOwn(cachedBlobs, sha));
  const measured = await readBlobMetrics(repo, uncached);
  const blobs = { ...cachedBlobs, ...measured };
  const metrics: SourceMetrics = { files: Object.create(null), totalLines: 0, measuredFiles: 0, unavailableFiles: 0, cacheHit: false };
  for (const file of files) {
    const sha = blobIds.get(file); const metric = sha ? blobs[sha] : undefined;
    metrics.files[file] = metric ? { ...metric, available: true } : { lines: 0, bytes: 0, binary: false, available: false };
    if (metric) { metrics.totalLines += metric.lines; metrics.measuredFiles++; } else metrics.unavailableFiles++;
  }
  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const suffix = `${process.pid}-${Date.now()}.tmp`;
    const temporaryBlobs = `${blobCachePath}.${suffix}`; await writeFile(temporaryBlobs, JSON.stringify(blobs)); await rename(temporaryBlobs, blobCachePath);
    const temporaryManifest = `${manifestPath}.${suffix}`; await writeFile(temporaryManifest, JSON.stringify({ schema: 1, metrics })); await rename(temporaryManifest, manifestPath);
  } catch { /* caching is optional on restricted file systems */ }
  return metrics;
}
