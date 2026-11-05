import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronRight, GitBranch, Info, Map, Minus, Plus, Scan, SplitSquareHorizontal, X } from 'lucide-react';
import { AGENTS, type AgentId, type EvidenceRef, type LogicalMap, type LogicalVersion } from '../logical/types.js';
import { layoutLogical, renderLogicalSvg } from '../logical/layout.js';

function download(contents: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface Job { state: string; progress?: string; error?: string; token: string; map?: LogicalMap }
export function LogicalView({ map: initial, live = false, onEvidence, onMap }: { map?: LogicalMap; live?: boolean; onEvidence?: (ref: EvidenceRef) => void; onMap?: (map: LogicalMap) => void }) {
  const [map, setMap] = useState(initial), [area, setArea] = useState('all'), [selected, setSelected] = useState<string>(), [edgeId, setEdgeId] = useState<string>();
  const [version, setVersion] = useState<LogicalVersion>('changes'), [context, setContext] = useState(true), [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1), [fitWidth, setFitWidth] = useState(900), [job, setJob] = useState<Job>(), [error, setError] = useState(''), [agents, setAgents] = useState<AgentId[]>([]);
  const [agent, setAgent] = useState<AgentId>(() => { try { const a = localStorage.getItem('diffslice-agent'); return AGENTS.includes(a as AgentId) ? a as AgentId : 'codex'; } catch { return 'codex'; } });
  const [model, setModel] = useState(''), [provider, setProvider] = useState(''), [settings, setSettings] = useState(!initial);
  const viewport = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const loaded = useRef(initial?.provenance.generatedAt);
  useEffect(() => { if (!live) return; try { setModel(localStorage.getItem(`diffslice-model:${agent}`) ?? ''); setProvider(localStorage.getItem(`diffslice-provider:${agent}`) ?? ''); } catch { /* unavailable storage */ } }, [agent, live]);
  useEffect(() => { if (initial) setMap(initial); }, [initial]);
  useEffect(() => {
    if (!live) return; let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const response = await fetch('/api/logical/status'); if (!response.ok) throw new Error('Could not read logical generation status.'); const next: Job = await response.json(); if (disposed) return;
        setJob(next); if (next.map && next.map.provenance.generatedAt !== loaded.current) { loaded.current = next.map.provenance.generatedAt; setMap(next.map); onMap?.(next.map); setArea('all'); setSelected(undefined); setEdgeId(undefined); setZoom(1); }
      } catch (e: any) { if (!disposed) setError(e.message); }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    poll(); fetch('/api/logical/agents').then(r => r.json()).then(v => { if (!disposed && Array.isArray(v.agents)) setAgents(v.agents); }).catch(() => {});
    return () => { disposed = true; clearTimeout(timer); };
  }, [live]);
  const generate = async () => {
    setError('');
    try {
      const response = await fetch('/api/logical/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DiffSlice-Token': job?.token ?? '' }, body: JSON.stringify({ agent, ...(model ? { model } : {}), ...(provider && agent === 'pi' ? { provider } : {}), refresh: !!map }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); setJob(body); setSettings(false);
      try { localStorage.setItem('diffslice-agent', agent); localStorage.setItem(`diffslice-model:${agent}`, model); localStorage.setItem(`diffslice-provider:${agent}`, provider); } catch { /* unavailable storage */ }
    } catch (e: any) { setError(e.message); }
  };
  const cancel = async () => {
    try { const response = await fetch('/api/logical/generate', { method: 'DELETE', headers: { 'X-DiffSlice-Token': job?.token ?? '' } }); if (!response.ok) throw new Error('Could not cancel generation.'); setJob(await response.json()); } catch (e: any) { setError(e.message); }
  };
  const focus = (id: string) => { setArea(id); setSelected(undefined); setEdgeId(undefined); setZoom(1); if (viewport.current) viewport.current.scrollTo(0, 0); };
  const node = map?.nodes.find(n => n.id === selected), edge = map?.edges.find(e => e.id === edgeId);
  const refs = (node?.evidence ?? edge?.evidence ?? []).map(id => map?.evidence.find(e => e.id === id)).filter((e): e is EvidenceRef => !!e);
  const matchesNode = (n: NonNullable<typeof node>) => !query || `${n.title} ${n.summary} ${n.effect} ${n.evidence.map(id => map?.evidence.find(e => e.id === id)?.path).join(' ')}`.toLowerCase().includes(query.toLowerCase());
  const searchResults = query ? map?.nodes.filter(matchesNode).slice(0, 12) ?? [] : [];
  const reveal = (n: NonNullable<typeof node>) => { focus(n.area); setContext(true); setSelected(n.id); setQuery(''); };
  const diagram = map ? renderLogicalSvg(map, { area, version, context }) : '';
  useEffect(() => {
    const el = viewport.current; if (!el || !map) return;
    const fit = () => { const layout = layoutLogical(map, area, context); setFitWidth(el.clientWidth < 640 ? 640 : Math.max(640, Math.min(el.clientWidth, el.clientHeight * layout.width / (layout.height + 100)) * .97)); };
    const observer = new ResizeObserver(fit); observer.observe(el); fit(); return () => observer.disconnect();
  }, [map, area, context]);
  const selectDiagram = (target: Element) => {
    const n = target.closest('[data-node]'); const e = target.closest('[data-edge]'); const a = target.closest('[data-area]');
    if (n) { setSelected(n.getAttribute('data-node')!); setEdgeId(undefined); }
    else if (e) { setEdgeId(e.getAttribute('data-edge')!); setSelected(undefined); }
    else if (a) focus(a.getAttribute('data-area')!);
  };
  useEffect(() => {
    const root = viewport.current; if (!root || !map) return;
    for (const group of root.querySelectorAll<SVGGElement>('[data-node]')) {
      const n = map.nodes.find(n => n.id === group.dataset.node)!;
      const match = !query || `${n.title} ${n.summary} ${n.effect} ${n.evidence.map(id => map.evidence.find(e => e.id === id)?.path).join(' ')}`.toLowerCase().includes(query.toLowerCase());
      group.style.opacity = match ? '1' : '.25'; group.classList.toggle('logical-selected', n.id === selected);
    }
  }, [query, selected, diagram, map]);
  return <section className="logical-view" aria-label="Functional change map">
    <div className="logical-controls"><strong>{area === 'all' ? 'All functional areas' : map?.areas.find(a => a.id === area)?.name}</strong>
      <div className="logical-search"><input aria-label="Find a capability or evidence file" placeholder="Find a capability or file…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && searchResults[0]) reveal(searchResults[0]); if (e.key === 'Escape') setQuery(''); }} />{query && <div className="logical-search-results">{searchResults.length ? searchResults.map(n => <button key={n.id} onClick={() => reveal(n)}>{n.title}<small>{map?.areas.find(a => a.id === n.area)?.name}</small></button>) : <p>No matching capabilities or evidence paths.</p>}</div>}</div>
      {area !== 'all' && <label className="logical-context"><input type="checkbox" checked={context} onChange={e => setContext(e.target.checked)} />Context</label>}
      <div className="logical-versions" role="group" aria-label="Functional state">{(['changes', 'before', 'after'] as const).map(v => <button key={v} className={v === version ? 'active' : ''} onClick={() => setVersion(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
      {live && <button className="button secondary" onClick={() => setSettings(!settings)}>Generate mapping</button>}
      {map && <button className="button secondary" aria-label="Download area SVG" onClick={() => download(renderLogicalSvg(map, { area, version, context }), `diffslice-${area}.svg`, 'image/svg+xml')}><ArrowDownToLine size={14} />SVG</button>}
    </div>
    {live && settings && <div className="logical-generation"><label>Agent CLI<select aria-label="Agent CLI" value={agent} onChange={e => setAgent(e.target.value as AgentId)}>{AGENTS.map(a => <option key={a} value={a}>{a}{agents.includes(a) ? ' · found' : ''}</option>)}</select></label><label>Model ID<input aria-label="Model ID" placeholder="CLI default" value={model} onChange={e => setModel(e.target.value)} /></label>{agent === 'pi' && <label>Provider<input aria-label="Provider" value={provider} onChange={e => setProvider(e.target.value)} /></label>}<button className="button primary" onClick={generate} disabled={!job?.token || job.state === 'running'}>{map ? 'Regenerate' : 'Generate'}</button><p>Uses your installed CLI and its authentication. Sends committed evidence to its model provider; charges may apply. No checkout changes.</p></div>}
    {(job?.state === 'running' || error || job?.error) && <div className="logical-job" role={error || job?.error ? 'alert' : 'status'}>{error || job?.error || job?.progress}{job?.state === 'running' && <button className="button secondary" onClick={cancel}>Cancel</button>}</div>}
    {map ? <div className="logical-workspace"><nav className="logical-areas" aria-label="Functional areas"><button className={area === 'all' ? 'active' : ''} onClick={() => focus('all')}><Map size={14} />All areas</button>{map.areas.map(a => <button key={a.id} className={area === a.id ? 'active' : ''} onClick={() => focus(a.id)}>{a.name}<small>{map.nodes.filter(n => n.area === a.id && n.state !== 'context').length}</small></button>)}<div className="logical-coverage"><strong>{map.changedPaths.length - map.unclassified.length}/{map.changedPaths.length} changed paths linked</strong><p>Interpreted relationships, not a verified call graph.</p>{map.unclassified.length > 0 && <details><summary>Unclassified paths ({map.unclassified.length})</summary>{map.unclassified.map(p => <div key={p}>{p}</div>)}</details>}{map.warnings.length > 0 && <details><summary>Analysis limitations</summary>{map.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}</div></nav>
      <div className="logical-canvas-container">
        <div className="logical-canvas" ref={viewport}
          onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(z => Math.max(.3, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))); } }}
          onPointerDown={e => { if ((e.target as Element).closest('[role="button"]')) return; const el = e.currentTarget; drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }; el.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { const d = drag.current; if (d) { e.currentTarget.scrollLeft = d.left - e.clientX + d.x; e.currentTarget.scrollTop = d.top - e.clientY + d.y; } }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onClick={e => selectDiagram(e.target as Element)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDiagram(e.target as Element); } }}>
          <div className="logical-diagram" style={{ width: fitWidth * zoom, minWidth: 0, marginInline: 'auto' }} dangerouslySetInnerHTML={{ __html: diagram }} />
        </div>
        <div className="logical-map-bottom"><span><i className="logical-dot added" />Added <i className="logical-dot changed" />Changed <i className="logical-dot removed" />Removed <i className="logical-dot context" />Context</span><div><button aria-label="Zoom out" onClick={() => setZoom(z => Math.max(.3, z / 1.2))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(z => Math.min(3, z * 1.2))}><Plus size={14} /></button><button aria-label="Fit logical map" onClick={() => setZoom(1)}><Scan size={14} /></button></div></div>
      </div>
      <aside className={`logical-inspector ${node || edge ? 'has-logical-selection' : ''}`} aria-label="Functional change details">{node || edge ? <><button className="icon-button logical-close" aria-label="Clear logical selection" onClick={() => { setSelected(undefined); setEdgeId(undefined); }}><X size={16} /></button><span className={`logical-state ${node?.state ?? edge?.state}`}>{node?.state ?? edge?.state}</span><h2>{node?.title ?? 'Functional connection'}</h2>{node ? <><button className="logical-area-jump" onClick={() => focus(node.area)}>{map.areas.find(a => a.id === node.area)?.name}<ChevronRight size={12} /></button><dl><dt>Before</dt><dd>{node.before}</dd><dt>After</dt><dd>{node.after}</dd></dl><h3>Functional effect</h3><p>{node.effect}</p>{node.purpose && <><h3>Purpose <small>inferred</small></h3><p>{node.purpose}</p></>}</> : <><p>{map.nodes.find(n => n.id === edge!.from)?.title} → {map.nodes.find(n => n.id === edge!.to)?.title}</p><p>{edge!.label}</p><p>Interpreted relationship, not a verified call edge.</p></>}<h3>Evidence references</h3>{refs.map(ref => <div className="logical-evidence" key={ref.id}>{onEvidence ? <button onClick={() => onEvidence(ref)}>{ref.path}</button> : <span>{ref.path}</span>}<small>{ref.side} · {ref.lines} lines · {ref.blob.slice(0, 8)}</small>{ref.omitted && <small>{ref.omitted}</small>}</div>)}</> : <><Info size={19} /><p>Select a capability or connection for its functional effect and supporting evidence.</p><p>{map.provenance.agent} · {map.provenance.model}</p><small>Purpose is inferred. Evidence references can be verified by opening this report through DiffSlice in a local checkout.</small></>}</aside>
    </div> : <div className="logical-empty"><Map size={28} /><h2>No logical map for this comparison</h2><p>Generate it on request using an installed agent CLI. Structural views remain available without AI.</p></div>}
  </section>;
}
export function LogicalReport({ map }: { map: LogicalMap }) {
  return <div className="app logical-report"><header className="app-header"><div className="brand"><span className="brand-mark"><SplitSquareHorizontal size={22} /></span>DiffSlice</div><div className="comparison-identity"><GitBranch size={14} /><strong>{map.repository}</strong><span className="revision-pair"><code>{map.base.slice(0, 7)}</code> → <code>{map.head.slice(0, 7)}</code></span></div><span className="local-status">Offline logical report</span></header><LogicalView map={map} /><footer className="app-footer">Mapping only · no embedded source or patches · open through DiffSlice for a complete local review</footer></div>;
}
