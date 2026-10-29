import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { geometriaValida, prepararCatalogo } from '../../public/scripts/infovia_ec_vincular_reportes.js';
import { normalizeRoadName, provinceKey } from './names.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const geometryHash = (geometry) => hash(JSON.stringify(geometry));
const files = {
  network: 'public/data/red_vial_estatal_2026.geojson',
  fixed: 'public/geo/infovia_ec_catalogo_fijo.geojson',
  osm: 'public/geo/infovia_ec_trazados_pendientes_osm.geojson',
  references: 'public/geo/InfoViaEC_10_referencias_NO_trazados.geojson',
  aliases: 'api/road-matching/aliases.json',
  additions: 'public/geo/infovia_ec_ampliacion_v2.geojson',
  research: 'api/road-matching/pending-research.json',
};
const root = new URL('../../', import.meta.url);
const add = (map, key, entry) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(entry); };

/** A permanent index. There are deliberately no operating states in its schema. */
export function indexCatalog(entries, metadata = {}) {
  const byId = new Map(), byName = new Map(), byCode = new Map();
  for (const entry of entries) {
    if (!entry.id || byId.has(entry.id)) throw new Error('Duplicate or missing geometry identifier');
    if (entry.verification === 'verified' && !geometriaValida(entry.geometry)) throw new Error('Invalid verified geometry');
    byId.set(entry.id, entry);
    add(byName, normalizeRoadName(entry.name), entry);
    for (const alias of entry.aliases) {
      if (!alias.source) throw new Error('An alias requires documentary provenance');
      add(byName, normalizeRoadName(alias.name), entry);
    }
    for (const code of entry.codes) add(byCode, code, entry);
  }
  return { entries, byId, byName, byCode, ...metadata };
}

export function buildCatalog({ network, fixed, osm, references, aliases = [], additions = { features: [] }, research = [] }, metadata = {}) {
  const audited = prepararCatalogo(fixed, network);
  const networkIds = new Map(network.features.map((f) => [f.properties.TRAMO_ID, f]));
  if (networkIds.size !== network.features.length) throw new Error('Duplicate RVE TRAMO_ID');
  const base = (f, file) => ({
    id: String(f.id), name: '', aliases: [], codes: [], provinces: [], cantons: [],
    geometry: f.geometry, geometryHash: geometryHash(f.geometry),
    source: { file, featureId: f.id, attribution: file === files.osm ? '© OpenStreetMap contributors' : 'RVE IEDG suministrada por usuario',
      license: file === files.osm ? 'ODbL-1.0' : 'No consta una licencia explícita en el archivo suministrado' },
    verification: 'rejected', kind: 'segment', existingIds: [String(f.id)], members: [], notes: '', reason: '',
  });
  const entries = network.features.map((f) => ({
    ...base(f, files.network), id: `rve:${f.properties.TRAMO_ID}`, name: f.properties.NOMBRE_TRA,
    codes: [f.properties.CODIGO_DE_].filter(Boolean), provinces: [f.properties.PROVINCIA],
    members: [f.properties.TRAMO_ID], existingIds: [f.id, f.properties.TRAMO_ID],
    verification: geometriaValida(f.geometry) ? 'verified' : 'rejected',
    notes: 'Segmento de la red suministrada; sin validación de campo ni localización del incidente.',
  }));
  for (const f of fixed.features) {
    const p = f.properties, audit = audited.byId.get(f.id);
    entries.push({ ...base(f, files.fixed), name: p.nombre_reporte_referencia,
      codes: p.ruta_codigo, provinces: [...new Set([p.provincia, ...p.tramos_rve.map((id) => networkIds.get(id)?.properties.PROVINCIA).filter(Boolean)])],
      members: p.tramos_rve, kind: 'corridor', notes: p.nota_geografica, reason: audit.motivo,
      verification: !audit.seleccionable ? 'rejected' : audit.confianza === 'alta' ? 'verified' : 'approximate',
    });
  }
  for (const f of osm.features) {
    const p = f.properties;
    const ref = references.features.find((r) => r.id === p.referencia_id);
    const valid = geometriaValida(f.geometry) && geometryHash(f.geometry) === p.geometry_sha256 &&
      p.estado_verificacion === 'trazado_validado_osm' && p.osm_way_ids?.length > 0 && p.fuentes?.length > 0 &&
      ref && normalizeRoadName(ref.properties.nombre_reporte_referencia) === normalizeRoadName(p.nombre_reporte_referencia) &&
      provinceKey(ref.properties.provincia) === provinceKey(p.provincia);
    entries.push({ ...base(f, files.osm), name: p.nombre_reporte_referencia, codes: p.ruta_codigo || [],
      provinces: [p.provincia], kind: 'corridor', notes: p.nota_geografica,
      existingIds: [f.id, p.referencia_id], verification: valid ? 'verified' : 'rejected',
      reason: valid ? '' : 'OSM: hash, referencia o procedencia no verificable.',
      source: { ...base(f, files.osm).source, urls: p.fuentes, osmWayIds: p.osm_way_ids, osmBase: p.osm_base },
    });
  }
  // Points remain in the inventory but can never be promoted to road lines.
  for (const f of references.features) entries.push({ ...base(f, files.references),
    name: f.properties.nombre_reporte_referencia, provinces: [f.properties.provincia],
    kind: 'reference', verification: 'reference_only', notes: f.properties.nota_geografica,
    source: { file: files.references, featureId: f.id, attribution: 'Referencias aportadas por el usuario', license: 'No documentada' },
  });
  for (const f of additions.features) {
    const p = f.properties;
    if (!p?.review?.accepted || !p.review.date || !p.review.evidence?.length ||
      !p.source?.urls?.length || !p.source.license || !p.source.attribution ||
      geometryHash(f.geometry) !== p.geometryHash || !geometriaValida(f.geometry)) {
      throw new Error(`Invalid reviewed supplement: ${f.id}`);
    }
    entries.push({ ...base(f, files.additions), name: p.name, codes: p.codes,
      provinces: p.provinces, cantons: p.cantons || [], kind: 'corridor',
      verification: 'verified', members: p.members || [], notes: p.notes,
      source: { ...p.source, file: files.additions, featureId: f.id },
      review: p.review,
    });
  }
  for (const alias of aliases) {
    const entry = entries.find((candidate) => candidate.id === alias.geometryId);
    if (!entry || !alias.name || !alias.source) throw new Error('Invalid documented alias');
    entry.aliases.push({ name: alias.name, source: alias.source });
  }
  return indexCatalog(entries, { ...metadata, research });
}

export async function loadCatalog() {
  const loaded = await Promise.all(Object.entries(files).map(async ([key, file]) => {
    const bytes = await readFile(new URL(file, root));
    return [key, JSON.parse(bytes), { file, bytes: bytes.length, sha256: hash(bytes) }];
  }));
  const sources = loaded.map(([, , source]) => source);
  return buildCatalog(Object.fromEntries(loaded.map(([key, data]) => [key, data])), {
    sources, revision: hash(JSON.stringify(sources)),
  });
}

