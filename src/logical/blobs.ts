import { spawn } from 'node:child_process';

export interface BlobReader { read(sha: string): Promise<Buffer>; close(): void }
/**
 * One long-lived `git cat-file --batch` process answering requests in order, instead of one spawn per blob.
 * Requests are sequential, so memory stays bounded to a single blob.
 */
export function openBlobReader(repo: string, signal?: AbortSignal): BlobReader {
  const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buffer = Buffer.alloc(0), failure: Error | undefined, wake: (() => void) | undefined;
  const fail = (error: Error) => { failure ??= error; wake?.(); };
  child.stdout.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); wake?.(); });
  child.once('error', error => fail(new Error(`Git failed: ${error.message}`)));
  child.once('close', () => fail(new Error('Git cat-file ended unexpectedly.')));
  child.stdin.on('error', () => {});
  const abort = () => { child.kill(); fail(new Error('Logical analysis cancelled.')); };
  signal?.addEventListener('abort', abort, { once: true });
  const until = async (ready: () => boolean) => {
    while (!ready()) {
      if (failure) throw failure;
      await new Promise<void>(resolve => { wake = resolve; if (ready() || failure) resolve(); });
    }
  };
  let queue: Promise<unknown> = Promise.resolve();
  const readOne = async (sha: string): Promise<Buffer> => {
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid object ID.');
    signal?.throwIfAborted();
    child.stdin.write(sha + '\n');
    await until(() => buffer.includes(10));
    const end = buffer.indexOf(10), [, type, size] = buffer.subarray(0, end).toString('utf8').split(' ');
    if (type === 'missing' || type === undefined) { buffer = buffer.subarray(end + 1); throw new Error(`Git object not found: ${sha}`); }
    const length = Number(size), total = end + 1 + length + 1;
    await until(() => buffer.length >= total);
    const content = Buffer.from(buffer.subarray(end + 1, end + 1 + length)); buffer = buffer.subarray(total);
    return content;
  };
  return {
    read: sha => { const next = queue.then(() => readOne(sha)); queue = next.catch(() => {}); return next; },
    close() { signal?.removeEventListener('abort', abort); child.stdin.end(); child.kill(); },
  };
}
