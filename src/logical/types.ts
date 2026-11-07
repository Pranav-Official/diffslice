export const AGENTS = ['claude-code', 'codex', 'opencode', 'pi'] as const;
export type AgentId = typeof AGENTS[number];
export type LogicalState = 'added' | 'changed' | 'removed' | 'context';
export interface EvidenceRef {
  id: string;
  path: string;
  side: 'base' | 'head';
  blob: string;
  lines: number;
  suppliedLines: number;
  ranges?: { start: number; end: number }[];
  omitted?: string;
}
export interface LogicalNode {
  id: string; area: string; title: string; state: LogicalState;
  summary: string; before: string; after: string; effect: string;
  purpose?: string; evidence: string[];
}
export interface LogicalEdge {
  id: string; from: string; to: string; label: string;
  state: LogicalState; evidence: string[];
}
export interface LogicalAnalysis {
  areas: { id: string; name: string }[];
  nodes: LogicalNode[];
  edges: LogicalEdge[];
}
export interface LogicalMap extends LogicalAnalysis {
  kind: 'diffslice-logical'; schema: 1;
  repository: string;
  base: string; head: string;
  comparison: 'commits' | 'pull-request';
  evidence: EvidenceRef[];
  changedPaths: string[];
  /** Renamed files (source → destination); a node citing either side covers the destination path. */
  renames?: { from: string; to: string }[];
  unclassified: string[];
  warnings: string[];
  provenance: {
    agent: AgentId; model: string; provider?: string; cliVersion: string;
    generatedAt: string; analysisVersion: number;
  };
}
export type LogicalVersion = 'changes' | 'before' | 'after';

const states = new Set(['added', 'changed', 'removed', 'context']);
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Logical map: expected an object.');
  return raw as Record<string, unknown>;
}
function text(raw: unknown, name: string, max = 1800): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/u.test(raw)) throw new Error(`Logical map: invalid ${name}.`);
  return raw;
}
function list(raw: unknown, name: string, max = 4000): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) throw new Error(`Logical map: invalid ${name}.`);
  return raw;
}
function id(raw: unknown): string {
  const value = text(raw, 'id', 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) throw new Error('Logical map: unsafe id.');
  return value;
}
function state(raw: unknown): LogicalState {
  if (typeof raw !== 'string' || !states.has(raw)) throw new Error('Logical map: invalid change state.');
  return raw as LogicalState;
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Logical map: duplicate id.');
  return items;
}
export function safeRepoPath(raw: unknown): string {
  const value = text(raw, 'evidence path', 2000);
  if (/^[a-z]:/i.test(value) || value.startsWith('/') || value.includes('\\') || value.split('/').some(p => !p || p === '..' || p === '.')) throw new Error('Logical map: unsafe evidence path.');
  return value;
}
export function isSafeRepoPath(raw: unknown): boolean {
  try { safeRepoPath(raw); return true; } catch { return false; }
}
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF\uFFFE\uFFFF]/gu;
// Agent output is repaired rather than rejected: strip unrepresentable characters and truncate over-long text.
function repair(raw: unknown, max: number): unknown {
  if (typeof raw !== 'string') return raw;
  const clean = raw.replace(unsafeText, '');
  return clean.length > max ? [...clean].slice(0, max - 1).join('') + '…' : clean;
}
/**
 * Validates analysis JSON. Without `report` any defect throws (imports, saved maps). With `report` (untrusted agent
 * output) defective items are repaired or dropped and described through `report`, so one bad node does not discard
 * every batch already paid for.
 */
export function validateAnalysis(raw: unknown, evidence: EvidenceRef[], report?: (message: string) => void): LogicalAnalysis {
  const value = object(raw); const knownEvidence = new Set(evidence.map(item => item.id));
  const fix = (v: unknown, max: number) => report ? repair(v, max) : v;
  // Strict: run and throw. Lenient: a failing item is dropped and reported.
  const attempt = <T,>(what: string, fn: () => T): T | undefined => {
    if (!report) return fn();
    try { return fn(); } catch (e: any) { report(`${what}: ${String(e.message).replace(/^Logical map: /, '')}`); }
  };
  const items = (raw: unknown, name: string, max: number): unknown[] => {
    if (report && Array.isArray(raw) && raw.length > max) { report(`${name}: truncated to ${max}`); return raw.slice(0, max); }
    return list(raw, name, max);
  };
  const refs = (raw: unknown) => items(raw, 'evidence references', 300).flatMap(ref => {
    const key = attempt('evidence reference', () => id(ref)); if (key === undefined) return [];
    if (!knownEvidence.has(key)) { if (report) { report(`unknown evidence ${key}`); return []; } throw new Error(`Logical map: unknown evidence ${key}.`); }
    return [key];
  });
  const firstOnly = <T extends { id: string }>(what: string, all: (T | undefined)[]): T[] => {
    const seen = new Set<string>(), kept: T[] = [];
    for (const item of all) {
      if (!item) continue;
      if (seen.has(item.id)) { if (report) { report(`${what} ${item.id}: duplicate id`); continue; } throw new Error('Logical map: duplicate id.'); }
      seen.add(item.id); kept.push(item);
    }
    return kept;
  };
  const areas = firstOnly('area', items(value.areas, 'areas', 100).map(raw => attempt('area', () => { const a = object(raw); return { id: id(a.id), name: text(fix(a.name, 100), 'area name', 100) }; })));
  const areaIds = new Set(areas.map(a => a.id));
  const nodes = firstOnly('capability', items(value.nodes, 'nodes', 1200).map(raw => attempt('capability', () => {
    const n = object(raw); const area = id(n.area);
    if (!areaIds.has(area)) throw new Error(`Logical map: unknown area ${area}.`);
    const node: LogicalNode = { id: id(n.id), area, title: text(fix(n.title, 100), 'capability title', 100), state: state(n.state), summary: text(fix(n.summary, 240), 'functional summary', 240), before: text(fix(n.before, 1800), 'before behavior'), after: text(fix(n.after, 1800), 'after behavior'), effect: text(fix(n.effect, 1800), 'functional effect'), evidence: [...new Set(refs(n.evidence))] };
    if (n.purpose !== undefined && n.purpose !== '') node.purpose = text(fix(n.purpose, 1800), 'inferred purpose');
    if (!node.evidence.length) throw new Error(`Logical map: ${node.id} has no evidence.`);
    return node;
  })));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = firstOnly('relationship', items(value.edges, 'edges', 2400).map(raw => attempt('relationship', () => {
    const e = object(raw); const from = id(e.from), to = id(e.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) throw new Error('Logical map: invalid relationship endpoint.');
    const edge = { id: id(e.id), from, to, label: text(fix(e.label, 100), 'relationship label', 100), state: state(e.state), evidence: [...new Set(refs(e.evidence))] };
    if (!edge.evidence.length) throw new Error('Logical map: relationship has no evidence.');
    return edge;
  })));
  const populated = new Set(nodes.map(n => n.area)), empty = areas.filter(a => !populated.has(a.id));
  if (empty.length && !report) throw new Error('Logical map: empty functional area.');
  for (const a of empty) report?.(`area ${a.id}: dropped because it has no capabilities`);
  return { areas: areas.filter(a => populated.has(a.id)), nodes, edges };
}
export function validateLogicalMap(raw: unknown): LogicalMap {
  const v = object(raw);
  if (v.kind !== 'diffslice-logical' || v.schema !== 1) throw new Error('Unsupported logical report schema. Use a compatible DiffSlice version.');
  const sha = (raw: unknown) => { const s = text(raw, 'commit SHA', 64); if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s)) throw new Error('Logical map: invalid full commit SHA.'); return s; };
  const evidence = unique(list(v.evidence, 'evidence', 12000).map(raw => {
    const e = object(raw);
    if (e.side !== 'base' && e.side !== 'head') throw new Error('Logical map: invalid evidence side.');
    if (!Number.isSafeInteger(e.lines) || Number(e.lines) < 0 || !Number.isSafeInteger(e.suppliedLines) || Number(e.suppliedLines) < 0 || Number(e.suppliedLines) > Number(e.lines)) throw new Error('Logical map: invalid evidence line count.');
    const ranges = e.ranges === undefined ? undefined : list(e.ranges, 'evidence ranges', 100).map(raw => { const r = object(raw); if (!Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || Number(r.start) < 1 || Number(r.end) < Number(r.start) || Number(r.end) > Number(e.lines)) throw new Error('Logical map: invalid evidence range.'); return { start: Number(r.start), end: Number(r.end) }; });
    return { id: id(e.id), path: safeRepoPath(e.path), side: e.side, blob: sha(e.blob), lines: Number(e.lines), suppliedLines: Number(e.suppliedLines), ...(ranges ? { ranges } : {}), ...(e.omitted ? { omitted: text(e.omitted, 'omission') } : {}) } as EvidenceRef;
  }));
  const analysis = validateAnalysis(v, evidence), p = object(v.provenance);
  if (!AGENTS.includes(p.agent as AgentId)) throw new Error('Logical map: unknown agent.');
  if (p.analysisVersion !== 1 || typeof p.generatedAt !== 'string' || !Number.isFinite(Date.parse(p.generatedAt))) throw new Error('Logical map: invalid provenance.');
  if (v.comparison !== 'commits' && v.comparison !== 'pull-request') throw new Error('Logical map: invalid comparison.');
  const changedPaths = list(v.changedPaths, 'changed paths', 4000).map(safeRepoPath);
  const known = new Set(changedPaths);
  const renames = v.renames === undefined ? [] : list(v.renames, 'renames', 4000).map(raw => {
    const r = object(raw), from = safeRepoPath(r.from), to = safeRepoPath(r.to);
    if (!known.has(to)) throw new Error('Logical map: rename target is not a changed path.');
    return { from, to };
  });
  const byId = new Map(evidence.map(e => [e.id, e.path]));
  const linked = new Set(analysis.nodes.flatMap(n => n.evidence).map(ref => byId.get(ref)!));
  // A base-side citation of a renamed file covers its destination path.
  for (const r of renames) if (linked.has(r.from)) linked.add(r.to);
  // Derive coverage rather than trusting an agent/importer's coverage claims.
  const unclassified = changedPaths.filter(p => !linked.has(p));
  return { kind: 'diffslice-logical', schema: 1, repository: text(v.repository, 'repository', 200), base: sha(v.base), head: sha(v.head), comparison: v.comparison, ...analysis, evidence, changedPaths, ...(renames.length ? { renames } : {}), unclassified, warnings: list(v.warnings, 'warnings', 100).map(w => text(w, 'warning')), provenance: { agent: p.agent as AgentId, model: text(p.model, 'model', 200), ...(p.provider ? { provider: text(p.provider, 'provider', 200) } : {}), cliVersion: text(p.cliVersion, 'CLI version', 200), generatedAt: p.generatedAt, analysisVersion: 1 } };
}
