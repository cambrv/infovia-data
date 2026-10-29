import { hash, geometryHash } from './catalog.mjs';
import { normalizeText, normalizeRoadName, roadCodes, provinceKey, localitySequence, tokenSimilarity } from './names.mjs';

export function incidentScope(report) {
  // Alternate roads are not the location of the incident.
  const text = normalizeText([report.via, report.observaciones].join(' '));
  const kilometer = text.match(/\b(?:km|kilometro|kilometros)\s*(\d+(?:\s+\d+)?)/);
  const type = kilometer ? 'kilometer' : /\b(tramo|entre|desde|hasta)\b/.test(text) ? 'segment'
    : /\b(sector|puente|sitio|barrio|ingreso|salida|altura)\b/.test(text) ? 'unlocated_sector'
      : /\b(toda la via|toda la carretera|todo el corredor|en su totalidad)\b/.test(text) ? 'whole_road_declared' : 'unspecified';
  return { type, kilometerText: kilometer?.[0] ?? null, delimited: false,
    canColorGeometry: false, precision: 'tramo_sin_delimitacion_precisa',
    reason: 'La asociación identifica una vía de referencia; no delimita el incidente ni confirma su vigencia.' };
}

export const reportIdentity = (report) => `portal:${hash([report.provincia, report.canton, report.via].map(normalizeText).join('|')).slice(0, 24)}`;
const namesOf = (entry) => [entry.name, ...entry.aliases.map((alias) => alias.name)];
const checksFor = (entry, { name, codes, province, canton, explicitId }) => ({
  identity: explicitId ? [entry.id, ...entry.existingIds].includes(explicitId) &&
    (!name || namesOf(entry).some((value) => normalizeRoadName(value) === name)) :
    Boolean(name && namesOf(entry).some((value) => normalizeRoadName(value) === name)),
  province: Boolean(province && entry.provinces.some((p) => provinceKey(p) === province)),
  code: codes.length ? codes.every((code) => entry.codes.includes(code)) : null,
  canton: canton && entry.cantons.length ? entry.cantons.some((c) => normalizeText(c) === canton) : null,
  geometry: entry.verification === 'verified',
});
const score = (checks) => {
  const applicable = Object.values(checks).filter((value) => value !== null);
  return applicable.filter(Boolean).length / applicable.length;
};
const compatible = (checks) => checks.province && checks.code !== false && checks.canton !== false;

/** Deterministic evidence gates, never a probability or a fuzzy auto-link. */
export function matchRoadReport(report, catalog) {
  let name = normalizeRoadName(report.via);
  const codes = [...new Set(roadCodes([report.via, report.codigo_vial, report.ruta_codigo, report.codigo].flat().join(' ')))];
  const explicitId = String(report.geometryId ?? report.ruta_id ?? report.tramo_id ?? report.TRAMO_ID ?? '');
  const context = { name, codes, explicitId, province: provinceKey(report.provincia), canton: normalizeText(report.canton) };
  let pool = explicitId ? catalog.entries.filter((entry) => [entry.id, ...entry.existingIds].includes(explicitId))
    : [...new Set(catalog.byName.get(name) || [])];
  // A changing kilometer is incident scope, not a new road. Only allow this
  // fallback when the complete remaining name has a documented catalog entry.
  if (!pool.length && !explicitId) {
    const withoutKm = String(report.via || '').replace(/\s+km\.?\s*\d+(?:[.,]\d+)?(?:\s*(?:al|[-–])\s*(?:km\.?\s*)?\d+(?:[.,]\d+)?)?\s*$/i, '');
    const baseName = normalizeRoadName(withoutKm);
    if (baseName !== name && catalog.byName.has(baseName)) {
      name = baseName; context.name = name;
      pool = [...new Set(catalog.byName.get(baseName))];
    }
  }
  let method = explicitId ? 'stable_id' : 'normalized_name';
  if (!pool.length && !explicitId && codes.length) {
    pool = [...new Set(codes.flatMap((code) => catalog.byCode.get(code) || []))];
    method = 'code_candidates_only';
  }
  const assessed = pool.map((entry) => ({ entry, checks: checksFor(entry, context) }));
  let eligible = assessed.filter(({ checks }) => checks.identity && compatible(checks) && checks.geometry);
  if (!explicitId) {
    // Preserve audited corridors ahead of constituent RVE segments. OSM only
    // supplements unavailable corridors, as in the existing geographic model.
    const fixed = eligible.filter(({ entry }) => entry.source.file.endsWith('infovia_ec_catalogo_fijo.geojson'));
    const osm = eligible.filter(({ entry }) => entry.source.file.endsWith('infovia_ec_trazados_pendientes_osm.geojson'));
    const reviewed = eligible.filter(({ entry }) => entry.source.file.endsWith('infovia_ec_ampliacion_v2.geojson') && entry.review?.accepted);
    if (fixed.length) eligible = fixed;
    else if (osm.length) eligible = osm;
    else if (reviewed.length) eligible = reviewed;
    else if (assessed.some(({ entry, checks }) => entry.kind === 'corridor' && checks.identity && compatible(checks))) eligible = [];
  }
  // Multiple names/IDs for byte-identical geometry are not different locations.
  const groups = new Map();
  for (const candidate of eligible) {
    const key = candidate.entry.geometryHash || geometryHash(candidate.entry.geometry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const selected = groups.size === 1 ? [...groups.values()][0][0] : null;
  let candidates = assessed.filter(({ checks }) => compatible(checks));
  const matchingButInvalid = candidates.some(({ checks, entry }) => checks.identity && entry.kind !== 'reference');
  const status = selected ? 'matched' : groups.size > 1 || matchingButInvalid || (method === 'code_candidates_only' && candidates.length) ? 'ambiguous' : 'unmatched';
  const research = !selected && catalog.research?.find(r => normalizeRoadName(r.name) === name && provinceKey(r.province) === context.province);
  if (selected) {
    method = explicitId ? 'stable_id' : normalizeRoadName(selected.entry.name) === name ? 'normalized_name' : 'documented_alias';
    if (codes.length && !explicitId) method += '_and_code';
  }
  if (!candidates.length) candidates = assessed;
  const suggestions = !pool.length && !explicitId ? catalog.entries
    .filter((entry) => entry.kind !== 'reference' && entry.provinces.some((p) => provinceKey(p) === context.province))
    .map((entry) => ({ geometryId: entry.id, name: entry.name, similarity: tokenSimilarity(report.via, entry.name) }))
    .filter((item) => item.similarity >= 0.5).sort((a, b) => b.similarity - a.similarity).slice(0, 5) : [];
  return {
    reportId: reportIdentity(report), geometryId: selected?.entry.id ?? null,
    matchStatus: status, confidence: selected ? score(selected.checks) : candidates.length ? Math.max(...candidates.map(({ checks }) => score(checks))) : 0,
    method: selected ? method : suggestions.length ? 'similarity_suggestions_only' : method,
    requiresReview: !selected, incidentRequiresReview: true, scope: incidentScope(report),
    evidence: selected?.checks ?? null, localitySequence: localitySequence(report.via),
    research: research || null,
    reason: selected ? 'Identidad de corredor/segmento comprobada; incidente sin delimitar.' : research ? research.reason :
      status === 'ambiguous' ? 'Identidad, trazado aproximado o alcance insuficientes para confirmar una única geometría.' :
        'No se encontró una línea verificada compatible con la identidad y provincia del reporte.',
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 10).map(({ entry, checks }) => ({ geometryId: entry.id, name: entry.name,
      verification: entry.verification, confidence: score(checks), evidence: checks, notes: entry.notes, reason: entry.reason })),
    suggestions,
  };
}

