import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileCode2, LoaderCircle, X } from 'lucide-react';
import type { ChangedFile, DiffCell, ExportData, FileDiff, Review } from '../types.js';

function Cell({ cell, side }: { cell?: DiffCell; side: 'old' | 'new' }) {
  return <div className={`code-cell ${cell?.kind ?? 'absent'}`} data-side={side} data-line={cell?.line}>
    <span className="line-number">{cell?.line ?? ''}</span><span className="line-sign" aria-hidden="true">{cell?.kind === 'add' ? '+' : cell?.kind === 'delete' ? '−' : ''}</span><code>{cell?.text ?? ''}</code>
  </div>;
}
export function DiffPane({ file, review, offline, onClose, onSelect, focus }: { file: ChangedFile; review: Review; offline: ExportData | null; onClose: () => void; onSelect: (file: ChangedFile) => void; focus?: { side: 'base' | 'head'; line: number } }) {
  const [diff, setDiff] = useState<FileDiff | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const cache = useRef(new Map<string, FileDiff>());
  const patch = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = patch.current;
    if (pane) pane.scrollLeft = file.status === 'added' && pane.scrollWidth > pane.clientWidth ? pane.scrollWidth / 2 : 0;
    if (pane) {
      pane.querySelectorAll('.evidence-target').forEach(el => el.classList.remove('evidence-target'));
      if (focus) {
        const target = pane.querySelector(`[data-side="${focus.side === 'base' ? 'old' : 'new'}"][data-line="${focus.line}"]`)?.closest<HTMLElement>('.diff-row');
        if (target) { target.classList.add('evidence-target'); pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 40; }
      }
    }
  }, [diff, file.id, focus?.side, focus?.line]);
  useEffect(() => {
    const hit = offline?.diffs[file.id] ?? cache.current.get(file.id);
    if (hit) { setDiff(hit); setError(''); setLoading(false); return; }
    const controller = new AbortController(); setDiff(null); setError(''); setLoading(true);
    fetch(`/api/files/${file.id}/diff`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as FileDiff; }).then(value => { cache.current.set(file.id, value); setDiff(value); setLoading(false); }).catch(error => { if (error.name !== 'AbortError') { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [file.id]);
  const index = review.files.findIndex(candidate => candidate.id === file.id);
  return <section className="diff-drawer" aria-label="File diff" data-testid="side-by-side-diff">
    <div className="diff-drawer-header"><FileCode2 size={16} /><div className="diff-file-title"><strong title={file.path}>{file.path}</strong>{file.oldPath && <span>Renamed from {file.oldPath}</span>}</div><span className="delta"><b>+{file.additions}</b><i>−{file.deletions}</i></span><div className="diff-navigation"><span>{index + 1} / {review.files.length}</span><button className="icon-button" aria-label="Previous changed file" disabled={index === 0} onClick={() => onSelect(review.files[index - 1])}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Next changed file" disabled={index === review.files.length - 1} onClick={() => onSelect(review.files[index + 1])}><ChevronRight size={17} /></button></div><button className="icon-button" aria-label="Close diff" onClick={onClose}><X size={18} /></button></div>

    {error ? <div className="diff-message error" role="alert"><p>{error}</p><p>Check that the DiffSlice server is still running.</p></div> : loading ? <div className="diff-message" role="status"><LoaderCircle className="spinner" size={22} /><p>Loading file diff…</p></div> : diff?.message ? <div className="diff-message"><FileCode2 size={25} /><p>{diff.message}</p></div> : !diff?.hunks.length ? <div className="diff-message"><Check size={25} /><p>{file.status === 'renamed' ? 'Renamed without text changes.' : 'No text hunks in this file.'}</p></div> : <div ref={patch} className="patch-scroll" tabIndex={0} aria-label="Scrollable side-by-side code"><div className="patch-content"><div className="diff-columns"><span><i className="revision-dot old-dot" />Before <code>{review.base.sha.slice(0, 7)}</code></span><span><i className="revision-dot new-dot" />After <code>{review.head.sha.slice(0, 7)}</code></span></div>{diff.hunks.map((hunk, index) => <section className="hunk" key={index}><div className="hunk-header">{hunk.header}</div><div className="diff-rows">{hunk.rows.map((row, i) => <div className="diff-row" key={i}><Cell cell={row.old} side="old" /><Cell cell={row.new} side="new" /></div>)}</div></section>)}</div></div>}
  </section>;
}
