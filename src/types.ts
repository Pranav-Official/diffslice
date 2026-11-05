export interface Module {
  id: string;
  name: string;
  labelSource: 'graphify' | 'source-path' | 'rules';
  parentId?: string;
  files: string[];
  symbols: number;
}
export interface ModuleLink { source: string; target: string; count: number }
export interface ModuleMap {
  schema: 1;
  fingerprint: string;
  modules: Module[];
  files: Record<string, string[]>;
  links: ModuleLink[];
  provenance: { path: string; generatedAt: string; version?: string; revision?: string; revisionVerified: boolean; nodes: number; edges: number; kind?: 'rules' | 'graphify'; rulesHash?: string; rulesSource?: 'head' | 'local' | 'external'; unassigned?: number; ambiguous?: number };
}
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechanged';
export interface ChangedFile {
  id: string;
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  moduleIds: string[];
}
export interface ModuleChange { fileIds: string[]; additions: number; deletions: number }
export interface FileMetric { lines: number; bytes: number; binary: boolean; available: boolean }
export interface SourceMetrics { files: Record<string, FileMetric>; totalLines: number; measuredFiles: number; unavailableFiles: number; cacheHit: boolean }
export interface Commit { sha: string; subject: string; author: string; date: string }
export interface Review {
  schema: 1;
  id: string;
  repository: string;
  base: Commit;
  head: Commit;
  comparison: 'commits' | 'pull-request';
  pr?: { url: string; number: number; title: string };
  map: ModuleMap;
  files: ChangedFile[];
  changes: Record<string, ModuleChange>;
  metrics: SourceMetrics;
  totals: { files: number; modules: number; additions: number; deletions: number; unmapped: number };
  timings: { prepareMs: number; mapCacheHit: boolean };
  warnings: string[];
}
export interface DiffCell { line: number; text: string; kind: 'context' | 'add' | 'delete' }
export interface DiffRow { old?: DiffCell; new?: DiffCell }
export interface DiffHunk { header: string; rows: DiffRow[] }
export interface FileDiff { fileId: string; binary: boolean; truncated: boolean; message?: string; hunks: DiffHunk[]; patch: string }
export interface ExportData { review: Review; diffs: Record<string, FileDiff> }
