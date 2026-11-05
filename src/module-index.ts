import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';
import { readBlobMetrics } from './metrics.js';
import type { FileMetric } from './types.js';

export interface Definition { id: string; name: string; description?: string; include?: string[]; children?: Definition[] }
export interface ModuleRules { schema: 1; exclude?: string[]; modules: Definition[] }
export interface Rule { id: string; name: string; parent?: string; depth: number; patterns: RegExp[] }
interface IndexedFile { blob: string; moduleId: string; candidates?: string[]; metric: FileMetric }
export interface ModuleIndex {
  schema: 1; tree: string; rulesHash: string;
  modules: { id: string; name: string; parent?: string; files: number; lines: number }[];
  files: Record<string, IndexedFile>;
  blobs: Record<string, Omit<FileMetric, 'available'>>;
}

// Deliberately small rule vocabulary: *, ** and ?. A **/ also matches zero directories.
function glob(pattern: string): RegExp {
  if (!pattern || pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').includes('..')) throw new Error(`Invalid repository-relative module pattern: ${pattern}`);
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++; if (pattern[i + 1] === '/') { expression += '(?:.*/)?'; i++; } else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}
export function compileModuleRules(raw: unknown): { rules: Rule[]; exclude: RegExp[] } {
  const config = raw as ModuleRules;
  if (config?.schema !== 1 || !Array.isArray(config.modules)) throw new Error('Module config needs schema: 1 and a modules array.');
  const rules: Rule[] = []; const ids = new Set<string>(['unassigned']);
  const patterns = (values: unknown): RegExp[] => {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.some(p => typeof p !== 'string')) throw new Error('Module include/exclude rules must be arrays of glob strings.');
    return values.map(glob);
  };
  const visit = (definitions: Definition[], depth: number, parent?: string) => {
    for (const definition of definitions) {
      if (!definition || typeof definition.id !== 'string' || !/^[\w.-]+$/.test(definition.id) || ids.has(definition.id) || typeof definition.name !== 'string' || !definition.name.trim()) throw new Error('Each module needs a unique id and a nonempty name; unassigned is reserved.');
      ids.add(definition.id);
      rules.push({ id: definition.id, name: definition.name, depth, parent, patterns: patterns(definition.include) });
      if (definition.children !== undefined) {
        if (!Array.isArray(definition.children)) throw new Error('Module children must be an array.');
        visit(definition.children, depth + 1, definition.id);
      }
    }
  };
  visit(config.modules, 0);
  return { rules, exclude: patterns(config.exclude) };
}

export function assignModule(rules: Rule[], filename: string): { moduleId: string; candidates?: string[] } {
  const matches = rules.filter(rule => rule.patterns.some(pattern => pattern.test(filename)));
  const deepest = matches.length ? Math.max(...matches.map(rule => rule.depth)) : -1;
  const candidates = matches.filter(rule => rule.depth === deepest).map(rule => rule.id);
  return { moduleId: candidates.length === 1 ? candidates[0] : 'unassigned', ...(candidates.length > 1 ? { candidates } : {}) };
}

export async function updateModuleIndex(options: { repo: string; configPath?: string; cacheDir?: string; revision?: string; rulesText?: string }) {
  const started = performance.now(); const { repo } = options;
  const configPath = options.configPath ?? path.join(repo, 'diffslice.modules.json');
  const [snapshot, gitDirectory] = await Promise.all([
    options.revision ? git(repo, ['rev-parse', '--verify', '--end-of-options', `${options.revision}^{tree}`]) : git(repo, ['write-tree']),
    options.cacheDir ? Promise.resolve(options.cacheDir) : git(repo, ['rev-parse', '--git-path', 'diffslice']),
  ]);
  const tree = snapshot.trim();
  const relativeConfig = path.relative(repo, configPath).replace(/\\/g, '/');
  const configText = options.rulesText ?? (relativeConfig.startsWith('../') || path.isAbsolute(relativeConfig)
    ? await readFile(configPath, 'utf8')
    : await git(repo, ['show', `${tree}:${relativeConfig}`]));
  const { rules, exclude } = compileModuleRules(JSON.parse(configText));
  const rulesHash = createHash('sha256').update(configText).digest('hex');
  // write-tree snapshots the INDEX, not working files, and fails on unresolved merges.
  // Its object ID is valid before a commit exists, including an unborn branch.
  const directory = path.resolve(repo, gitDirectory.trim());
  const cachePath = path.join(directory, options.revision ? `modules-tree-${tree}-${rulesHash}.json` : 'modules-index-v1.json');
  let previous: ModuleIndex | undefined;
  try { const value = JSON.parse(await readFile(cachePath, 'utf8')); if (value.schema === 1 && value.files && value.blobs) previous = value; } catch { /* initial cache */ }
  // A pre-commit cache can seed a committed-tree review, preserving its measured blobs.
  if (!previous && options.revision) {
    try { const value = JSON.parse(await readFile(path.join(directory, 'modules-index-v1.json'), 'utf8')); if (value.schema === 1 && value.files && value.blobs) previous = value; } catch { /* no hook cache */ }
  }
  if (previous?.tree === tree && previous.rulesHash === rulesHash) return report(previous, 0, 0, true);
  const text = await git(repo, ['ls-tree', '-r', '-z', '--full-tree', tree]);
  const files: Record<string, IndexedFile> = Object.create(null);
  const blobs = { ...previous?.blobs };
  let changedPaths = 0;
  for (const record of text.split('\0')) {
    const tab = record.indexOf('\t'); if (tab < 0) continue;
    const [mode, type, blob] = record.slice(0, tab).split(' '); const filename = record.slice(tab + 1);
    // Symlinks and submodules are metadata, rather than source file contents.
    if (type !== 'blob' || mode === '120000' || exclude.some(pattern => pattern.test(filename))) continue;
    const old = previous?.files[filename];
    if (old?.blob === blob && previous?.rulesHash === rulesHash) { files[filename] = old; continue; }
    changedPaths++;
    files[filename] = { blob, ...assignModule(rules, filename), metric: { lines: 0, bytes: 0, binary: false, available: true } };
  }
  changedPaths += Object.keys(previous?.files ?? {}).filter(filename => !Object.hasOwn(files, filename)).length;
  const missing = [...new Set(Object.values(files).map(file => file.blob))].filter(blob => !Object.hasOwn(blobs, blob));
  Object.assign(blobs, await readBlobMetrics(repo, missing));
  for (const file of Object.values(files)) file.metric = { ...blobs[file.blob], available: true };
  const modules: ModuleIndex['modules'] = [...rules.map(({ id, name, parent }) => ({ id, name, parent, files: 0, lines: 0 })), { id: 'unassigned', name: 'Unassigned', files: 0, lines: 0 }];
  const byId = new Map(modules.map(module => [module.id, module]));
  for (const file of Object.values(files)) {
    let module = byId.get(file.moduleId);
    while (module) { module.files++; module.lines += file.metric.lines; module = module.parent ? byId.get(module.parent) : undefined; }
  }
  const index: ModuleIndex = { schema: 1, tree, rulesHash, modules, files, blobs };
  await mkdir(directory, { recursive: true });
  const temporary = `${cachePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(index)); await rename(temporary, cachePath);
  return report(index, changedPaths, missing.length, false);

  function report(index: ModuleIndex, changedPaths: number, measuredBlobs: number, cacheHit: boolean) {
    return { index, cachePath, configPath, rulesText: configText, stats: { elapsedMs: Math.round(performance.now() - started), changedPaths, measuredBlobs, cacheHit, files: Object.keys(index.files).length, unassigned: Object.entries(index.files).filter(([, file]) => file.moduleId === 'unassigned' && !file.candidates).map(([name]) => name), ambiguous: Object.entries(index.files).filter(([, file]) => file.candidates).map(([name, file]) => ({ path: name, candidates: file.candidates })) } };
  }
}
