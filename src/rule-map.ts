import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';
import { updateModuleIndex } from './module-index.js';
import { sourceMetrics } from './metrics.js';
import type { ChangedFile, ModuleMap, SourceMetrics } from './types.js';

export async function loadRuleMap(options: { repo: string; configPath: string; head: string; base: string; changes: Omit<ChangedFile, 'moduleIds'>[]; cacheDir?: string; metricsCacheDir: string }) {
  const relative = path.relative(options.repo, options.configPath).replace(/\\/g, '/');
  let rulesSource: 'head' | 'local' | 'external' = 'external'; let rulesText: string;
  if (!relative.startsWith('../') && !path.isAbsolute(relative)) {
    try { rulesText = await git(options.repo, ['show', `${options.head}:${relative}`]); rulesSource = 'head'; }
    catch (error) {
      try { rulesText = await readFile(options.configPath, 'utf8'); rulesSource = 'local'; }
      catch (localError: any) { if (localError.code === 'ENOENT') throw error; throw localError; }
    }
  } else rulesText = await readFile(options.configPath, 'utf8');
  const current = await updateModuleIndex({ repo: options.repo, configPath: options.configPath, revision: options.head, cacheDir: options.cacheDir, rulesText });
  const source = current.index;
  const modules: ModuleMap['modules'] = source.modules.map(module => ({ id: module.id, name: module.name, parentId: module.parent, files: [], symbols: 0, labelSource: 'rules' }));
  const byId = new Map(modules.map(module => [module.id, module]));
  const files: ModuleMap['files'] = Object.create(null);
  const include = (filename: string, id: string) => { files[filename] = [id]; byId.get(id)!.files.push(filename); };
  for (const [filename, file] of Object.entries(source.files)) include(filename, file.moduleId);
  // A deleted file retains its base-revision owner, using the current rules.
  // Renames use their destination owner so a physical file has exactly one home.
  const deleted = options.changes.filter(file => file.status === 'deleted');
  const base = deleted.length ? await updateModuleIndex({ ...options, configPath: options.configPath, revision: options.base, rulesText: current.rulesText }) : undefined;
  const excluded = { id: 'diffslice-excluded', name: 'Excluded changes', files: [] as string[], symbols: 0, labelSource: 'rules' as const };
  if (byId.has(excluded.id)) throw new Error('Module id diffslice-excluded is reserved for excluded changed files.');
  byId.set(excluded.id, excluded);
  for (const change of options.changes) if (!Object.hasOwn(files, change.path)) {
    const original = base?.index.files[change.path];
    include(change.path, original?.moduleId ?? excluded.id);
  }
  if (excluded.files.length) modules.push(excluded);
  const map: ModuleMap = {
    schema: 1, fingerprint: createHash('sha256').update(`${source.tree}:${source.rulesHash}:${options.base}`).digest('hex'),
    modules, files, links: [],
    provenance: { kind: 'rules', path: options.configPath, generatedAt: new Date().toISOString(), revision: options.head, revisionVerified: true, rulesHash: source.rulesHash, rulesSource, nodes: Object.keys(files).length, edges: 0, unassigned: current.stats.unassigned.length, ambiguous: current.stats.ambiguous.length },
  };
  const metrics: SourceMetrics = { files: Object.create(null), totalLines: 0, measuredFiles: 0, unavailableFiles: 0, cacheHit: current.stats.cacheHit && (!base || base.stats.cacheHit) };
  const missing: string[] = [];
  for (const filename of Object.keys(files)) {
    const metric = source.files[filename]?.metric ?? base?.index.files[filename]?.metric;
    if (metric) metrics.files[filename] = metric; else missing.push(filename);
  }
  if (missing.length) {
    const extra = await sourceMetrics(options.repo, options.base, options.head, missing, options.metricsCacheDir);
    Object.assign(metrics.files, extra.files); metrics.cacheHit &&= extra.cacheHit;
  }
  for (const metric of Object.values(metrics.files)) { metrics.totalLines += metric.lines; if (metric.available) metrics.measuredFiles++; else metrics.unavailableFiles++; }
  return { map, metrics, cacheHit: current.stats.cacheHit };
}
