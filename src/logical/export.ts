import path from 'node:path';
import { embeddedAssets, serializeEmbedded } from '../viewer-assets.js';
import { boundedRead, writeExternal } from './storage.js';
import { renderLogicalSvg } from './layout.js';
import { validateLogicalMap, type LogicalMap, type LogicalVersion } from './types.js';

export async function readLogicalReport(filename: string): Promise<LogicalMap> {
  const raw = await boundedRead(filename);
  if (raw.trimStart().startsWith('{')) return validateLogicalMap(JSON.parse(raw));
  // Extract data only. Never evaluate scripts, trust a supplied renderer, or fetch assets.
  const matches = [...raw.matchAll(/<script\s+id="diffslice-logical"\s+type="application\/json"\s*>([\s\S]*?)<\/script\s*>/gi)];
  if (matches.length !== 1) throw new Error('Expected one DiffSlice logical metadata block in this HTML report.');
  return validateLogicalMap(JSON.parse(matches[0][1]));
}
export async function renderLogicalHtml(map: LogicalMap, assets?: string): Promise<string> {
  const { css, js, licenses } = await embeddedAssets(assets);
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>DiffSlice · Logical review</title><style>${css}</style></head><body><div id="root"></div><script id="diffslice-logical" type="application/json">${serializeEmbedded(map)}</script><script id="diffslice-licenses" type="application/json">${serializeEmbedded(licenses)}</script><script>${js}</script></body></html>`;
}
export async function exportLogical(options: { repo: string; map: LogicalMap; output: string; format: 'html' | 'svg' | 'json'; overwrite?: boolean; overview?: boolean; area?: string; version?: LogicalVersion; assets?: string }): Promise<string[]> {
  const map = validateLogicalMap(options.map);
  if (options.format === 'html') return [await writeExternal(options.repo, options.output, await renderLogicalHtml(map, options.assets), options.overwrite)];
  if (options.format === 'json') return [await writeExternal(options.repo, options.output, JSON.stringify(map, null, 2), options.overwrite)];
  if (options.area && !map.areas.some(a => a.id === options.area)) throw new Error(`Unknown functional area: ${options.area}`);
  const areas = map.areas.filter(a => !options.area || a.id === options.area);
  const files = areas.map((a, index) => ({ name: `${String(index + 1).padStart(2, '0')}-${a.id}.svg`, contents: renderLogicalSvg(map, { area: a.id, version: options.version }) }));
  if (options.overview) files.unshift({ name: '00-overview.svg', contents: renderLogicalSvg(map, { version: options.version }) });
  files.push({ name: 'mapping.json', contents: JSON.stringify(map, null, 2) });
  const outputs = [];
  for (const file of files) outputs.push(await writeExternal(options.repo, path.join(options.output, file.name), file.contents, options.overwrite));
  return outputs;
}
