import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { git, repositoryRoot, resolvePr } from './git.js';
import { prepareReview } from './review.js';
import { startServer, exportHtml, createDiffLoader } from './server.js';
import { updateModuleIndex } from './module-index.js';
import { initializeModules, type InitGroup } from './init.js';
import { installPrecommit, uninstallPrecommit, precommitStatus, runPrecommit } from './precommit.js';
import { agentId } from './logical/agents.js';
import { generateLogicalMap } from './logical/generate.js';
import { exportLogical, readLogicalReport } from './logical/export.js';
import { externalPath, logicalCacheRoot } from './logical/storage.js';
import { verifyEvidence } from './logical/evidence.js';
import type { LogicalMap, LogicalVersion } from './logical/types.js';

const VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `DiffSlice ${VERSION} — Git changes on your module map

  diffslice compare <base> <head> [options]
  diffslice init [--repo <path>] [--dry-run] [--json]
  diffslice pr <https://github.com/owner/repo/pull/123> [options]
  diffslice logical <base> <head> --agent <cli> [--model <id>] [options]
  diffslice logical render <report.html|mapping.json> [options]
  diffslice open <report.html|mapping.json> [--repo <path>]
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
  --logical          Compare/PR: explicitly generate a functional map (--agent required)
  --logical-map <file> Import a logical HTML/JSON map without invoking AI
  --agent <cli>      claude-code | codex | opencode | pi (uses installed CLI auth)
  --model <id>       Native model ID (otherwise CLI default; no cache reuse)
  --provider <id>    Pi upstream provider (requires --model)
  --agent-bin <path> Explicit CLI executable or JavaScript entry
  --format <type>   Logical output: html (mapping only), svg, or json
  --output <path>   External output file, or directory for SVGs
  --overview        SVG: also write an area overview
  --area <id>       SVG: export a selected functional area
  --state <mode>    SVG: changes (default), before, or after
  --refresh         Explicitly regenerate instead of reusing cached analysis
  --overwrite       Allow replacing existing logical output files
  --help             Show this help
  --version          Show the version

Rules are detected at head in diffslice.modules.json; --modules selects rules explicitly.
--map selects Graphify communities. Ordinary comparison never invokes an indexer or LLM.
Logical generation is opt-in, can incur provider charges, and writes only outside repositories.
Logical HTML contains maps and evidence references, never embedded source or patches.
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
    logical: { type: 'boolean' }, 'logical-map': { type: 'string' }, agent: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' }, 'agent-bin': { type: 'string' }, format: { type: 'string' }, output: { type: 'string' }, overview: { type: 'boolean' }, area: { type: 'string' }, state: { type: 'string' }, refresh: { type: 'boolean' }, overwrite: { type: 'boolean' },
  } });
  if (values.version) { console.log(VERSION); return; }
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command, first, second] = positionals;
  if (values['dry-run'] && command !== 'init') throw new Error('--dry-run is only supported by diffslice init.');
  const generation = async (repo: string, base: string, head: string, comparison: LogicalMap['comparison'] = 'commits') => {
    if (!values.agent) throw new Error('Logical generation requires an explicit --agent claude-code|codex|opencode|pi. Charges may apply.');
    const controller = new AbortController(); const abort = () => controller.abort();
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    try { return await generateLogicalMap({ repo, base, head, comparison, agent: agentId(values.agent), model: values.model, provider: values.provider, bin: values['agent-bin'], cacheDir: values['cache-dir'], refresh: values.refresh, signal: controller.signal, onProgress: message => console.error(`  ${message}`) }); }
    finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
  };
  if (command === 'logical') {
    if (positionals.length !== 3) throw new Error('Usage: diffslice logical <base> <head> --agent <cli>, or diffslice logical render <report>');
    if (values.export) throw new Error('Use --output for logical exports; --export is the complete review snapshot option.');
    if (first === 'render' && (values.agent || values.model || values.provider || values.refresh || values['agent-bin'])) throw new Error('logical render never invokes an agent. Remove generation-only options.');
    const repo = await repositoryRoot(values.repo ?? process.cwd());
    const format = values.format ?? 'html'; if (!['html', 'svg', 'json'].includes(format)) throw new Error('--format must be html, svg, or json.');
    const state = values.state ?? 'changes'; if (!['changes', 'before', 'after'].includes(state)) throw new Error('--state must be changes, before, or after.');
    if (format !== 'svg' && (values.area || values.state || values.overview)) throw new Error('--area, --state, and --overview apply to SVG exports.');
    const root = await externalPath(repo, path.resolve(values['cache-dir'] ?? logicalCacheRoot()));
    const destination = await externalPath(repo, path.resolve(values.output ?? path.join(root, 'exports', `logical-${randomUUID()}${format === 'svg' ? '' : '.' + format}`)));
    // Fail before provider charges if the chosen output would overwrite a file/directory.
    if (!values.overwrite) { let exists = false; try { await access(destination); exists = true; } catch (e: any) { if (e.code !== 'ENOENT') throw e; } if (exists) throw new Error('Output already exists. Choose another location or use --overwrite.'); }
    const map = first === 'render' ? await readLogicalReport(path.resolve(second)) : await generation(repo, first, second);
    const outputs = await exportLogical({ repo, map, output: destination, format: format as 'html' | 'svg' | 'json', overwrite: values.overwrite, overview: values.overview, area: values.area, version: state as LogicalVersion });
    if (values.json) console.log(JSON.stringify({ base: map.base, head: map.head, outputs, unclassified: map.unclassified }));
    else { for (const output of outputs) console.log(output); if (map.unclassified.length) console.error(`${map.unclassified.length} paths unclassified; see report coverage.`); }
    return;
  }
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
  if (command !== 'compare' && command !== 'pr' && command !== 'open') throw new Error(`Unknown command: ${command}. Run diffslice --help.`);
  if (command === 'open' && positionals.length !== 2) throw new Error('Usage: diffslice open <logical-report.html|mapping.json> [--repo path]');
  if ((command === 'compare' && (positionals.length !== 3)) || (command === 'pr' && positionals.length !== 2)) throw new Error(`Usage: diffslice ${command === 'compare' ? 'compare <base> <head>' : 'pr <GitHub PR URL>'}. Run diffslice --help.`);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('--port must be an integer from 0 to 65535.');
  const repo = await repositoryRoot(values.repo ?? process.cwd());
  const modulesPath = values.modules ? path.resolve(values.modules) : undefined;
  const mapPath = values.map ? path.resolve(values.map) : undefined;
  if ((values.logical || values['logical-map'] || command === 'open') && values.export) await externalPath(repo, path.resolve(values.export));
  if (values.logical && values['logical-map']) throw new Error('Choose --logical generation or --logical-map import, not both.');
  if (command === 'open' && (values.logical || values['logical-map'])) throw new Error('open imports its report without AI. Do not combine it with --logical or --logical-map.');
  let logical: LogicalMap | undefined = command === 'open' ? await readLogicalReport(path.resolve(first)) : values['logical-map'] ? await readLogicalReport(path.resolve(values['logical-map'])) : undefined;
  if (logical) await verifyEvidence(repo, logical);
  const revisions = command === 'open' ? { base: logical!.base, head: logical!.head } : command === 'pr' ? await resolvePr(repo, first, { fetchMissing: !values.logical && !logical }) : { base: first, head: second };
  // Logical workflows must never put module/metric caches under the source checkout.
  const cacheDir = logical || values.logical ? await externalPath(repo, path.resolve(values['cache-dir'] ?? path.join(logicalCacheRoot(), 'reviews'))) : values['cache-dir'] ? path.resolve(values['cache-dir']) : undefined;
  const review = await prepareReview({ repo, mapPath, modulesPath, ...revisions, cacheDir, allowStructuralFallback: !!logical || !!values.logical });
  if (logical && (logical.base !== review.base.sha || logical.head !== review.head.sha)) throw new Error('Imported logical map does not match this exact base/head pair.');
  if (values.logical) logical = await generation(repo, review.base.sha, review.head.sha, review.comparison);
  if (logical) { review.logical = logical; review.comparison = logical.comparison; }
  if (values.json) { console.log(JSON.stringify(review)); return; }
  console.log(`\n  DiffSlice · ${review.repository}\n  ${review.base.sha.slice(0, 7)} → ${review.head.sha.slice(0, 7)}\n  ${review.totals.files} changed files · ${review.totals.modules} touched modules · +${review.totals.additions} −${review.totals.deletions}\n  Prepared in ${review.timings.prepareMs} ms · ${review.timings.mapCacheHit ? 'cached map' : 'imported map'}\n`);
  if (!review.files.length) console.log('  These commits have identical trees. The viewer will show the unchanged map.\n');
  if (values.export) {
    const output = logical ? await externalPath(repo, path.resolve(values.export)) : path.resolve(values.export); await exportHtml(output, review, createDiffLoader(repo, review)); console.log(`  Exported ${output}\n`);
    if (!values['no-open']) openBrowser(pathToFileURL(output).href); return;
  }
  const { url, stop: closeReview } = await startServer({ repo, review, port, logicalCacheDir: values['cache-dir'], agentBin: values['agent-bin'] });
  console.log(`  Review: ${url}\n  Press Ctrl+C to stop.\n`);
  if (!values['no-open']) openBrowser(url);
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; closeReview().catch(error => { console.error(error.message); process.exitCode = 1; }); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(`\nDiffSlice: ${error.message}\n`); process.exitCode = 1; });
