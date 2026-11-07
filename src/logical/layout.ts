import type { LogicalMap, LogicalNode, LogicalVersion } from './types.js';

export interface PositionedNode { node: LogicalNode; x: number; y: number; width: number; height: number; external?: boolean }
export interface LogicalLayout { width: number; height: number; nodes: PositionedNode[]; regions: { id: string; name: string; x: number; y: number; width: number; height: number; extra: number }[] }
export function layoutLogical(map: LogicalMap, area = 'all', context = true): LogicalLayout {
  const regions: LogicalLayout['regions'] = [], nodes: PositionedNode[] = [];
  if (area === 'all') {
    let rowY = 24;
    const membersFor = (id: string) => map.nodes.filter(n => n.area === id && n.state !== 'context');
    map.areas.forEach((a, index) => {
      // Overview prioritises changed capabilities, not the first few existing-context nodes.
      const members = membersFor(a.id);
      const height = members.length > 2 ? 406 : 244;
      const x = 24 + index % 2 * 640, y = rowY;
      regions.push({ id: a.id, name: a.name, x, y, width: 616, height, extra: Math.max(0, members.length - 4) });
      members.slice(0, 4).forEach((node, i) => nodes.push({ node, x: x + 20 + i % 2 * 294, y: y + 65 + Math.floor(i / 2) * 162, width: 282, height: 132 }));
      if (index % 2 === 1 || index === map.areas.length - 1) {
        const previous = map.areas[index - index % 2];
        rowY += Math.max(height, membersFor(previous.id).length > 2 ? 406 : 244) + 24;
      }
    });
    return { width: map.areas.length > 1 ? 1300 : 664, height: Math.max(260, rowY), nodes, regions };
  }
  const primary = map.nodes.filter(n => n.area === area && (context || n.state !== 'context'));
  const primaryIds = new Set(primary.map(n => n.id));
  const boundaryIds = new Set(map.edges.filter(e => primaryIds.has(e.from) || primaryIds.has(e.to)).flatMap(e => [e.from, e.to]));
  const members = [...primary, ...(context ? map.nodes.filter(n => n.area !== area && boundaryIds.has(n.id)) : [])];
  // Stable topological traversal; cycles are retained and appended deterministically.
  const ids = new Set(members.map(n => n.id)), sorted: LogicalNode[] = [], pending = [...members].sort((a, b) => a.id.localeCompare(b.id));
  // Kahn-style: track unresolved incoming edges per node instead of rescanning every edge for every pick.
  const waiting = new Map<string, number>(), outgoing = new Map<string, string[]>();
  for (const e of map.edges) if (ids.has(e.from) && ids.has(e.to)) { waiting.set(e.to, (waiting.get(e.to) ?? 0) + 1); (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e.to); }
  while (pending.length) {
    let index = pending.findIndex(n => !waiting.get(n.id));
    if (index < 0) index = 0;
    const [next] = pending.splice(index, 1); sorted.push(next);
    for (const to of outgoing.get(next.id) ?? []) waiting.set(to, (waiting.get(to) ?? 1) - 1);
  }
  const columns = Math.min(3, Math.max(1, members.length));
  sorted.forEach((node, index) => nodes.push({ node, x: 48 + index % columns * 370, y: 70 + Math.floor(index / columns) * 235, width: 282, height: 146, external: node.area !== area }));
  return { width: columns * 370 + 50, height: Math.max(280, Math.ceil(members.length / columns) * 235 + 45), nodes, regions };
}
export function wrapText(text: string, max = 34, lines = 2): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').flatMap(word => word.length > max ? word.match(new RegExp(`.{1,${max}}`, 'gu')) ?? [] : [word]);
  const output: string[] = []; let current = '';
  for (const word of words) { if (current && current.length + word.length + 1 > max) { output.push(current); current = word; } else current += (current ? ' ' : '') + word; }
  if (current) output.push(current);
  if (output.length > lines) { output.length = lines; output[lines - 1] = [...output[lines - 1]].slice(0, max - 1).join('') + '…'; }
  return output;
}
export const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const colors = { added: { border: '#568a68', fill: '#16291f', ink: '#a0dbb6', label: '+ Added' }, changed: { border: '#9b8050', fill: '#2a251c', ink: '#efd09a', label: '~ Changed' }, removed: { border: '#b47785', fill: '#302029', ink: '#f1adbb', label: '− Removed' }, context: { border: '#52647d', fill: '#18222e', ink: '#a3b5ce', label: 'Context' } };
export function renderLogicalSvg(map: LogicalMap, options: { area?: string; version?: LogicalVersion; context?: boolean } = {}): string {
  const area = options.area ?? 'all', version = options.version ?? 'changes', layout = layoutLogical(map, area, options.context ?? true);
  const positions = new Map(layout.nodes.map(n => [n.node.id, n]));
  const title = area === 'all' ? 'Functional changes' : map.areas.find(a => a.id === area)?.name ?? 'Functional area';
  const header = area === 'all' ? 0 : 18;
  const text = (lines: string[], x: number, y: number, color: string, size = 12, weight = 400, maxWidth?: number) => lines.map((line, i) => `<text x="${x}" y="${y + i * (size + 6)}" fill="${color}" font-size="${size}" font-weight="${weight}"${maxWidth && line.length * size > maxWidth ? ` textLength="${Math.min(maxWidth, line.length * size * .6)}" lengthAdjust="spacingAndGlyphs"` : ''}>${xml(line)}</text>`).join('');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height + 100}" width="${layout.width}" height="${layout.height + 100}" role="img" aria-label="${xml(title)}" font-family="Manrope,system-ui,sans-serif"><title>${xml(title)} · ${xml(map.repository)}</title><rect width="100%" height="100%" fill="#10161e"/><defs>${Object.entries(colors).map(([state, c]) => `<marker id="arrow-${state}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${c.border}"/></marker>`).join('')}</defs>`;
  if (header) svg += text(wrapText(title, 90, 1), 48, 32, '#dce7f5', 18, 650);
  if (!layout.nodes.length) svg += text([map.changedPaths.length ? 'No capabilities mapped; inspect coverage.' : 'These commits have identical trees.'], 24, 120, '#b8c9dd', 13);
  for (const r of layout.regions) svg += `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="7" fill="#141d27" stroke="#354356"/><g data-area="${r.id}" role="button" tabindex="0" aria-label="Open ${xml(r.name)}">${text(wrapText(r.name, 55, 1), r.x + 20, r.y + 30, '#d3e1f2', 15, 650)}${r.extra ? text([`+${r.extra} more capabilities · open area`], r.x + 20, r.y + r.height - 12, '#99b8df', 10) : ''}</g>`;
  let index = 0;
  for (const edge of map.edges) {
    const s = positions.get(edge.from), t = positions.get(edge.to);
    if (!s || !t || version === 'before' && edge.state === 'added' || version === 'after' && edge.state === 'removed') continue;
    const c = colors[edge.state], offset = index++ % 3 * 8;
    const sx = s.x + s.width / 2, tx = t.x + t.width / 2;
    const sameRow = s.y === t.y;
    const sy = sameRow ? s.y : s.y + s.height, ty = t.y;
    const laneY = sameRow ? sy - 18 - offset : sy + 18 + offset;
    const laneX = Math.max(s.x + s.width, t.x + t.width) + 24 + offset;
    const path = sameRow ? `M${sx} ${sy} V${laneY} H${tx} V${ty}` : `M${sx} ${sy} V${laneY} H${laneX} V${ty - 18 - offset} H${tx} V${ty}`;
    svg += `<g data-edge="${edge.id}" role="button" tabindex="0" aria-label="${xml(edge.label)}"><title>${xml(edge.label)} · interpreted relationship</title><path d="${path}" fill="none" stroke="transparent" stroke-width="16"/><path d="${path}" fill="none" stroke="${c.border}" stroke-width="1.5" ${edge.state === 'removed' ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#arrow-${edge.state})"/>${text(wrapText(edge.label, 24, 1), sameRow ? (sx + tx) / 2 : sx + 8, laneY - 5, c.ink, 10)}</g>`;
  }
  for (const { node: n, x, y, width, height, external } of layout.nodes) {
    const absent = version === 'before' && n.state === 'added' || version === 'after' && n.state === 'removed';
    const c = colors[absent ? 'context' : n.state];
    const summary = absent ? 'Not present in this state' : version === 'before' ? n.before : version === 'after' ? n.after : n.summary;
    const label = (absent ? 'Absent' : c.label) + (external ? ` · ${map.areas.find(a => a.id === n.area)?.name}` : '');
    svg += `<g data-node="${n.id}" role="button" tabindex="0" aria-label="${xml(n.title)} — ${n.state}"><title>${xml(n.title + ': ' + n.effect)}</title><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${c.fill}" stroke="${c.border}" ${absent || external || n.state === 'context' ? 'stroke-dasharray="4 3"' : ''}/>${text(wrapText(label, 40, 1), x + 14, y + 23, c.ink, 10, 400, width - 28)}${text(wrapText(n.title, 29, 2), x + 14, y + 50, '#e2ebf7', 14, 650, width - 28)}${text(wrapText(summary, 35, 2), x + 14, y + 100, '#b8c9dd', 11, 400, width - 28)}</g>`;
  }
  const footer = layout.height + 30;
  svg += text([`${map.repository} · ${map.base.slice(0, 12)} → ${map.head.slice(0, 12)} · ${version}`], 24, footer, '#a7bad3', 11);
  svg += text(['Functional interpretation · not a verified call graph · purpose is inferred'], 24, footer + 23, '#91a5bf', 10);
  if (map.unclassified.length) svg += text([`${map.unclassified.length} changed paths unclassified · see report coverage`], 24, footer + 44, '#edc78e', 10);
  return svg + '</svg>';
}
