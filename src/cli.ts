import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { git, repositoryRoot, resolvePr } from './git.js';
import { prepareReview } from './review.js';
import { startServer, exportHtml, createDiffLoader } from './server.js';
import { updateModuleIndex } from './module-index.js';
import { initializeModules, type InitGroup } from './init.js';
import { installPrecommit, uninstallPrecommit, precommitStatus, runPrecommit } from './precommit.js';

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `DiffSlice ${VERSION} — Git changes on your module map

  diffslice compare <base> <head> [options]
  diffslice init [--repo <path>] [--dry-run] [--json]
  diffslice pr <https://github.com/owner/repo/pull/123> [options]
  diffslice modules update --staged [--modules <rules.json>] [options]
  diffslice hook <install|run|status|uninstall> [options]

Options:
  --repo <path>       Local Git repository (default: current directory)
  --map <graph.json>  Existing Graphify artifact (default: <repo>/graphify-out/graph.json)
  --port <number>     Local server port (default: available port)
  --no-open           Print the URL without launching a browser
  --export <file>     Write a self-contained offline HTML review and exit
  --json              Print review data and exit
  --cache-dir <path>  Derived map cache (default: user cache directory)
  --modules <file>    Hierarchy rules (default: <repo>/diffslice.modules.json)
  --staged            Update hierarchy from the Git index for a pre-commit hook
  --dry-run           Preview init suggestions without creating a rules file
  --install-hook      Init: install the combined Graphify + DiffSlice pre-commit hook
  --graphify-python   Existing Graphify Python interpreter (otherwise provisions with uv)
  --help             Show this help
  --version          Show the version

Rules are detected at head in diffslice.modules.json; --modules selects rules explicitly.
--map selects Graphify communities. Comparison never invokes an indexer or LLM.
PR comparisons use the merge base; explicit commit comparisons use the exact pair.
`;

export function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.error(`Open this URL in your browser: ${url}`)); child.unref();
}
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string' }, map: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, export: { type: 'string' }, json: { type: 'boolean' }, 'cache-dir': { type: 'string' }, modules: { type: 'string' }, staged: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'install-hook': { type: 'boolean' }, 'graphify-python': { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  if (values.version) { console.log(VERSION); return; }
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command, first, second] = positionals;
  if (command === 'hook') {
    if (positionals.length !== 2 || !['install', 'run', 'status', 'uninstall'].includes(first)) throw new Error('Usage: diffslice hook <install|run|status|uninstall> [--repo path]');
    const repo = await repositoryRoot(values.repo ?? process.cwd());
    const result = first === 'install' ? await installPrecommit({ repo, python: values['graphify-python'], modulesPath: values.modules ? path.resolve(values.modules) : undefined }) : first === 'run' ? await runPrecommit(repo) : first === 'status' ? await precommitStatus(repo) : await uninstallPrecommit(repo);
    console.log(JSON.stringify(result, null, values.json ? undefined : 2));
    if (first === 'install' && !values.json) console.log('Stage diffslice.modules.json before committing. The hook waits for Graphify and DiffSlice to finish.');
    return;
  }
  if (command === 'init') {
    if (positionals.length !== 1) throw new Error('Usage: diffslice init [--repo path] [--dry-run] [--json]');
    const repo = await repositoryRoot(values.repo ?? process.cwd());
    const result = await initializeModules({ repo, dryRun: values['dry-run'], cacheDir: values['cache-dir'] ? path.resolve(values['cache-dir']) : undefined });
    const hook = values['install-hook'] && !values['dry-run'] ? await installPrecommit({ repo, python: values['graphify-python'] }) : undefined;
    if (values.json) console.log(JSON.stringify({ ...result, ...(hook ? { hook } : {}) }));
    else {
      console.log(`\nDiffSlice ${result.status === 'existing' ? 'found existing rules' : result.status === 'dry-run' ? 'initialization preview' : 'created module rules'}: ${result.output}`);
      console.log(`${result.stats.includedFiles} included files, ${result.stats.excludedFiles} excluded, ${result.stats.elapsedMs} ms\n`);
      const print = (groups: InitGroup[], depth = 0) => { for (const group of groups) { console.log(`${'  '.repeat(depth)}${group.name} (${group.files} files)`); console.log(`${'  '.repeat(depth)}  ${group.reason}`); print(group.children, depth + 1); } };
      print(result.groups);
      for (const file of result.unassigned) console.log(`  Unassigned: ${file}`);
      for (const file of result.ambiguous) console.log(`  Ambiguous: ${file.path} (${file.candidates.join(', ')})`);
      console.log(`\n${result.note}`);
      console.log(result.cache.status === 'ready' ? `Cached ${result.cache.files} committed files (${result.cache.lines} lines) for the first review.` : result.cache.reason);
      if (result.status === 'dry-run') console.log('No files written. Run npx diffslice init to save these rules.\n');
      else {
        let hasPair = false;
        try { await git(repo, ['rev-parse', '--verify', '--end-of-options', 'HEAD~1^{commit}']); hasPair = true; } catch { /* new or shallow repository */ }
        console.log(hasPair ? 'Review existing commits: npx diffslice compare HEAD~1 HEAD' : 'Review needs two existing commits. Once history is available, run npx diffslice compare <base> <head>.');
        console.log('Share setup by committing diffslice.modules.json with package.json and your package-manager lockfile. Nothing was staged.');
        if (!hook) console.log('No hooks or Graphify were installed. Optional combined hook: npx diffslice hook install (requires uv or --graphify-python).');
        console.log();
      }
      if (hook) console.log(`Combined pre-commit hook installed at ${hook.hookPath}. Stage diffslice.modules.json before committing.`);
    }
    return;
  }
  if (values['dry-run']) throw new Error('--dry-run is only supported by diffslice init.');
  if (command === 'modules') {
    if (first !== 'update' || positionals.length !== 2 || !values.staged) throw new Error('Usage: diffslice modules update --staged [--modules rules.json] [--repo path]');
    const repo = await repositoryRoot(values.repo ?? process.cwd());
    const result = await updateModuleIndex({ repo, configPath: values.modules ? path.resolve(values.modules) : undefined, cacheDir: values['cache-dir'] ? path.resolve(values['cache-dir']) : undefined });
    if (values.json) console.log(JSON.stringify(result));
    else {
      const s = result.stats;
      console.log(`DiffSlice hierarchy: ${s.files} files, ${s.changedPaths} changed paths, ${s.measuredBlobs} blobs measured · ${s.elapsedMs} ms${s.cacheHit ? ' · cached' : ''}`);
      for (const file of s.unassigned) console.log(`  Unassigned: ${file}`);
      for (const file of s.ambiguous) console.log(`  Ambiguous: ${file.path} (${file.candidates?.join(', ')})`);
    }
    return;
  }
  if (command !== 'compare' && command !== 'pr') throw new Error(`Unknown command: ${command}. Run diffslice --help.`);
  if ((command === 'compare' && (positionals.length !== 3)) || (command === 'pr' && positionals.length !== 2)) throw new Error(`Usage: diffslice ${command === 'compare' ? 'compare <base> <head>' : 'pr <GitHub PR URL>'}. Run diffslice --help.`);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('--port must be an integer from 0 to 65535.');
  const repo = await repositoryRoot(values.repo ?? process.cwd());
  const modulesPath = values.modules ? path.resolve(values.modules) : undefined;
  const mapPath = values.map ? path.resolve(values.map) : undefined;
  const revisions = command === 'pr' ? await resolvePr(repo, first) : { base: first, head: second };
  const review = await prepareReview({ repo, mapPath, modulesPath, ...revisions, cacheDir: values['cache-dir'] ? path.resolve(values['cache-dir']) : undefined });
  if (values.json) { console.log(JSON.stringify(review)); return; }
  console.log(`\n  DiffSlice · ${review.repository}\n  ${review.base.sha.slice(0, 7)} → ${review.head.sha.slice(0, 7)}\n  ${review.totals.files} changed files · ${review.totals.modules} touched modules · +${review.totals.additions} −${review.totals.deletions}\n  Prepared in ${review.timings.prepareMs} ms · ${review.timings.mapCacheHit ? 'cached map' : 'imported map'}\n`);
  if (!review.files.length) console.log('  These commits have identical trees. The viewer will show the unchanged map.\n');
  if (values.export) {
    const output = path.resolve(values.export); await exportHtml(output, review, createDiffLoader(repo, review)); console.log(`  Exported ${output}\n`);
    if (!values['no-open']) openBrowser(pathToFileURL(output).href); return;
  }
  const { server, url } = await startServer({ repo, review, port });
  console.log(`  Review: ${url}\n  Press Ctrl+C to stop.\n`);
  if (!values['no-open']) openBrowser(url);
  const stop = () => server.close(() => process.exit(0)); process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(`\nDiffSlice: ${error.message}\n`); process.exitCode = 1; });
