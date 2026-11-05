import { createServer, type Server } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiff } from './patch.js';
import type { Review, FileDiff, ExportData } from './types.js';

const viewerDir = () => path.join(path.dirname(fileURLToPath(import.meta.url)), 'viewer');
export const serializeEmbedded = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function createDiffLoader(repo: string, review: Review) {
  const cache = new Map<string, Promise<FileDiff>>();
  return (id: string): Promise<FileDiff> => {
    if (!review.files.some(file => file.id === id)) return Promise.reject(new Error('Unknown changed file.'));
    const hit = cache.get(id); if (hit) return hit;
    const result = loadDiff(repo, review, id).catch(error => { cache.delete(id); throw error; });
    cache.set(id, result); return result;
  };
}
export async function renderExport(review: Review, getDiff: (id: string) => Promise<FileDiff>, assets = viewerDir()): Promise<string> {
  const diffs: Record<string, FileDiff> = {};
  // Bounded parallelism keeps large reviews from spawning a Git process per file.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, review.files.length) }, async () => {
    while (cursor < review.files.length) { const file = review.files[cursor++]; diffs[file.id] = await getDiff(file.id); }
  }));
  let css = await readFile(path.join(assets, 'app.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)];
  for (const match of urls) {
    const asset = match[1].replace(/["']/g, '').replace(/^\.\//, '');
    if (!asset.startsWith('fonts/')) continue;
    const bytes = await readFile(path.join(assets, asset));
    css = css.replaceAll(match[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
  }
  const js = (await readFile(path.join(assets, 'app.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const data: ExportData = { review, diffs };
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiffSlice review</title><style>${css}</style></head><body><div id="root"></div><script id="diffslice-data" type="application/json">${serializeEmbedded(data)}</script><script>${js}</script></body></html>`;
}
export async function exportHtml(output: string, review: Review, getDiff: (id: string) => Promise<FileDiff>, assets = viewerDir()) {
  const html = await renderExport(review, getDiff, assets);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, html);
}

export async function startServer(options: { repo: string; review: Review; port?: number; assets?: string }): Promise<{ server: Server; url: string }> {
  const getDiff = createDiffLoader(options.repo, options.review); const assets = options.assets ?? viewerDir();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host ?? '')) { json(403, { error: 'Only localhost access is allowed.' }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, { error: 'This review is read-only.' }); return; }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/review') { json(200, options.review); return; }
      const match = url.pathname.match(/^\/api\/files\/(file-\d+)\/diff$/);
      if (match) {
        if (!options.review.files.some(file => file.id === match[1])) { json(404, { error: 'Unknown changed file.' }); return; }
        json(200, await getDiff(match[1])); return;
      }
      if (url.pathname === '/api/export') {
        const html = await renderExport(options.review, getDiff, assets);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="diffslice-${options.review.id}.html"` }); res.end(html); return;
      }
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
      const file = path.resolve(assets, relative);
      if (!file.startsWith(`${path.resolve(assets)}${path.sep}`)) { json(404, { error: 'Not found.' }); return; }
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
      if (!mime[path.extname(file)]) { json(404, { error: 'Not found.' }); return; }
      const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error: any) { json(error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : error.message }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Could not start local review server.');
  return { server, url: `http://127.0.0.1:${address.port}` };
}
