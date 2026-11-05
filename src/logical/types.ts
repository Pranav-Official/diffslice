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
export function validateAnalysis(raw: unknown, evidence: EvidenceRef[]): LogicalAnalysis {
  const value = object(raw); const knownEvidence = new Set(evidence.map(item => item.id));
  const refs = (raw: unknown) => list(raw, 'evidence references', 300).map(ref => {
    const key = id(ref); if (!knownEvidence.has(key)) throw new Error(`Logical map: unknown evidence ${key}.`); return key;
  });
  const areas = unique(list(value.areas, 'areas', 100).map(raw => { const a = object(raw); return { id: id(a.id), name: text(a.name, 'area name', 100) }; }));
  const areaIds = new Set(areas.map(a => a.id));
  const nodes = unique(list(value.nodes, 'nodes', 1200).map(raw => {
    const n = object(raw); const area = id(n.area);
    if (!areaIds.has(area)) throw new Error(`Logical map: unknown area ${area}.`);
    const node: LogicalNode = { id: id(n.id), area, title: text(n.title, 'capability title', 100), state: state(n.state), summary: text(n.summary, 'functional summary', 240), before: text(n.before, 'before behavior'), after: text(n.after, 'after behavior'), effect: text(n.effect, 'functional effect'), evidence: refs(n.evidence) };
    if (n.purpose !== undefined && n.purpose !== '') node.purpose = text(n.purpose, 'inferred purpose');
    if (!node.evidence.length) throw new Error(`Logical map: ${node.id} has no evidence.`);
    return node;
  }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = unique(list(value.edges, 'edges', 2400).map(raw => {
    const e = object(raw); const from = id(e.from), to = id(e.to);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) throw new Error('Logical map: invalid relationship endpoint.');
    const edge = { id: id(e.id), from, to, label: text(e.label, 'relationship label', 100), state: state(e.state), evidence: refs(e.evidence) };
    if (!edge.evidence.length) throw new Error('Logical map: relationship has no evidence.');
    return edge;
  }));
  if (areas.some(a => !nodes.some(n => n.area === a.id))) throw new Error('Logical map: empty functional area.');
  return { areas, nodes, edges };
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
  const linked = new Set(analysis.nodes.flatMap(n => n.evidence).map(ref => evidence.find(e => e.id === ref)!.path));
  // Derive coverage rather than trusting an agent/importer's coverage claims.
  const unclassified = changedPaths.filter(p => !linked.has(p));
  return { kind: 'diffslice-logical', schema: 1, repository: text(v.repository, 'repository', 200), base: sha(v.base), head: sha(v.head), comparison: v.comparison, ...analysis, evidence, changedPaths, unclassified, warnings: list(v.warnings, 'warnings', 100).map(w => text(w, 'warning')), provenance: { agent: p.agent as AgentId, model: text(p.model, 'model', 200), ...(p.provider ? { provider: text(p.provider, 'provider', 200) } : {}), cliVersion: text(p.cliVersion, 'CLI version', 200), generatedAt: p.generatedAt, analysisVersion: 1 } };
}
