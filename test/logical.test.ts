import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './helpers.js';
import { fakeAgent, sampleMap } from './logical-helpers.js';
import { collectEvidence, verifyEvidence } from '../src/logical/evidence.js';
import { generateLogicalMap, evidenceBatches } from '../src/logical/generate.js';
import { AGENTS, validateAnalysis, validateLogicalMap } from '../src/logical/types.js';
import { extractResult, planInvocation, runProcess } from '../src/logical/agents.js';
import { externalPath } from '../src/logical/storage.js';
import { exportLogical, readLogicalReport, renderLogicalHtml } from '../src/logical/export.js';
import { layoutLogical, renderLogicalSvg } from '../src/logical/layout.js';
import { git } from '../src/git.js';
import { prepareReview } from '../src/review.js';
import { startServer } from '../src/server.js';

const run = promisify(execFile);
const cli = path.resolve('dist/cli.js');
async function temporary(t: { after: (fn: () => Promise<void>) => void }) { const p = await mkdtemp(path.join(os.tmpdir(), 'diffslice-logical-')); t.after(() => rm(p, { recursive: true, force: true })); return p; }

test('logical schema validates evidence/endpoints, recomputes coverage, and safely renders untrusted text', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const map = await sampleMap(f.root, f.base, f.head);
  assert.equal(map.unclassified.length, 0);
  assert.throws(() => validateLogicalMap({ ...map, schema: 2 }), /Unsupported/);
  assert.throws(() => validateLogicalMap({ ...map, base: 'HEAD' }), /SHA/);
  assert.throws(() => validateLogicalMap({ ...map, nodes: [{ ...map.nodes[0], evidence: ['invented'] }] }), /unknown evidence/);
  assert.throws(() => validateLogicalMap({ ...map, edges: [{ ...map.edges[0], to: 'invented' }] }), /endpoint/);
  assert.throws(() => validateLogicalMap({ ...map, evidence: [{ ...map.evidence[0], path: '../escape' }] }), /unsafe/);
  const partial = validateLogicalMap({ ...map, areas: [map.areas[0]], nodes: [map.nodes[0]], edges: [], unclassified: [] });
  assert.ok(partial.unclassified.length > 0);
  map.nodes[0].title = '<script>alert(1)</script>';
  const svg = renderLogicalSvg(map); assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/); assert.doesNotMatch(svg, /<(?:foreignObject|image|script)\b/);
  const html = await renderLogicalHtml(map, path.resolve('dist/viewer')); assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  const a = layoutLogical(map, 'identity'), b = layoutLogical(map, 'identity'); assert.deepEqual(a, b);
  assert.ok(a.nodes.some(n => n.external && n.node.id === 'resource'));
  assert.ok(!layoutLogical(map, 'identity', false).nodes.some(n => n.external));
  for (const n of a.nodes) { assert.ok(n.x >= 0 && n.x + n.width <= a.width); assert.ok(n.y + n.height <= a.height); }
});

test('evidence comes only from committed blobs, tracks renames/deletions/binaries, and detects tampered reports', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await f.put('src/auth.ts', 'UNCOMMITTED_SECRET');
  const evidence = await collectEvidence(f.root, f.base, f.head);
  assert.doesNotMatch(JSON.stringify(evidence), /UNCOMMITTED_SECRET/);
  assert.ok(evidence.evidence.some(r => r.path === 'removed.ts' && r.side === 'base'));
  assert.ok(evidence.evidence.some(r => r.path === 'src/rename old.ts' && r.side === 'base'));
  assert.ok(evidence.evidence.some(r => r.path === 'binary.bin' && r.omitted?.includes('Binary')));
  const map = await sampleMap(f.root, f.base, f.head); await verifyEvidence(f.root, map);
  await assert.rejects(verifyEvidence(f.root, { ...map, changedPaths: [] }), /changed paths/);
  await assert.rejects(verifyEvidence(f.root, { ...map, evidence: [{ ...map.evidence[0], blob: '0'.repeat(40) }] }), /does not match/);
  const textRef = map.evidence.find(e => e.lines > 0)!;
  await assert.rejects(verifyEvidence(f.root, { ...map, evidence: [{ ...textRef, lines: textRef.lines + 100 }] }), /line counts/);
});

test('all four CLI adapters generate the same validated map, cache explicit models, and do not touch the repository', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), fake = await fakeAgent(); t.after(() => rm(fake.root, { recursive: true, force: true }));
  const before = await git(f.root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const original = await readdir(path.join(f.root, '.git'));
  for (const agent of AGENTS) {
    const options = { repo: f.root, base: f.base, head: f.head, agent, model: 'test/model', bin: fake.filename, cacheDir: path.join(external, agent) };
    const map = await generateLogicalMap(options); assert.equal(map.provenance.agent, agent); assert.equal(map.unclassified.length, 0);
    const count = (await readFile(path.join(fake.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length;
    assert.deepEqual(await generateLogicalMap(options), map);
    assert.equal((await readFile(path.join(fake.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, count);
    const svg = renderLogicalSvg(map, { area: map.areas[0].id }); assert.match(svg, /Functional behavior/);
    assert.equal((await readdir(options.cacheDir)).some(n => n.startsWith('run-')), false);
  }
  assert.equal(await git(f.root, ['status', '--porcelain=v1', '--untracked-files=all']), before);
  assert.deepEqual(await readdir(path.join(f.root, '.git')), original);
  const calls = (await readFile(path.join(fake.root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.ok(calls.every(c => !c.cwd.startsWith(f.root)));
  const codex = calls.find(c => c.args.includes('exec')); assert.ok(codex.args.includes('read-only')); assert.ok(codex.args.includes('--ignore-user-config'));
  const pi = calls.find(c => c.args.includes('--no-mcp')); assert.ok(pi.args.includes('--no-tools'));
});

test('invalid agent output is not cached, and cancellation terminates the process and cleans temporary evidence', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), bad = await fakeAgent('invalid'), hang = await fakeAgent('hang');
  t.after(async () => { await rm(bad.root, { recursive: true, force: true }); await rm(hang.root, { recursive: true, force: true }); });
  await assert.rejects(generateLogicalMap({ repo: f.root, base: f.base, head: f.head, agent: 'codex', model: 'test', bin: bad.filename, cacheDir: external }), /Logical map/);
  await assert.rejects(access(path.join(external, 'maps')));
  const controller = new AbortController();
  await assert.rejects(generateLogicalMap({ repo: f.root, base: f.base, head: f.head, agent: 'pi', bin: hang.filename, cacheDir: external, signal: controller.signal, onProgress: message => { if (message.startsWith('Analysing')) setTimeout(() => controller.abort(), 150); } }), /cancelled|abort/i);
  assert.equal((await readdir(external)).some(n => n.startsWith('run-')), false);
});

test('larger comparisons reconcile bounded drafts across areas and disclose source omissions', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), fake = await fakeAgent(); t.after(() => rm(fake.root, { recursive: true, force: true }));
  for (let i = 0; i < 5; i++) await f.put(`large-${i}.ts`, 'export const sample = true;\n'.repeat(2500));
  await git(f.root, ['add', '.']); await git(f.root, ['commit', '-qm', 'Larger fixture']);
  const progress: string[] = [];
  const map = await generateLogicalMap({ repo: f.root, base: f.head, head: 'HEAD', agent: 'codex', model: 'fixture', bin: fake.filename, cacheDir: external, onProgress: p => progress.push(p) });
  assert.ok(progress.some(p => p.startsWith('Reconciling'))); assert.equal(map.unclassified.length, 0);
  assert.ok(map.evidence.some(e => e.omitted)); assert.ok(map.warnings.length > 0);
  assert.ok((await readFile(path.join(fake.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length > 2);
});

test('external paths reject repository, Git directory, another checkout, and symlinked ancestors', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t);
  await assert.rejects(externalPath(f.root, path.join(f.root, 'report.html')), /outside/);
  await assert.rejects(externalPath(f.root, path.join(f.root, '.git', 'report.html')), /outside/);
  // Only the source repository, its Git directories and its worktrees are refused; an unrelated/enclosing repository is a valid cache location.
  const other = path.join(external, 'other'); await mkdir(other); await git(other, ['init', '-q']);
  assert.equal(await externalPath(f.root, path.join(other, 'report.html')), path.join(await realpath(other), 'report.html'));
  const linked = path.join(external, 'linked'); await git(f.root, ['worktree', 'add', '-q', '--detach', linked]);
  await assert.rejects(externalPath(f.root, path.join(linked, 'report.html')), /outside/);
  if (process.platform !== 'win32') { await symlink(f.root, path.join(external, 'link')); await assert.rejects(externalPath(f.root, path.join(external, 'link', 'missing', 'report.html')), /outside/); }
});

test('lightweight HTML round trips without source/patches and exports per-area SVGs with no additional agent call', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), map = await sampleMap(f.root, f.base, f.head);
  const html = path.join(external, 'report.html'); await exportLogical({ repo: f.root, map, output: html, format: 'html', assets: path.resolve('dist/viewer') });
  const raw = await readFile(html, 'utf8'); assert.match(raw, /data:font\/woff2;base64/); assert.doesNotMatch(raw, /export const login|export const added|"patch"\s*:|"diffs"\s*:/);
  assert.deepEqual(await readLogicalReport(html), map);
  const malicious = path.join(external, 'untrusted.html'); await writeFile(malicious, raw.replace('<body>', '<body><script>throw new Error("MUST_NOT_EXECUTE")</script>'));
  assert.deepEqual(await readLogicalReport(malicious), map);
  const outputs = await exportLogical({ repo: f.root, map, output: path.join(external, 'svg'), format: 'svg', overview: true }); assert.equal(outputs.length, 4);
  await assert.rejects(exportLogical({ repo: f.root, map, output: html, format: 'html', assets: path.resolve('dist/viewer') }), /EEXIST/);
  const rendered = await run(process.execPath, [cli, 'logical', 'render', html, '--repo', f.root, '--format', 'svg', '--output', path.join(external, 'rendered'), '--json']);
  assert.equal(JSON.parse(rendered.stdout).outputs.length, 3);
  const opened = await run(process.execPath, [cli, 'open', malicious, '--repo', f.root, '--map', f.mapPath, '--cache-dir', path.join(external, 'cache'), '--json']);
  const review = JSON.parse(opened.stdout); assert.equal(review.logical.base, f.base); assert.equal(review.files.length, 5); assert.ok(review.metrics.totalLines > 0);
  const before = await git(f.root, ['status', '--porcelain=v1', '--untracked-files=all']); const gitFiles = await readdir(path.join(f.root, '.git'));
  const unconfigured = JSON.parse((await run(process.execPath, [cli, 'open', html, '--repo', f.root, '--cache-dir', path.join(external, 'unconfigured'), '--json'])).stdout);
  assert.ok(unconfigured.warnings.some((w: string) => w.includes('Starter module boundaries')));
  assert.equal(await git(f.root, ['status', '--porcelain=v1', '--untracked-files=all']), before);
  assert.deepEqual(await readdir(path.join(f.root, '.git')), gitFiles);
  await assert.rejects(run(process.execPath, [cli, 'compare', f.head, f.head, '--repo', f.root, '--map', f.mapPath, '--logical-map', html, '--cache-dir', path.join(external, 'cache'), '--json']), /does not match/);
});

test('direct CLI generation reports paths and rejects an in-repository output before invoking any agent', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), fake = await fakeAgent(); t.after(() => rm(fake.root, { recursive: true, force: true }));
  await assert.rejects(run(process.execPath, [cli, 'logical', f.base, f.head, '--repo', f.root, '--agent', 'codex', '--agent-bin', fake.filename, '--output', path.join(f.root, 'report.html')]), /outside/);
  await assert.rejects(access(path.join(fake.root, 'calls.jsonl')));
  await assert.rejects(run(process.execPath, [cli, 'logical', f.base, f.head, '--repo', f.root, '--agent', 'codex', '--agent-bin', fake.filename, '--dry-run']), /--dry-run is only supported/);
  await assert.rejects(access(path.join(fake.root, 'calls.jsonl')));
  const result = await run(process.execPath, [cli, 'logical', f.base, f.head, '--repo', f.root, '--agent', 'codex', '--model', 'fixture', '--agent-bin', fake.filename, '--cache-dir', path.join(external, 'cache'), '--output', path.join(external, 'report.html'), '--json']);
  assert.equal(JSON.parse(result.stdout).outputs.length, 1); assert.match(result.stderr, /Analysing evidence/);
});

test('logical HTTP generation requires session token and same origin, preserves read-only routes, and exports mapping only', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const external = await temporary(t), fake = await fakeAgent(); t.after(() => rm(fake.root, { recursive: true, force: true }));
  const review = await prepareReview({ repo: f.root, base: f.base, head: f.head, mapPath: f.mapPath, cacheDir: path.join(external, 'metrics') });
  const { server, url } = await startServer({ repo: f.root, review, assets: path.resolve('dist/viewer'), agentBin: { agent: 'codex', bin: fake.filename }, logicalCacheDir: path.join(external, 'logical') }); t.after(() => new Promise<void>(r => server.close(() => r())));
  const endpoint = new URL('/api/logical/generate', url), status = await (await fetch(new URL('/api/logical/status', url))).json();
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 403);
  const headers = { 'Content-Type': 'application/json', 'X-DiffSlice-Token': status.token };
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' })).status, 403);
  assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ agent: 'codex', bin: '/evil' }) })).status, 400);
  assert.equal((await fetch(new URL('/api/logical/map', url))).status, 404);
  // Simultaneous requests (double click, two tabs) must start exactly one paid run.
  const racers = await Promise.all([1, 2, 3].map(() => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ agent: 'codex', model: 'fixture' }) })));
  assert.deepEqual(racers.map(r => r.status).sort(), [202, 409, 409]);
  assert.equal((await fetch(endpoint, { method: 'POST', headers, body: '{}' })).status, 409);
  // Await the server job through its public endpoint; no paid/external provider is used.
  let ready: any;
  for (let i = 0; i < 100; i++) { ready = await (await fetch(new URL('/api/logical/status', url))).json(); if (ready.state !== 'running') break; await new Promise(r => setTimeout(r, 20)); }
  assert.equal(ready.state, 'ready', ready.error);
  // Polling carries only the map identity; the map itself is fetched once.
  assert.equal(ready.map, undefined); assert.equal(typeof ready.generatedAt, 'string');
  const served = await (await fetch(new URL('/api/logical/map', url))).json(); assert.equal(served.provenance.generatedAt, ready.generatedAt);
  // --agent-bin was given for codex only: choosing another agent must not run that binary.
  const gitBin = (await run('sh', ['-c', 'command -v git'])).stdout.trim(); await symlink(gitBin, path.join(external, 'git'));
  const calls = async () => (await readFile(path.join(fake.root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, before = await calls(), originalPath = process.env.PATH;
  process.env.PATH = external; // no real agent CLI may be reachable for this check
  try {
    assert.deepEqual((await (await fetch(new URL('/api/logical/agents', url))).json()).agents, ['codex']);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ agent: 'pi', model: 'fixture', provider: 'p', refresh: true }) })).status, 202);
    let other: any; for (let i = 0; i < 100; i++) { other = await (await fetch(new URL('/api/logical/status', url))).json(); if (other.state !== 'running') break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(other.state, 'failed'); assert.match(other.error, /not installed/); assert.equal(await calls(), before);
  } finally { process.env.PATH = originalPath; }
  const exported = await (await fetch(new URL('/api/logical/export', url))).text(); assert.match(exported, /id="diffslice-logical"/); assert.doesNotMatch(exported, /export const login/);
  assert.equal((await fetch(new URL('/api/review', url), { method: 'POST' })).status, 405);
});

test('adapter parsers reject failed turns, accept fenced JSON, and batch evidence with bounded payloads', async () => {
  assert.throws(() => extractResult('codex', JSON.stringify({ type: 'turn.failed' })), /failed turn/);
  assert.throws(() => extractResult('claude-code', JSON.stringify({ type: 'result', is_error: true, structured_output: {} })), /failed turn/);
  assert.deepEqual(extractResult('codex', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '```json\n{"areas":[]}\n```' } })), { areas: [] });
  assert.throws(() => extractResult('pi', 'not-json'), /no supported final/);
  const data: any = { units: Array.from({ length: 5 }, (_, i) => ({ path: String(i), sources: [{ id: String(i), text: 'x'.repeat(70_000) }] })) };
  assert.equal(evidenceBatches(data).length, 5);
});

test('agent invocation rejects flag-shaped model IDs and bounds hung subprocesses', async t => {
  const external = await temporary(t);
  await assert.rejects(planInvocation({ agent: 'codex', model: '--dangerously-bypass-approvals-and-sandbox' }, process.execPath, external, 'test'), /Invalid --model/);
  await assert.rejects(runProcess({ bin: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], env: process.env }, external, new AbortController().signal, undefined, 80), /timed out/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runProcess({ bin: process.execPath, args: [], env: process.env }, external, controller.signal), /abort/i);
});

test('agent output is repaired or dropped item by item, while imported reports stay strict', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const map = await sampleMap(f.root, f.base, f.head), good = map.nodes[0], e0 = map.evidence[0].id;
  const raw = { areas: [{ id: 'a', name: 'Area' }, { id: 'empty', name: 'Nothing here' }, { id: 'a', name: 'Duplicate' }],
    nodes: [{ ...good, id: 'ok', area: 'a', title: 'T'.repeat(300), summary: 'S\u0000ummary', evidence: [e0, 'invented', e0] }, { ...good, id: 'no-area', area: 'missing' }, { ...good, id: 'no-evidence', area: 'a', evidence: ['invented'] }, { id: 'bad' }, { ...good, id: 'second', area: 'a', evidence: [e0] }],
    edges: [{ id: 'self', from: 'ok', to: 'ok', label: 'x', state: 'changed', evidence: [e0] }, { id: 'dangling', from: 'ok', to: 'gone', label: 'x', state: 'changed', evidence: [e0] }, { id: 'fine', from: 'ok', to: 'second', label: 'uses', state: 'changed', evidence: [e0] }] };
  const issues: string[] = [], analysis = validateAnalysis(raw, map.evidence, m => issues.push(m));
  assert.deepEqual(analysis.areas.map(a => a.id), ['a']); assert.deepEqual(analysis.nodes.map(n => n.id), ['ok', 'second']); assert.deepEqual(analysis.edges.map(e => e.id), ['fine']);
  assert.equal(analysis.nodes[0].title.length, 100); assert.equal(analysis.nodes[0].summary, 'Summary'); assert.deepEqual(analysis.nodes[0].evidence, [e0]);
  assert.ok(issues.length >= 6);
  assert.throws(() => validateAnalysis(raw, map.evidence));
});

test('a node citing the base side of a renamed file covers its destination path', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true })); const e = await collectEvidence(f.root, f.base, f.head), map = await sampleMap(f.root, f.base, f.head);
  assert.deepEqual(e.renames, [{ from: 'src/rename old.ts', to: 'src/rename new.ts' }]);
  const oldSide = e.evidence.find(r => r.path === 'src/rename old.ts' && r.side === 'base')!, oldOnly = new Set([oldSide.id]);
  const nodes = map.nodes.map(n => ({ ...n, evidence: n.evidence.filter(id => !oldOnly.has(id) && e.evidence.find(r => r.id === id)!.path !== 'src/rename new.ts') }));
  nodes[0].evidence.push(oldSide.id);
  const covered = validateLogicalMap({ ...map, nodes, renames: e.renames });
  assert.ok(!covered.unclassified.includes('src/rename new.ts'));
  assert.ok(validateLogicalMap({ ...map, nodes, renames: [] }).unclassified.includes('src/rename new.ts'));
  await verifyEvidence(f.root, covered);
  await assert.rejects(verifyEvidence(f.root, { ...covered, renames: [] }), /renames/);
});

test('changed files with unrepresentable names are skipped with a warning instead of failing analysis', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await f.put('back\\slash.ts', 'export const odd = true;\n'); await git(f.root, ['add', '.']); await git(f.root, ['commit', '-qm', 'Odd name']);
  const evidence = await collectEvidence(f.root, f.base, 'HEAD');
  assert.ok(!evidence.changedPaths.some(p => p.includes('\\'))); assert.ok(evidence.changedPaths.includes('src/auth.ts'));
  assert.ok(evidence.warnings.some(w => w.includes('cannot represent')));
  const map = validateLogicalMap({ ...await sampleMap(f.root, f.base, 'HEAD') }); await verifyEvidence(f.root, map);
});

test('large range diffs are split per file and batched blob reads match committed content', async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const e = await collectEvidence(f.root, f.base, f.head);
  const unit = e.units.find(u => u.path === 'src/auth.ts')!; assert.match(unit.patch, /^diff --git a\/src\/auth\.ts b\/src\/auth\.ts/); assert.doesNotMatch(unit.patch, /new file\.ts/);
  assert.match(e.units.find(u => u.path === 'src/rename new.ts')!.patch, /rename from src\/rename old\.ts/);
  assert.equal(e.units.find(u => u.path === 'binary.bin')!.patch, '');
  assert.match(e.units.find(u => u.path === 'new file.ts')!.sources[0].text, /1: export const added/);
});
