import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AGENTS } from './types.js';
import { agentId, findAgent, validateAgentOptions } from './agents.js';
import { generateLogicalMap } from './generate.js';
import { renderLogicalHtml } from './export.js';
import type { Review } from '../types.js';

export function logicalHttp(options: { repo: string; review: Review; assets?: string; cacheDir?: string; agentBin?: string }) {
  const token = randomBytes(32).toString('hex');
  let state = options.review.logical ? 'ready' : 'idle', progress = '', error = '', controller: AbortController | undefined;
  let active: Promise<void> | undefined;
  const status = () => ({ token, state, progress, ...(error ? { error } : {}), ...(options.review.logical ? { map: options.review.logical } : {}) });
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  return {
    async close() { controller?.abort(); await active; },
    async handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
      if (!pathname.startsWith('/api/logical/')) return false;
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/logical/status') { json(res, 200, status()); return true; }
      if (req.method === 'GET' && pathname === '/api/logical/agents') {
        const agents = (await Promise.all(AGENTS.map(async id => { try { await findAgent(id); return id; } catch { return null; } }))).filter(Boolean);
        json(res, 200, { agents }); return true;
      }
      if (req.method === 'GET' && pathname === '/api/logical/export') {
        if (!options.review.logical) { json(res, 409, { error: 'Generate a logical map first.' }); return true; }
        const html = await renderLogicalHtml(options.review.logical, options.assets);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="diffslice-logical.html"' }); res.end(html); return true;
      }
      if (pathname !== '/api/logical/generate' || !['POST', 'DELETE'].includes(req.method ?? '')) { json(res, 405, { error: 'Unsupported logical operation.' }); return true; }
      // A local web page must not be able to launch a provider charge via CSRF/DNS rebinding.
      const origin = req.headers.origin;
      if (req.headers['x-diffslice-token'] !== token || origin && origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: 'Invalid local generation authorization.' }); return true; }
      if (req.method === 'DELETE') { controller?.abort(); json(res, 202, status()); return true; }
      if (state === 'running') { json(res, 409, { error: 'Logical generation is already running.' }); return true; }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, { error: 'Expected application/json.' }); return true; }
      let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) { json(res, 413, { error: 'Generation request too large.' }); return true; } }
      let input: { agent: string; model?: string; provider?: string; refresh?: boolean };
      try {
        input = JSON.parse(text);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['agent', 'model', 'provider', 'refresh'].includes(k)) || input.refresh !== undefined && typeof input.refresh !== 'boolean') throw new Error('Invalid generation options.');
        validateAgentOptions({ agent: agentId(input.agent), model: input.model, provider: input.provider });
      } catch (e: any) { json(res, 400, { error: e.message }); return true; }
      controller = new AbortController(); const running = controller;
      state = 'running'; progress = 'Preparing committed evidence'; error = '';
      active = generateLogicalMap({ repo: options.repo, base: options.review.base.sha, head: options.review.head.sha, comparison: options.review.comparison, agent: agentId(input.agent), model: input.model, provider: input.provider, bin: options.agentBin, cacheDir: options.cacheDir, refresh: input.refresh, signal: running.signal, onProgress: message => { progress = message; } }).then(map => { options.review.logical = map; state = 'ready'; progress = 'Logical analysis ready'; }).catch(e => { state = running.signal.aborted ? 'cancelled' : 'failed'; error = String(e.message).slice(0, 1400); }).finally(() => { if (controller === running) controller = undefined; });
      json(res, 202, status()); return true;
    },
  };
}
