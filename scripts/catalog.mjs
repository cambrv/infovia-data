import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { loadCatalog, indexCatalog, geometryHash } from '../api/road-matching/catalog.mjs';

const root = new URL('../', import.meta.url);
const cache = new URL('catalog/catalog.json.gz', root);

export async function publicationCatalog() {
  let cached;
  try { cached = await readFile(cache); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cached) {
    const data = JSON.parse(gunzipSync(cached));
    if (!data.entries?.length || !data.revision || !data.sources?.length)
      throw new Error('Catálogo publicado incompleto.');
    for (const entry of data.entries) {
      if (entry.geometryHash !== geometryHash(entry.geometry))
        throw new Error('La geometría del catálogo no coincide con su hash.');
    }
    return indexCatalog(data.entries, { revision: data.revision, sources: data.sources, research: data.research });
  }

  // Bootstrap once from the same public assets already used by the map.
  // Pin their exact Git blob hashes; never accept changed coordinates silently.
  const assets = JSON.parse(await readFile(new URL('catalog-sources.json', root), 'utf8'));
  for (const asset of assets) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`Catálogo HTTP ${response.status}: ${asset.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (digest !== asset.gitBlob) throw new Error(`Catálogo distinto de la revisión aprobada: ${asset.path}`);
    const file = new URL(asset.path, root);
    await mkdir(new URL('./', file), { recursive: true });
    await writeFile(file, bytes);
  }
  const catalog = await loadCatalog();
  const data = { entries: catalog.entries, revision: catalog.revision, sources: catalog.sources, research: catalog.research };
  await mkdir(new URL('catalog/', root), { recursive: true });
  await writeFile(cache, gzipSync(JSON.stringify(data), { level: 9 }));
  return catalog;
}
