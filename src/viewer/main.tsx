import { useEffect, useMemo, useRef, useState } from 'react';

import { createRoot } from 'react-dom/client';

import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';

import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen, GitBranch, Info, Layers3, LoaderCircle, PanelRightClose, PanelRightOpen, Search, SplitSquareHorizontal, X } from 'lucide-react';

import '@fontsource-variable/manrope';

import './styles.css';
import './logical.css';
import { LogicalReport, LogicalView } from './LogicalView.js';
import { validateLogicalMap } from '../logical/types.js';
import type { EvidenceRef, LogicalMap } from '../logical/types.js';

import { buildChangedTree, buildHierarchy, collectNodes, fileTrail, findTrail, visibleTree, type MapMode, type TreeNode } from '../treemap.js';

import { DiffPane } from './DiffPane.js';

import type { ChangedFile, ExportData, Review } from '../types.js';

const embedded = document.getElementById('diffslice-data');

const offline: ExportData | null = embedded ? JSON.parse(embedded.textContent!) : null;
const logicalEmbedded = document.getElementById('diffslice-logical');

const number = (value: number) => Math.round(value).toLocaleString('en-US');

const compact = (value: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const short = (sha: string) => sha.slice(0, 7);

const palette = ['slate', 'sage', 'sand', 'blue', 'mauve', 'teal'];

function tone(node: TreeNode): string {

  if (node.changed) {

    const files = node.kind === 'file' ? [node] : collectNodes(node).filter(child => child.kind === 'file');

    return files.every(file => file.status === 'added') ? 'added' : files.every(file => file.status === 'deleted') ? 'deleted' : 'changed';

  }

  const hash = [...(node.moduleId ?? node.path?.split('/')[0] ?? node.name)].reduce((sum, c) => sum + c.charCodeAt(0), 0);

  return palette[hash % palette.length];

}

function matches(node: TreeNode, query: string): boolean { return !query || `${node.name} ${node.path ?? ''}`.toLowerCase().includes(query) || node.children.some(child => matches(child, query)); }

function Treemap({ scope, mode, changedOnly, query, onOpen, onHover, selectedPath }: { scope: TreeNode; mode: MapMode; changedOnly: boolean; query: string; onOpen: (node: TreeNode) => void; onHover: (node: TreeNode | null) => void; selectedPath?: string }) {

  const canvas = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ width: 1000, height: 650 });

  useEffect(() => {

    const element = canvas.current!; const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight });

    resize(); const observer = new ResizeObserver(resize); observer.observe(element); return () => observer.disconnect();

  }, []);

  const layout = useMemo(() => {

    const root = hierarchy(visibleTree(scope, changedOnly)).sum(node => node.children.length ? 0 : mode === 'modules' && scope.kind === 'root' ? node.area : Math.max(1, node.loc)).sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.data.id.localeCompare(b.data.id));

    return treemap<TreeNode>().tile(treemapSquarify).size([Math.max(1, size.width), Math.max(1, size.height)]).paddingOuter(5).paddingInner(4).paddingTop(node => node.depth === 1 && node.children ? 39 : 0).round(true)(root).children ?? [];

  }, [scope, changedOnly, size, mode]);

  return <div ref={canvas} className="treemap" aria-label="LOC weighted code treemap" data-testid="treemap" onMouseLeave={() => onHover(null)}>

    {!layout.length && <div className="map-empty"><Check size={26} /><h3>No changed files in this area</h3><p>Turn off Changes only to explore the whole area.</p></div>}

    {layout.map(rect => {

      const node = rect.data; const width = rect.x1 - rect.x0; const height = rect.y1 - rect.y0; const label = width > 85 && height > 38; const large = width > 155 && height > 100;

      return <button key={node.id} className={`map-tile tone-${tone(node)} ${node.children.length ? 'tile-container' : 'tile-file'} ${selectedPath !== undefined && selectedPath === node.path ? 'tile-selected' : ''} ${matches(node, query.toLowerCase()) ? '' : 'tile-dimmed'}`} style={{ left: rect.x0, top: rect.y0, width, height }} onClick={() => onOpen(node)} onMouseEnter={() => onHover(node)} onFocus={() => onHover(node)} onBlur={() => onHover(null)} aria-label={`${node.name}, ${number(node.loc)} lines of code, ${node.changed} changed files${node.children.length ? ', open area' : ', open file'}`} title={`${node.name}\n${number(node.loc)} LOC · ${node.files} files\n+${node.additions} / −${node.deletions}`} tabIndex={width > 18 && height > 18 ? 0 : -1} data-testid="map-tile" data-node-id={node.id} data-kind={node.kind} data-loc={node.loc}>

        {node.children.length ? <>

          {label && <div className="tile-header"><span>{node.kind === 'module' ? <Layers3 size={12} /> : <Folder size={12} />}<strong>{node.name}</strong></span>{width > 280 && <span className="tile-header-size">{compact(node.loc)} lines</span>}{node.changed > 0 && width > 70 && <i className="tile-change-count" title={`${node.changed} changed files`}>{node.changed}{width > 310 ? ' changed' : ''}</i>}</div>}

          <div className="tile-preview" aria-hidden="true">{rect.children?.map(child => <span key={child.data.id} className={`preview-block tone-${tone(child.data)}`} style={{ left: child.x0 - rect.x0, top: child.y0 - rect.y0, width: Math.max(0, child.x1 - child.x0 - 1), height: Math.max(0, child.y1 - child.y0 - 1) }}>

            {child.x1 - child.x0 > 100 && child.y1 - child.y0 > 29 && <span>{child.data.name}</span>}

            {child.x1 - child.x0 > 140 && child.y1 - child.y0 > 55 && <small>{compact(child.data.loc)} lines</small>}

          </span>)}</div>

          {large && <div className="tile-container-summary">{node.files} files{node.changed ? ` · ${node.changed} changed` : ''}<ChevronRight size={13} /></div>}

        </> : label && <div className="file-tile-content"><div className="file-tile-name"><FileCode2 size={large ? 17 : 12} /><strong>{node.name}</strong></div>{height > 54 && <span className="file-tile-size">{number(node.loc)} LOC</span>}{height > 84 && node.changed > 0 && <span className="delta"><b>+{node.additions}</b><i>−{node.deletions}</i></span>}{height > 120 && width > 175 && <span className="file-tile-path">{node.path}</span>}</div>}

      </button>;

    })}

  </div>;

}

function TreeRow({ node, depth, collapsed, toggle, onSelect, selected }: { node: TreeNode; depth: number; collapsed: Set<string>; toggle: (id: string) => void; onSelect: (node: TreeNode) => void; selected?: string }) {

  let entry = node; let label = node.name;

  while (entry.kind === 'directory' && entry.children.length === 1 && entry.children[0].kind === 'directory') { entry = entry.children[0]; label += `/${entry.name}`; }

  const isFolder = entry.kind !== 'file'; const open = !collapsed.has(entry.id);

  const children = [...entry.children].sort((a, b) => Number(b.kind !== 'file') - Number(a.kind !== 'file') || a.name.localeCompare(b.name));

  return <div className="tree-branch" role="treeitem" aria-expanded={isFolder ? open : undefined}>

    <button className={`tree-row ${selected === entry.path ? 'tree-row-selected' : ''} ${isFolder ? 'tree-folder' : 'tree-file'}`} style={{ paddingLeft: 13 + depth * 14 }} onClick={() => isFolder ? toggle(entry.id) : onSelect(entry)} aria-label={isFolder ? `${open ? 'Collapse' : 'Expand'} ${label}` : `Review ${entry.path}`} title={entry.path ?? label} data-path={entry.path}>

      {isFolder ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span className="tree-spacer" />}

      {isFolder ? open ? <FolderOpen size={14} /> : <Folder size={14} /> : <FileCode2 size={14} />}

      <span className="tree-name">{label}</span><span className="delta"><b>+{entry.additions}</b><i>−{entry.deletions}</i></span>

    </button>

    {isFolder && open && <div role="group">{children.map(child => <TreeRow key={child.id} node={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} onSelect={onSelect} selected={selected} />)}</div>}

  </div>;

}

function App({ review }: { review: Review }) {
  const [logicalActive, setLogicalActive] = useState(!!review.logical);
  const [logicalMap, setLogicalMap] = useState<LogicalMap | undefined>(review.logical);
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceRef>();

  const [mode, setMode] = useState<MapMode>('modules'); const [trailIds, setTrailIds] = useState<string[]>(['modules']);

  const [sidebar, setSidebar] = useState(() => window.innerWidth > 900); const [changedOnly, setChangedOnly] = useState(false);

  const [query, setQuery] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);

  const [collapsed, setCollapsed] = useState(new Set<string>()); const [hovered, setHovered] = useState<TreeNode | null>(null); const [notice, setNotice] = useState('');

  const [showInfo, setShowInfo] = useState(false); const [exporting, setExporting] = useState(false); const [exportError, setExportError] = useState('');

  const root = useMemo(() => buildHierarchy(review, mode), [review, mode]);

  const changes = useMemo(() => buildChangedTree(review), [review]);

  const index = useMemo(() => new Map(collectNodes(root).map(node => [node.id, node])), [root]);

  const scope = index.get(trailIds.at(-1)!) ?? root;

  const trail = trailIds.map(id => index.get(id)).filter((node): node is TreeNode => !!node);

  const results = useMemo(() => {

    if (!query.trim()) return [];

    const found = collectNodes(root).filter(node => node.kind !== 'root' && `${node.name} ${node.path ?? ''}`.toLowerCase().includes(query.toLowerCase()));

    const unique = new Map<string, TreeNode>();

    for (const node of found.sort((a, b) => b.changed - a.changed || b.loc - a.loc)) if (!unique.has(node.kind === 'file' ? node.path! : node.id)) unique.set(node.kind === 'file' ? node.path! : node.id, node);

    return [...unique.values()].slice(0, 14);

  }, [root, query]);

  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (query) { setQuery(''); setSearchOpen(false); } else setSelectedFile(null); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [query]);

  const selectFile = (file: ChangedFile) => { setSelectedFile(file); setEvidenceTarget(undefined); setNotice(''); };

  const openNode = (node: TreeNode) => {

    setHovered(null); setNotice('');

    if (node.children.length) { const trail = findTrail(root, node.id); if (trail) setTrailIds(trail.map(node => node.id)); }

    else if (node.fileId) { const file = review.files.find(file => file.id === node.fileId); if (file) selectFile(file); }

    else setNotice(`${node.path ?? node.name} · ${number(node.loc)} LOC · unchanged in this comparison`);

  };

  const revealFile = (node: TreeNode) => {

    const found = fileTrail(root, node.path!); if (found) setTrailIds(found.slice(0, -1).map(node => node.id));

    setQuery(''); setSearchOpen(false); if (window.innerWidth <= 760) setSidebar(false); openNode(found?.at(-1) ?? node);

  };

  const changeMode = (mode: MapMode) => { setLogicalActive(false); setMode(mode); setTrailIds([mode]); setQuery(''); setHovered(null); setNotice(''); };

  const exportReview = async () => {

    setExporting(true); setExportError('');

    try { const response = await fetch(logicalActive ? '/api/logical/export' : '/api/export'); if (!response.ok) throw new Error('Could not export this review.'); const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `diffslice-${logicalActive ? 'logical-' : ''}${short(review.head.sha)}.html`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

    catch (error: any) { setExportError(error.message); } finally { setExporting(false); }

  };

  const hover = hovered ?? scope;

  const rulesMap = review.map.provenance.kind === 'rules';

  return <div className="app">

    <header className="app-header"><button className="brand" onClick={() => { setTrailIds([mode]); setSelectedFile(null); setQuery(''); }} aria-label="DiffSlice home"><span className="brand-mark"><SplitSquareHorizontal size={22} /></span>DiffSlice</button><div className="comparison-identity"><GitBranch size={14} /><strong>{review.repository}</strong><span className="revision-pair"><code>{short(review.base.sha)}</code><ArrowRight size={12} /><code>{short(review.head.sha)}</code></span></div><div className="header-actions"><span className="local-status"><i />{offline ? 'Offline snapshot' : 'Local review'}</span><button className="button secondary details-button" onClick={() => setShowInfo(!showInfo)} aria-expanded={showInfo}><Info size={15} /><span>Map details</span></button><button className="button primary" onClick={exportReview} disabled={exporting || !!offline}><ArrowDownToLine size={15} />{offline ? 'Exported HTML' : exporting ? 'Exporting…' : 'Export HTML'}</button></div></header>

    <div className="review-bar"><span className="review-subject" title={review.pr?.title ?? review.head.subject}>{review.pr ? `#${review.pr.number} · ${review.pr.title}` : review.head.subject}</span><span className="review-counts"><strong>{review.totals.files}</strong> changed files <span className="delta"><b>+{review.totals.additions}</b><i>−{review.totals.deletions}</i></span></span></div>

    {showInfo && <section className="map-info"><div><strong>{rulesMap ? 'Module hierarchy' : `Graphify ${review.map.provenance.version ?? 'map'}`}</strong><p>{rulesMap ? 'Named modules have one primary module per file. Boundaries come from your rules; nested modules appear when you drill down.' : `${review.map.modules.length} logical communities. Shared files are apportioned across communities in the module overview.`} {number(review.metrics.totalLines)} measured physical lines. Block area follows source size, not the number of edits.</p><p>{review.warnings.join(' ')} {review.metrics.unavailableFiles > 0 && `${review.metrics.unavailableFiles} files are not present in these revisions.`} Empty, binary, and unavailable files get a minimum display area.</p></div><button className="icon-button" aria-label="Close map details" onClick={() => setShowInfo(false)}><X size={18} /></button></section>}

    <div className="map-toolbar"><div className="view-switch" aria-label="Treemap hierarchy">
      <button className={!logicalActive && mode === 'modules' ? 'active' : ''} aria-pressed={!logicalActive && mode === 'modules'} onClick={() => changeMode('modules')}><Layers3 size={14} />Modules</button>
      <button className={!logicalActive && mode === 'directories' ? 'active' : ''} aria-pressed={!logicalActive && mode === 'directories'} onClick={() => changeMode('directories')}><Folder size={14} />Directories</button>
      <button className={logicalActive ? 'active' : ''} aria-pressed={logicalActive} onClick={() => { setLogicalActive(true); setSelectedFile(null); }}>Logical</button>
    </div>{!logicalActive && <><div className="search-container"><label className="search"><Search size={15} /><input aria-label="Search modules or files" placeholder="Find a module, directory or file…" value={query} onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={event => { if (event.key === 'Enter' && results[0]) { const result = results[0]; if (result.kind === 'file') revealFile(result); else { openNode(result); setQuery(''); setSearchOpen(false); } } }} />{query && <button aria-label="Clear search" onClick={() => { setQuery(''); setSearchOpen(false); }}><X size={14} /></button>}</label>{query && searchOpen && <div className="search-results">{results.length ? results.map(result => <button key={result.id} onMouseDown={event => event.preventDefault()} onClick={() => { if (result.kind === 'file') revealFile(result); else { openNode(result); setQuery(''); setSearchOpen(false); } }}><span>{result.kind === 'file' ? <FileCode2 size={14} /> : result.kind === 'module' ? <Layers3 size={14} /> : <Folder size={14} />}{result.path ?? result.name}</span><small>{number(result.loc)} LOC</small></button>) : <p>No modules or files match this search.</p>}</div>}</div><label className="changes-filter"><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />Changes only</label><button className={`button tree-toggle ${sidebar ? 'is-open' : ''}`} onClick={() => setSidebar(!sidebar)} aria-expanded={sidebar} aria-label={sidebar ? 'Collapse file tree' : 'Show file tree'}>{sidebar ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}<span>Files</span><i>{review.totals.files}</i></button></>}</div>

    {logicalActive && <LogicalView map={logicalMap} live={!offline} onMap={setLogicalMap} onEvidence={ref => { const file = review.files.find(f => f.path === ref.path || f.oldPath === ref.path); if (file) { selectFile(file); setEvidenceTarget(ref); } else setNotice('This evidence path is unchanged; no patch is available.'); }} />}
    {logicalActive && selectedFile && <DiffPane file={selectedFile} review={review} offline={offline} onClose={() => setSelectedFile(null)} onSelect={selectFile} focus={evidenceTarget?.ranges?.[0] ? { side: evidenceTarget.side, line: evidenceTarget.ranges[0].start } : undefined} />}
    {logicalActive && notice && <div className="logical-job" role="status">{notice}</div>}
    <div className={`workspace ${sidebar ? 'sidebar-open' : ''}`} style={logicalActive ? { display: 'none' } : undefined}>

      <main className={`main-stage ${selectedFile ? 'has-diff' : ''}`}>

        <section className="map-stage" aria-label="Codebase map"><div className="breadcrumb-bar"><button className="icon-button back-button" aria-label="Go up one level" disabled={trail.length <= 1} onClick={() => { setTrailIds(ids => ids.slice(0, -1)); setHovered(null); }}><ArrowLeft size={17} /></button><nav aria-label="Map breadcrumbs">{trail.map((node, i) => <span key={node.id}>{i > 0 && <ChevronRight size={13} />}<button onClick={() => { setTrailIds(trail.slice(0, i + 1).map(node => node.id)); setHovered(null); }} aria-current={i === trail.length - 1 ? 'location' : undefined}>{i === 0 ? <><FolderOpen size={15} />{review.repository}</> : node.name}</button></span>)}</nav><span className="scope-size">{number(scope.loc)} LOC<span> · {scope.files} files</span></span></div>

          {!review.files.length && <div className="no-changes-banner"><Check size={15} />These commits have identical trees. No file changes to highlight.</div>}

          <Treemap scope={scope} mode={mode} changedOnly={changedOnly} query={query} onOpen={openNode} onHover={setHovered} selectedPath={selectedFile?.path} />

          <div className="map-bottom-bar"><div className="hover-description"><span>{notice || hover.path || hover.name}</span>{!notice && <small>{number(hover.loc)} LOC · {hover.files} {hover.files === 1 ? 'file' : 'files'}{hover.changed ? ` · ${hover.changed} changed` : ''}</small>}</div><span className="map-instruction">Click a block to {scope.children.some(child => child.children.length) ? 'explore inside' : 'inspect a file'}</span></div>

        </section>

        {selectedFile && <DiffPane file={selectedFile} review={review} offline={offline} onClose={() => setSelectedFile(null)} onSelect={selectFile} />}

      </main>

      {sidebar && <aside className="file-sidebar" aria-label="Changed files sidebar"><div className="sidebar-heading"><h2>Changed files <span>{review.totals.files}</span></h2><button className="icon-button" aria-label="Close file tree" onClick={() => setSidebar(false)}><X size={16} /></button></div><div className="sidebar-summary"><span className="delta"><b>+{review.totals.additions}</b><i>−{review.totals.deletions}</i></span><span>{review.totals.modules} modules touched</span></div><div className="directory-tree" role="tree" aria-label="Changed directory tree">{changes.children.length ? [...changes.children].sort((a, b) => Number(b.kind !== 'file') - Number(a.kind !== 'file') || a.name.localeCompare(b.name)).map(node => <TreeRow key={node.id} node={node} depth={0} collapsed={collapsed} toggle={id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelect={revealFile} selected={selectedFile?.path} />) : <div className="sidebar-empty"><Check size={22} /><p>No changes between these commits.</p></div>}</div><div className="sidebar-footer"><Layers3 size={15} /><p>The map shows code size.<br />Highlights show this comparison.</p></div></aside>}

    </div>

    {logicalActive ? <footer className="app-footer"><span>Functional interpretation · not a verified call graph</span><span>Evidence from the exact compared commits · purpose is inferred</span></footer> : <footer className="app-footer"><div className="map-legend"><span><i className="legend-neutral" />Unchanged</span><span><i className="legend-changed" />Modified</span><span><i className="legend-added" />Added</span><span><i className="legend-deleted" />Deleted</span></div><span className="weight-legend">Area = lines of code{!rulesMap && mode === 'modules' && scope.kind === 'root' ? ' · shared files apportioned' : ''}</span><span className="footer-provenance">{rulesMap ? 'Module rules | files verified at head' : 'Graphify map | revision unverified'}</span></footer>}

    {exportError && <div className="export-error" role="alert">{exportError}<button className="icon-button" aria-label="Dismiss export error" onClick={() => setExportError('')}><X size={15} /></button></div>}

  </div>;

}

function Bootstrap() {

  const [review, setReview] = useState<Review | null>(offline?.review ?? null); const [error, setError] = useState('');

  useEffect(() => { if (!review && !logicalEmbedded) fetch('/api/review').then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; }).then(setReview).catch(error => setError(error.message)); }, []);
  if (logicalEmbedded) { try { return <LogicalReport map={validateLogicalMap(JSON.parse(logicalEmbedded.textContent!))} />; } catch (e: any) { return <div role="alert">Invalid logical report: {e.message}</div>; } }

  if (error) return <div className="boot-state"><SplitSquareHorizontal size={30} /><h1>Could not open this review</h1><p>{error}</p><p>Restart DiffSlice and open the URL printed in your terminal.</p></div>;

  if (!review) return <div className="boot-state"><LoaderCircle className="spinner" size={28} /><p>Opening DiffSlice…</p></div>;

  return <App review={review} />;

}

createRoot(document.getElementById('root')!).render(<Bootstrap />);
