import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git.js';
import { assignModule, compileModuleRules, updateModuleIndex, type Definition, type ModuleRules } from './module-index.js';

const EXCLUDE = [
  '.agents/**', '.claude/**', '.codex/**', '.opencode/**', '.pi/**',
  '**/node_modules/**', '**/vendor/**', '**/.venv/**', '**/venv/**',
  '**/dist/**', '**/build/**', '**/target/**', '**/obj/**', '**/__pycache__/**',
  '**/coverage/**', '**/.next/**', '**/.nuxt/**', '**/.turbo/**',
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/Cargo.lock',
  '**/poetry.lock', '**/uv.lock', '**/composer.lock', '**/Gemfile.lock',
];
const CONTAINERS = new Set(['packages', 'apps', 'services', 'tools', 'crates', 'modules', 'libs', 'plugins']);
const MANIFESTS = new Map([
  ['package.json', 'JavaScript package'], ['Cargo.toml', 'Rust package'], ['pyproject.toml', 'Python project'],
  ['setup.py', 'Python project'], ['setup.cfg', 'Python project'], ['go.mod', 'Go module'],
  ['pom.xml', 'Java project'], ['build.gradle', 'Gradle project'], ['build.gradle.kts', 'Gradle project'],
  ['composer.json', 'PHP package'], ['Gemfile', 'Ruby project'], ['mix.exs', 'Elixir project'],
  ['Package.swift', 'Swift package'], ['CMakeLists.txt', 'CMake project'],
]);
const NAMES: Record<string, string> = { src: 'Source', lib: 'Library', app: 'Application', web: 'Web application', test: 'Tests', tests: 'Tests', docs: 'Documentation', scripts: 'Scripts', internal: 'Internal packages', cmd: 'Commands', '.github': 'GitHub automation', '.vscode': 'VS Code settings' };
function readable(value: string): string {
  if (Object.hasOwn(NAMES, value)) return NAMES[value];
  return value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim().split(/\s+/).map(word => /^(api|cli|ui|mcp|sdk|http|sql|css|js|ts)$/i.test(word) ? word.toUpperCase() : word[0]?.toUpperCase() + word.slice(1)).join(' ') || 'Files';
}
interface Area { directory: string; name: string; reason: string; filesOnly?: boolean }
interface Manifest { directory: string; file: string; kind: string; name?: string }
export interface InitGroup { id: string; name: string; reason: string; files: number; children: InitGroup[] }

async function manifestInfo(repo: string, file: string, kind: string): Promise<Manifest | null> {
  const absolute = path.join(repo, file);
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.size > 1024 * 1024) return null;
  // Parse metadata only. Never import a project, run its scripts, or follow manifest symlinks.
  const text = await readFile(absolute, 'utf8'); let name: string | undefined;
  try {
    if (file.endsWith('package.json') || file.endsWith('composer.json')) {
      const value = JSON.parse(text).name; if (typeof value === 'string') name = value.split('/').at(-1);
    } else if (/\.(csproj|fsproj|vbproj)$/.test(file)) name = path.posix.basename(file).replace(/\.[^.]+$/, '');
    else if (file.endsWith('Cargo.toml') || file.endsWith('pyproject.toml')) {
      const section = text.match(file.endsWith('Cargo.toml') ? /\[package\]([^]*?)(?=\n\[|$)/ : /\[project\]([^]*?)(?=\n\[|$)/)?.[1];
      name = section?.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
    }
  } catch { /* The filename still supplies a boundary when optional metadata is invalid. */ }
  if (name && (name.length > 120 || /[\x00-\x1f]/.test(name))) name = undefined;
  const directory = path.posix.dirname(file);
  return { directory: directory === '.' ? '' : directory, file, kind, name };
}

export function planModuleRules(files: string[], manifests: Manifest[]): ModuleRules {
  const areas = new Map<string, Area>();
  const directoryFiles = (directory: string) => files.filter(file => file.startsWith(`${directory}/`));
  const directDirectories = (directory: string) => [...new Set(directoryFiles(directory).map(file => file.slice(directory.length + 1).split('/')).filter(parts => parts.length > 1).map(parts => `${directory}/${parts[0]}`))].sort();
  const add = (area: Area) => { if (!areas.has(area.directory)) areas.set(area.directory, area); };
  const top = [...new Set(files.filter(file => file.includes('/')).map(file => file.split('/')[0]))].sort();
  for (const directory of top) {
    if (CONTAINERS.has(directory) && !manifests.some(manifest => manifest.directory === directory)) {
      for (const child of directDirectories(directory)) add({ directory: child, name: readable(path.posix.basename(child)), reason: `Directory ${child}/ inside the ${directory}/ container.` });
      if (directoryFiles(directory).some(file => !file.slice(directory.length + 1).includes('/'))) add({ directory, name: `${readable(directory)} files`, filesOnly: true, reason: `Files directly inside ${directory}/, outside its child projects.` });
    } else add({ directory, name: readable(directory), reason: `Top-level directory ${directory}/.` });
  }
  for (const manifest of manifests) if (manifest.directory) areas.set(manifest.directory, { directory: manifest.directory, name: readable(manifest.name ?? path.posix.basename(manifest.directory)), reason: `Detected ${manifest.kind} from ${manifest.file}${manifest.name ? ` (name: ${manifest.name})` : ''}.` });
  // Bounded structural suggestions: two source-folder layers, at least two files per area.
  // This deliberately avoids claiming that directory names establish business domains.
  for (const project of ['', ...manifests.map(manifest => manifest.directory).filter(Boolean)]) {
    for (const source of ['src', 'lib']) {
      const prefix = project ? `${project}/${source}` : source;
      const candidates = directDirectories(prefix).filter(directory => directoryFiles(directory).length >= 2);
      for (const directory of candidates.slice(0, 12)) {
        add({ directory, name: readable(path.posix.basename(directory)), reason: `Source directory ${directory}/ contains ${directoryFiles(directory).length} files. Review this suggested boundary.` });
        for (const nested of directDirectories(directory).filter(candidate => directoryFiles(candidate).length >= 2).slice(0, 12)) add({ directory: nested, name: readable(path.posix.basename(nested)), reason: `Nested source directory ${nested}/ contains ${directoryFiles(nested).length} files.` });
      }
    }
    if (project) {
      const tests = ['test', 'tests'].map(name => `${project}/${name}`).filter(directory => directoryFiles(directory).length >= 2);
      for (const directory of tests) add({ directory, name: readable(path.posix.basename(directory)), reason: `Tests inside ${project}/ remain nested under their project.` });
    }
  }
  const definitions = new Map<string, Definition>();
  const id = (directory: string) => `area-${directory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${createHash('sha256').update(directory).digest('hex').slice(0, 8)}`;
  for (const area of areas.values()) {
    // Literal * and ? in POSIX directory names cannot be represented by this rule vocabulary.
    if (/[*?\\]/.test(area.directory)) continue;
    definitions.set(area.directory, { id: id(area.directory), name: area.name, description: area.reason, include: [`${area.directory}/${area.filesOnly ? '*' : '**'}`] });
  }
  const modules: Definition[] = [];
  for (const [directory, definition] of definitions) {
    const parent = [...definitions.keys()].filter(candidate => !areas.get(candidate)?.filesOnly && directory.startsWith(`${candidate}/`)).sort((a, b) => b.length - a.length)[0];
    if (parent) (definitions.get(parent)!.children ??= []).push(definition); else modules.push(definition);
  }
  const sort = (items: Definition[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const duplicates = new Map<string, number>(); for (const item of items) duplicates.set(item.name, (duplicates.get(item.name) ?? 0) + 1);
    for (const item of items) { if (duplicates.get(item.name)! > 1) item.name += ` (${[...definitions].find(([, value]) => value === item)?.[0]})`; if (item.children) sort(item.children); }
  };
  sort(modules);
  modules.push({ id: 'repository-files', name: 'Repository files', description: 'Files at the repository root, including new root configuration files.', include: ['*'] });
  return { schema: 1, exclude: [...EXCLUDE], modules };
}

export async function initializeModules(options: { repo: string; dryRun?: boolean; cacheDir?: string }) {
  const started = performance.now(); const output = path.join(options.repo, 'diffslice.modules.json');
  const [listed, deleted] = await Promise.all([
    git(options.repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
    git(options.repo, ['ls-files', '--deleted', '-z']),
  ]);
  const removed = new Set(deleted.split('\0'));
  const discovered = [...new Set(listed.split('\0').filter(file => file && !removed.has(file)))].sort();
  const defaultExcludes = compileModuleRules({ schema: 1, exclude: EXCLUDE, modules: [] }).exclude;
  const included = discovered.filter(file => !defaultExcludes.some(pattern => pattern.test(file)));
  let config: ModuleRules | undefined; let status: 'created' | 'existing' | 'dry-run' = options.dryRun ? 'dry-run' : 'created';
  try { config = JSON.parse(await readFile(output, 'utf8')); compileModuleRules(config); status = 'existing'; }
  catch (error: any) { if (error.code !== 'ENOENT') throw new Error(`Cannot read existing module rules: ${error.message}`); }
  const manifests = config ? [] : (await Promise.all(included.map(file => {
    const kind = MANIFESTS.get(path.posix.basename(file)) ?? (/\.(csproj|fsproj|vbproj)$/.test(file) ? '.NET project' : undefined);
    return kind ? manifestInfo(options.repo, file, kind) : Promise.resolve(null);
  }))).filter((manifest): manifest is Manifest => manifest !== null);
  config ??= planModuleRules(included, manifests);
  const compiled = compileModuleRules(config); const counts = new Map<string, number>();
  const unassigned: string[] = []; const ambiguous: { path: string; candidates: string[] }[] = []; let excluded = 0;
  for (const file of discovered) {
    if (compiled.exclude.some(pattern => pattern.test(file))) { excluded++; continue; }
    const assignment = assignModule(compiled.rules, file);
    if (assignment.candidates) ambiguous.push({ path: file, candidates: assignment.candidates });
    else if (assignment.moduleId === 'unassigned') unassigned.push(file);
    else {
      let rule = compiled.rules.find(candidate => candidate.id === assignment.moduleId);
      while (rule) { counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1); rule = rule.parent ? compiled.rules.find(candidate => candidate.id === rule!.parent) : undefined; }
    }
  }
  const groups = (definitions: Definition[]): InitGroup[] => definitions.map(definition => ({ id: definition.id, name: definition.name, reason: definition.description ?? 'Existing user-defined rule.', files: counts.get(definition.id) ?? 0, children: groups(definition.children ?? []) }));
  const rulesText = `${JSON.stringify(config, null, 2)}\n`;
  let cache: { status: 'ready' | 'skipped' | 'failed'; files?: number; lines?: number; reason?: string } = { status: 'skipped', reason: status === 'dry-run' ? 'Preview does not write a cache.' : 'Existing rules are preserved; comparisons refresh their cache when needed.' };
  if (status === 'created') {
    try { await writeFile(output, rulesText, { flag: 'wx' }); }
    catch (error: any) { if (error.code === 'EEXIST') throw new Error('Module rules appeared during initialization; left them untouched. Run init again to inspect them.'); throw error; }
    let head: string | undefined;
    try { head = (await git(options.repo, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])).trim(); }
    catch { cache = { status: 'skipped', reason: 'No readable HEAD commit yet; source measurements will be cached at first comparison.' }; }
    if (head) {
      try {
        const warmed = await updateModuleIndex({ repo: options.repo, revision: head, configPath: output, rulesText, cacheDir: options.cacheDir ? path.join(options.cacheDir, 'module-index') : undefined });
        cache = { status: 'ready', files: Object.keys(warmed.index.files).length, lines: Object.values(warmed.index.files).reduce((sum, file) => sum + file.metric.lines, 0) };
      } catch (error: any) { cache = { status: 'failed', reason: `Rules were saved, but cache preparation failed: ${error.message}` }; }
    }
  }
  return { status, output, config, groups: groups(config.modules), cache, stats: { elapsedMs: Math.round(performance.now() - started), discoveredFiles: discovered.length, includedFiles: discovered.length - excluded, excludedFiles: excluded, detectedProjects: manifests.length }, unassigned, ambiguous, note: 'Suggestions use manifests and directories, not inferred business responsibilities. Edit names and boundaries to match your architecture.' };
}
