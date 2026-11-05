import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { access } from 'node:fs/promises';
import { loadGraph } from './graphify.js';
import { changedFiles, resolveCommit, git } from './git.js';
import { sourceMetrics } from './metrics.js';
import { loadRuleMap } from './rule-map.js';
import { planModuleRules } from './init.js';
import { externalPath, writeExternal } from './logical/storage.js';
import type { Review, ModuleChange, ChangedFile, ModuleMap, SourceMetrics } from './types.js';

export function overlay(map: ModuleMap, files: Omit<ChangedFile, 'moduleIds'>[]) {
  const changes: Record<string, ModuleChange> = {};
  const mapped = files.map(file => {
    const membershipsFor = (filePath: string) => Object.hasOwn(map.files, filePath) ? map.files[filePath] : [];
    const moduleIds = [...new Set([...membershipsFor(file.path), ...(file.oldPath ? membershipsFor(file.oldPath) : [])])];
    const memberships = moduleIds.length ? moduleIds : ['unmapped'];
    for (const id of memberships) {
      const entry = changes[id] ??= { fileIds: [], additions: 0, deletions: 0 };
      entry.fileIds.push(file.id); entry.additions += file.additions; entry.deletions += file.deletions;
    }
    return { ...file, moduleIds: memberships };
  });
  return { files: mapped, changes };
}
export async function prepareReview(options: { repo: string; mapPath?: string; modulesPath?: string; base: string; head: string; cacheDir?: string; pr?: Review['pr']; allowStructuralFallback?: boolean }): Promise<Review> {
  const start = performance.now();
  let cacheDir = options.cacheDir ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.cache'), 'diffslice', createHash('sha256').update(options.repo).digest('hex').slice(0, 16));
  if (options.allowStructuralFallback) cacheDir = await externalPath(options.repo, cacheDir);
  const [base, head] = await Promise.all([resolveCommit(options.repo, options.base), resolveCommit(options.repo, options.head)]);
  let modulesPath = options.modulesPath;
  if (!modulesPath && !options.mapPath) {
    const candidate = path.join(options.repo, 'diffslice.modules.json');
    try { await git(options.repo, ['cat-file', '-e', `${head.sha}:diffslice.modules.json`]); modulesPath = candidate; }
    catch {
      try { await access(candidate); modulesPath = candidate; }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; /* no configured rules: use Graphify */ }
    }
  }
  const files = await changedFiles(options.repo, base.sha, head.sha);
  let structuralFallback = false;
  if (options.allowStructuralFallback && !modulesPath && !options.mapPath) {
    let graphExists = true; try { await access(path.join(options.repo, 'graphify-out/graph.json')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; graphExists = false; }
    if (!graphExists) {
      const paths = (await git(options.repo, ['ls-tree', '-r', '--name-only', '-z', head.sha])).split('\0').filter(Boolean);
      modulesPath = path.join(cacheDir, `structural-rules-${head.sha}.json`);
      await writeExternal(options.repo, modulesPath, JSON.stringify(planModuleRules(paths, [])), true); structuralFallback = true;
    }
  }
  const loaded: { map: ModuleMap; metrics?: SourceMetrics; cacheHit: boolean } = modulesPath
    ? await loadRuleMap({ repo: options.repo, configPath: modulesPath, base: base.sha, head: head.sha, changes: files, cacheDir: options.cacheDir || options.allowStructuralFallback ? path.join(cacheDir, 'module-index') : undefined, metricsCacheDir: cacheDir })
    : await loadGraph(options.mapPath ?? path.join(options.repo, 'graphify-out', 'graph.json'), options.repo, cacheDir);
  const result = overlay(loaded.map, files);
  const renamed = new Map(result.files.filter(file => file.status === 'renamed' && file.oldPath).map(file => [file.oldPath!, file.path]));
  const metrics = loaded.metrics ?? await sourceMetrics(options.repo, base.sha, head.sha, [...Object.keys(loaded.map.files).map(file => renamed.get(file) ?? file), ...result.files.map(file => file.path)], cacheDir);
  const unmapped = result.files.filter(file => file.moduleIds.includes('unmapped')).length;
  const warnings = modulesPath
    ? ['Module names and boundaries come from the supplied rules. Files are resolved from the selected head commit; deleted files retain their base-revision ownership under the same rules. Renamed files belong to their destination module.']
    : ['Module membership comes from the supplied Graphify map. Its revision has not been verified against this comparison.'];
  if (loaded.map.provenance.rulesSource === 'local') warnings.push('Rules are read from the local configuration because it is absent from the selected head commit. File contents still come from the compared commits.');
  if (loaded.map.provenance.rulesSource === 'external') warnings.push('Rules are read from the external configuration file.');
  if (structuralFallback) warnings.push('Starter module boundaries were derived from committed paths and cached externally. They are structural suggestions, not inferred business domains. No repository configuration was written.');
  if (modulesPath && loaded.map.provenance.unassigned) warnings.push(`${loaded.map.provenance.unassigned} files match no module rule and appear in Unassigned.`);
  if (modulesPath && loaded.map.provenance.ambiguous) warnings.push(`${loaded.map.provenance.ambiguous} files match equally specific module rules and appear in Unassigned.`);
  if (modulesPath && result.changes['diffslice-excluded']) warnings.push('Files excluded by the rules remain reviewable under Excluded changes when modified.');
  if (unmapped) warnings.push(`${unmapped} changed file${unmapped === 1 ? ' is' : 's are'} absent from the map and shown under Unmapped changes.`);
  return {
    schema: 1, id: createHash('sha256').update(`${base.sha}:${head.sha}:${loaded.map.fingerprint}`).digest('hex').slice(0, 20),
    repository: path.basename(options.repo), base, head, comparison: options.pr ? 'pull-request' : 'commits', pr: options.pr,
    map: loaded.map, ...result, metrics,
    totals: { files: result.files.length, modules: Object.keys(result.changes).filter(id => id !== 'unmapped').length, additions: files.reduce((sum, f) => sum + f.additions, 0), deletions: files.reduce((sum, f) => sum + f.deletions, 0), unmapped },
    timings: { prepareMs: Math.round(performance.now() - start), mapCacheHit: loaded.cacheHit }, warnings,
  };
}
