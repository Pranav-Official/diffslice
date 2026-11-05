import type { ChangedFile, FileStatus, Review } from './types.js';

export type MapMode = 'modules' | 'directories';
export interface TreeNode {
  id: string; name: string; kind: 'root' | 'module' | 'directory' | 'file';
  path?: string; moduleId?: string; fileId?: string;
  status?: FileStatus;
  loc: number; area: number; files: number; changed: number; additions: number; deletions: number;
  children: TreeNode[];
}
const node = (id: string, name: string, kind: TreeNode['kind']): TreeNode => ({ id, name, kind, loc: 0, area: 0, files: 0, changed: 0, additions: 0, deletions: 0, children: [] });

function commonDirectory(paths: string[]): string {
  if (!paths.length) return '';
  const parts = paths[0].split('/').slice(0, -1); let length = parts.length;
  for (const path of paths) { const candidate = path.split('/').slice(0, -1); let i = 0; while (i < length && parts[i] === candidate[i]) i++; length = i; }
  return parts.slice(0, length).join('/');
}
function rollup(root: TreeNode): void {
  if (!root.children.length) return;
  for (const child of root.children) rollup(child);
  for (const key of ['loc', 'area', 'files', 'changed', 'additions', 'deletions'] as const) root[key] = root.children.reduce((total, child) => total + child[key], 0);
  root.children.sort((a, b) => b.area - a.area || a.name.localeCompare(b.name));
}
function populate(root: TreeNode, paths: string[], review: Review, changes: Map<string, ChangedFile>, prefix = '', apportioned = false, flat = false): void {
  const directories = new Map<string, TreeNode>([['', root]]);
  for (const path of [...new Set(paths)].sort()) {
    const relative = prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;
    const parts = relative.split('/'); let parent = root; let directory = '';
    for (const part of flat ? [] : parts.slice(0, -1)) {
      directory = directory ? `${directory}/${part}` : part;
      let entry = directories.get(directory);
      if (!entry) { entry = node(`${root.id}/dir:${directory}`, part, 'directory'); entry.path = prefix ? `${prefix}/${directory}` : directory; entry.moduleId = root.moduleId; directories.set(directory, entry); parent.children.push(entry); }
      parent = entry;
    }
    const leaf = node(`${root.id}/file:${path}`, parts.at(-1)!, 'file');
    const metric = Object.hasOwn(review.metrics.files, path) ? review.metrics.files[path] : undefined;
    const change = changes.get(path);
    leaf.path = path; leaf.fileId = change?.id; leaf.moduleId = root.moduleId; leaf.status = change?.status;
    leaf.loc = metric?.lines ?? 0;
    const count = Object.hasOwn(review.map.files, path) ? Math.max(1, review.map.files[path].length) : Math.max(1, change?.moduleIds.length ?? 1);
    leaf.area = Math.max(1, leaf.loc) / (apportioned ? count : 1);
    leaf.files = 1; leaf.changed = change ? 1 : 0; leaf.additions = change?.additions ?? 0; leaf.deletions = change?.deletions ?? 0;
    parent.children.push(leaf);
  }
  rollup(root);
}

export function buildHierarchy(review: Review, mode: MapMode): TreeNode {
  const root = node(mode, review.repository, 'root');
  const changes = new Map(review.files.map(file => [file.path, file]));
  const renamed = new Map(review.files.filter(file => file.status === 'renamed' && file.oldPath).map(file => [file.oldPath!, file.path]));
  const paths = [...new Set([...Object.keys(review.map.files).map(file => renamed.get(file) ?? file), ...review.files.map(file => file.path)])];
  if (mode === 'directories') populate(root, paths, review, changes);
  else if (review.map.provenance.kind === 'rules') {
    const entries = new Map(review.map.modules.map(module => {
      const entry = node(`module:${module.id}`, module.name, 'module'); entry.moduleId = module.id;
      const nested = review.map.modules.some(child => child.parentId === module.id);
      const container = nested && module.files.length ? node(`${entry.id}/other`, 'Other files', 'directory') : entry;
      container.moduleId = module.id;
      populate(container, module.files, review, changes, commonDirectory(module.files), false, !nested && module.files.length <= 12);
      if (container !== entry) entry.children.push(container);
      return [module.id, entry] as const;
    }));
    for (const module of review.map.modules) {
      const parent = module.parentId ? entries.get(module.parentId) : root;
      (parent ?? root).children.push(entries.get(module.id)!);
    }
    rollup(root);
    const prune = (entry: TreeNode) => { entry.children = entry.children.filter(child => child.files > 0); entry.children.forEach(prune); };
    prune(root);
  }
  else {
    const modules = [...review.map.modules, ...(review.changes.unmapped ? [{ id: 'unmapped', name: 'Unmapped changes', files: review.files.filter(file => file.moduleIds.includes('unmapped')).map(file => file.path) }] : [])];
    for (const module of modules) {
      const entry = node(`module:${module.id}`, module.name, 'module'); entry.moduleId = module.id;
      // Use current rename paths for one physical file, retaining upstream memberships.
      const modulePaths = [...new Set(module.files.map(path => review.files.find(file => file.status === 'renamed' && file.oldPath === path)?.path ?? path))];
      populate(entry, modulePaths, review, changes, commonDirectory(modulePaths), true);
      if (entry.children.length) root.children.push(entry);
    }
    rollup(root);
    root.loc = review.metrics.totalLines; root.files = paths.length; root.changed = review.totals.files; root.additions = review.totals.additions; root.deletions = review.totals.deletions;
  }
  return root;
}
export function findTrail(root: TreeNode, id: string): TreeNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) { const result = findTrail(child, id); if (result) return [root, ...result]; }
  return null;
}
export function fileTrail(root: TreeNode, filePath: string): TreeNode[] | null {
  if (root.kind === 'file' && root.path === filePath) return [root];
  for (const child of root.children) { const result = fileTrail(child, filePath); if (result) return [root, ...result]; }
  return null;
}
export function collectNodes(root: TreeNode): TreeNode[] { return [root, ...root.children.flatMap(collectNodes)]; }
export function visibleTree(root: TreeNode, changedOnly: boolean): TreeNode {
  if (!changedOnly) return root;
  return { ...root, children: root.children.filter(child => child.changed > 0).map(child => visibleTree(child, true)) };
}
export function buildChangedTree(review: Review): TreeNode {
  const root = node('changes', 'Changed files', 'root');
  populate(root, review.files.map(file => file.path), review, new Map(review.files.map(file => [file.path, file])));
  return root;
}
