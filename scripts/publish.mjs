import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readPortalConfig, PORTAL_SOURCE } from '../api/portal-ecuador/config.mjs';
import { createPortalService } from '../api/portal-ecuador/service.mjs';
import { matchSnapshot } from '../api/road-matching/snapshot.mjs';
import { publicationCatalog } from './catalog.mjs';
import { validatePublication } from './validation.mjs';

const root = new URL('../', import.meta.url);
let previous;
try { previous = JSON.parse(await readFile(new URL('data/portal-ecuador.json', root), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const catalog = await publicationCatalog();
const config = readPortalConfig({ ...process.env, PORTAL_ECUADOR_ENABLED: 'true',
  PORTAL_ECUADOR_BASELINE_COUNT: String(previous?.total || 0) });
const snapshot = await createPortalService({ config }).get();
snapshot.proveedor = 'Portal Ecuador';
const geometry = matchSnapshot(snapshot, catalog);
validatePublication(snapshot, geometry, previous);
const manifest = {
  schema: 1, source: 'Portal Ecuador', sourceUrl: PORTAL_SOURCE, success: true,
  generatedAt: new Date().toISOString(), extractedAt: snapshot.consultado_en,
  sourcePublishedAt: snapshot.fecha_publicada_en_pagina ?? null,
  total: snapshot.total, matched: geometry.matched, ambiguous: geometry.ambiguous, unmatched: geometry.unmatched,
  catalogRevision: catalog.revision, scheduleMinutes: 15,
  note: 'La hora de extracción no es la fecha de publicación de la fuente. El horario puede sufrir retrasos.'
};
// Commit and push happen only if this entire script succeeds. A failed run
// leaves the previous public commit and its valid JSON available to visitors.
await mkdir(new URL('data/', root), { recursive: true });
for (const [name, value] of Object.entries({ 'portal-ecuador.json': snapshot, 'portal-geometria.json': geometry, 'manifest.json': manifest }))
  await writeFile(new URL(`data/${name}`, root), JSON.stringify(value) + '\n');
console.log(JSON.stringify(manifest, null, 2));
if (process.env.GITHUB_STEP_SUMMARY)
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Portal Ecuador\n\n${snapshot.total} reportes publicados.\n\nExtracción: ${snapshot.consultado_en}\n\nGeometrías: ${geometry.matched} identificadas, ${geometry.ambiguous} ambiguas, ${geometry.unmatched} sin coincidencia.\n`);
