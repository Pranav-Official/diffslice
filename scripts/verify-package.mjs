import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const project = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run verify:package after npm run build.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'diffslice-package space-'));
const npm = (cwd, ...args) => run(process.execPath, [npmCli, ...args], { cwd, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
let server;
try {
  const packed = JSON.parse((await npm(project, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary)).stdout)[0];
  const files = packed.files.map(file => file.path);
  for (const file of ['dist/cli.js', 'dist/viewer/app.js', 'dist/viewer/app.css', 'dist/viewer/index.html', 'dist/viewer/THIRD_PARTY_NOTICES.txt']) assert.ok(files.includes(file), `Missing ${file}`);
  assert.ok(files.some(file => file.startsWith('dist/viewer/fonts/') && file.endsWith('.woff2')));
  assert.ok(!files.some(file => /^(src|test|node_modules)\//.test(file)), 'Package must contain built output, not the development checkout.');

  const repo = path.join(temporary, 'consumer');
  await mkdir(repo);
  await writeFile(path.join(repo, 'package.json'), '{"name":"diffslice-consumer","private":true}\n');
  // No registry access, source checkout link, build tools, or install-time setup.
  await npm(repo, 'install', '--save-dev', '--save-exact', '--offline', '--no-audit', '--no-fund', path.join(temporary, packed.filename));
  const installed = JSON.parse(await readFile(path.join(repo, 'node_modules/diffslice/package.json'), 'utf8'));
  assert.deepEqual(installed.dependencies ?? {}, {});
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(installed.scripts?.[lifecycle], undefined);
  const invoke = (...args) => npm(repo, 'exec', '--offline', '--', 'diffslice', ...args);
  assert.equal((await invoke('--version')).stdout.trim(), installed.version);
  const git = (...args) => run('git', ['-C', repo, ...args], { timeout: 30_000 });
  await git('init', '-q');
  await git('config', 'user.name', 'DiffSlice package test');
  await git('config', 'user.email', 'diffslice@example.invalid');
  await git('config', 'core.autocrlf', 'false');
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
  await mkdir(path.join(repo, 'src'));
  await writeFile(path.join(repo, 'src/main.js'), 'export const value = 1;\n');
  await git('add', '.'); await git('commit', '-qm', 'Before');
  await writeFile(path.join(repo, 'src/main.js'), 'export const value = 2;\n');
  await git('add', 'src/main.js'); await git('commit', '-qm', 'After');
  const index = (await git('write-tree')).stdout;
  assert.equal(JSON.parse((await invoke('hook', 'status', '--json')).stdout).installed, false);
  const init = JSON.parse((await invoke('init', '--json')).stdout);
  assert.equal(init.status, 'created');
  assert.equal(init.cache.status, 'ready');
  assert.equal((await git('write-tree')).stdout, index, 'Init must not stage files.');
  const review = JSON.parse((await invoke('compare', 'HEAD~1', 'HEAD', '--json')).stdout);
  assert.equal(review.files.length, 1);
  assert.equal(review.map.provenance.kind, 'rules');
  await invoke('compare', 'HEAD~1', 'HEAD', '--export', 'review.html', '--no-open');
  const html = await readFile(path.join(repo, 'review.html'), 'utf8');
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /id="diffslice-licenses"/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
  const data = JSON.parse(html.match(/<script id="diffslice-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.match(Object.values(data.diffs)[0].patch, /value = 2/);

  // Exercise logical generation/import from the actual project dev dependency,
  // without a provider account, global CLI, or access to this checkout's TS sources.
  const agent = path.join(temporary, 'agent.mjs');
  await writeFile(agent, `import {readFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('codex-cli 0.166.0');process.exit(0)}
const data=JSON.parse(readFileSync(0,'utf8').split('EVIDENCE DATA:\\n')[1]);
const result={areas:[{id:'behavior',name:'Application behavior'}],nodes:[{id:'value',area:'behavior',title:'Application value',state:'changed',summary:'Updated application value',before:'Previous value',after:'Updated value',effect:'Application value changes.',evidence:data.manifest.map(e=>e.id)}],edges:[]};
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));
`);
  const logicalHtml = path.join(temporary, 'logical.html'), cache = path.join(temporary, 'cache');
  const beforeLogical = (await git('status', '--porcelain=v1', '--untracked-files=all')).stdout;
  await invoke('logical', 'HEAD~1', 'HEAD', '--agent', 'codex', '--model', 'fixture', '--agent-bin', agent, '--cache-dir', cache, '--output', logicalHtml);
  const mappingHtml = await readFile(logicalHtml, 'utf8');
  assert.match(mappingHtml, /id="diffslice-logical"/); assert.doesNotMatch(mappingHtml, /export const value/);
  const imported = JSON.parse((await invoke('open', logicalHtml, '--cache-dir', cache, '--json')).stdout);
  assert.equal(imported.logical.nodes[0].title, 'Application value'); assert.equal(imported.files.length, 1);
  const rendered = JSON.parse((await invoke('logical', 'render', logicalHtml, '--format', 'svg', '--output', path.join(temporary, 'svg'), '--json')).stdout);
  assert.equal(rendered.outputs.length, 2);
  assert.equal((await git('status', '--porcelain=v1', '--untracked-files=all')).stdout, beforeLogical, 'Logical workflows must not write into the consumer repository.');

  const cli = path.join(repo, 'node_modules/diffslice/dist/cli.js');
  server = spawn(process.execPath, [cli, 'compare', 'HEAD~1', 'HEAD', '--no-open', '--port', '0'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = ''; let errors = '';
    const timer = setTimeout(() => reject(new Error(`Viewer startup timed out: ${errors}`)), 30_000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Viewer exited (${code}): ${errors}`)); });
    server.stderr.on('data', chunk => { errors += chunk; });
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Review: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  for (const asset of ['/', '/app.js', '/app.css']) assert.equal((await fetch(`${url}${asset}`)).status, 200, asset);
  const liveReview = await (await fetch(`${url}/api/review`)).json();
  const diff = await (await fetch(`${url}/api/files/${liveReview.files[0].id}/diff`)).json();
  assert.match(diff.patch, /value = 2/);
  console.log(`Verified ${packed.filename}: offline project-dependency install, local CLI, init, comparison, viewer assets, lazy patches, full export, logical HTML generation/import, SVG rendering, and repository isolation.`);
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill(); await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
