import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Module, ModuleMap } from './types.js';

type RawNode = { id: string | number; source_file?: string; community?: string | number; community_name?: string; label?: string; repo?: string };
type RawEdge = { source: string | number | { id: string }; target: string | number | { id: string }; weight?: number };
const endpoint = (value: RawEdge['source']) => String(typeof value === 'object' ? value.id : value);

export function normalizeSource(raw: string, repo: string): string | null {
  let value = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const root = repo.replace(/\\/g, '/').replace(/\/$/, '');
  if (value.toLowerCase().startsWith(`${root.toLowerCase()}/`)) value = value.slice(root.length + 1);
  else if (path.isAbsolute(value) || /^[A-Za-z]:\//.test(value)) return null;
  value = path.posix.normalize(value);
  if (!value || value === '.' || value === '..' || value.startsWith('../')) return null;
  return value;
}

function readableName(files: string[]): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parent = path.posix.dirname(file);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Unassigned';
  if (top === '.') return path.posix.basename(files[0] ?? 'Root files');
  return top.replace(/^(?:packages|apps|tools)\//, '').replace(/\/src(?=\/|$)/, '').replace(/^src\//, '');
}

export function normalizeGraph(raw: unknown, repo: string, mapPath: string, generatedAt: string, fingerprint: string): ModuleMap {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).nodes)) throw new Error('Invalid Graphify graph: expected a nodes array. Generate it with graphify extract <repo> --code-only.');
  const graph = raw as { nodes: RawNode[]; links?: RawEdge[]; edges?: RawEdge[]; graph?: Record<string, unknown>; built_at_commit?: string };
  const edges = graph.links ?? graph.edges ?? [];
  if (!Array.isArray(edges)) throw new Error('Invalid Graphify graph: links must be an array.');
  const modules = new Map<string, { files: Set<string>; symbols: number; labels: Map<string, number> }>();
  const membership = new Map<string, string>();
  const fileModules = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (!node || node.id === undefined || typeof node.source_file !== 'string') continue;
    const file = normalizeSource(node.source_file, repo);
    if (!file) continue;
    const id = node.community === undefined || node.community === null ? 'unassigned' : `community:${node.community}`;
    let entry = modules.get(id);
    if (!entry) modules.set(id, entry = { files: new Set(), symbols: 0, labels: new Map() });
    entry.files.add(file); entry.symbols++;
    if (typeof node.community_name === 'string' && !/^Community\s+\d+$/i.test(node.community_name)) entry.labels.set(node.community_name, (entry.labels.get(node.community_name) ?? 0) + 1);
    membership.set(String(node.id), id);
    if (!fileModules.has(file)) fileModules.set(file, new Set());
    fileModules.get(file)!.add(id);
  }
  const normalized: Module[] = [...modules].map(([id, entry]): Module => {
    const files = [...entry.files].sort();
    const label = [...entry.labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    return { id, name: id === 'unassigned' ? 'Unassigned symbols' : label ?? readableName(files), labelSource: label ? 'graphify' : 'source-path', files, symbols: entry.symbols };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const names = new Map<string, number>();
  for (const module of normalized) names.set(module.name, (names.get(module.name) ?? 0) + 1);
  for (const module of normalized) if (names.get(module.name)! > 1) module.name += ` · ${module.id.replace('community:', '')}`;
  const links = new Map<string, { source: string; target: string; count: number }>();
  for (const edge of edges) {
    const source = membership.get(endpoint(edge.source)); const target = membership.get(endpoint(edge.target));
    if (!source || !target || source === target) continue;
    const key = JSON.stringify([source, target]);
    const link = links.get(key) ?? { source, target, count: 0 }; link.count++; links.set(key, link);
  }
  return {
    schema: 1, fingerprint, modules: normalized,
    files: Object.fromEntries([...fileModules].sort().map(([file, ids]) => [file, [...ids].sort()])),
    links: [...links.values()].sort((a, b) => b.count - a.count),
    provenance: { path: mapPath, generatedAt, version: String(graph.graph?.graphify_version ?? '') || undefined, revision: graph.built_at_commit, revisionVerified: false, nodes: graph.nodes.length, edges: edges.length },
  };
}

export async function loadGraph(mapPath: string, repo: string, cacheDir: string): Promise<{ map: ModuleMap; cacheHit: boolean }> {
  let info;
  try { info = await stat(mapPath); } catch { throw new Error(`Graphify map not found: ${mapPath}\nRun graphify extract "${repo}" --code-only, or pass --map <graph.json>. DiffSlice never runs the indexer.`); }
  const key = createHash('sha256').update(JSON.stringify([3, mapPath, repo, info.size, info.mtimeMs])).digest('hex');
  const cache = path.join(cacheDir, 'maps', `${key}.json`);
  try { const map = JSON.parse(await readFile(cache, 'utf8')); if (map.schema === 1) return { map, cacheHit: true }; } catch { /* missing or corrupt derived cache */ }
  const text = await readFile(mapPath, 'utf8');
  const fingerprint = createHash('sha256').update(text).digest('hex');
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Graphify map is not valid JSON: ${mapPath}. Wait for Graphify to finish writing it.`); }
  const map = normalizeGraph(data, repo, mapPath, info.mtime.toISOString(), fingerprint);
  try {
    await mkdir(path.dirname(cache), { recursive: true });
    const temporary = `${cache}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(map)); await rename(temporary, cache);
  } catch { /* read-only repository: caching is optional */ }
  return { map, cacheHit: false };
}
