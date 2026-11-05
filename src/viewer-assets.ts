import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const viewerDirectory = () => path.join(path.dirname(fileURLToPath(import.meta.url)), 'viewer');
export const serializeEmbedded = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export async function embeddedAssets(directory = viewerDirectory()) {
  let css = await readFile(path.join(directory, 'app.css'), 'utf8');
  for (const match of [...css.matchAll(/url\(([^)]+)\)/g)]) {
    const asset = match[1].replace(/["']/g, '').replace(/^\.\//, ''); if (!asset.startsWith('fonts/')) continue;
    if (asset.includes('..')) throw new Error('Invalid bundled font path.');
    css = css.replaceAll(match[0], `url(data:font/woff2;base64,${(await readFile(path.join(directory, asset))).toString('base64')})`);
  }
  const js = (await readFile(path.join(directory, 'app.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
  const licenses = await readFile(path.join(directory, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  return { css, js, licenses };
}
