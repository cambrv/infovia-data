import { matchRoadReport } from './matcher.mjs';
import { normalizeRoadName, provinceKey } from './names.mjs';

export function matchSnapshot(snapshot, catalog) {
  if (!snapshot || snapshot.completo !== true || snapshot.partial === true || !Array.isArray(snapshot.vias) ||
    !Number.isInteger(snapshot.total) || snapshot.total !== snapshot.vias.length || !snapshot.total ||
    (snapshot.total_fuente !== undefined && snapshot.total_fuente !== snapshot.total) ||
    snapshot.vias.some((r) => !r || typeof r.via !== 'string' || !r.via.trim() || typeof r.provincia !== 'string' || !r.provincia.trim())) {
    throw new Error('Se requiere una extracción completa, válida y no vacía.');
  }
  const occurrences = new Map();
  const resultados = snapshot.vias.map((report) => {
    const match = matchRoadReport(report, catalog);
    const count = (occurrences.get(match.reportId) || 0) + 1;
    occurrences.set(match.reportId, count);
    // Same identity can have several distinct incident cards; none is discarded.
    return { ...match, reportId: `${match.reportId}:${count}`, report: structuredClone(report) };
  });
  const byGeometry = new Map();
  for (const result of resultados) if (result.matchStatus === 'matched') {
    const key = catalog.byId.get(result.geometryId).geometryHash || result.geometryId;
    if (!byGeometry.has(key)) byGeometry.set(key, []);
    byGeometry.get(key).push(result);
  }
  const features = [...byGeometry.values()].map((reports) => {
    const id = reports.map((r) => r.geometryId).sort()[0];
    const entry = catalog.byId.get(id);
    return { type: 'Feature', id, geometry: structuredClone(entry.geometry), properties: {
      geometryId: id, geometryIds: [...new Set(reports.map((r) => r.geometryId))], name: entry.name, codes: entry.codes, provinces: entry.provinces,
      source: entry.source, verification: entry.verification, existingIds: entry.existingIds,
      geometryHash: entry.geometryHash, notes: entry.notes, reports,
      representation: 'reference_only', canColorGeometry: false, visual_status: 'unknown',
      hasConflictingReports: new Set(reports.map(({ report }) => report.estado_normalizado || report.estado)).size > 1,
    } };
  });
  const originalNames = new Set(catalog.entries.filter((e) => e.kind === 'corridor' || e.kind === 'reference')
    .map((e) => normalizeRoadName(e.name)));
  const newReports = resultados.filter((result) => !originalNames.has(normalizeRoadName(result.report.via)) &&
    !catalog.entries.some((entry) => entry.kind === 'corridor' && entry.aliases.some((alias) => normalizeRoadName(alias.name) === normalizeRoadName(result.report.via))));
  // Suppress an absence claim even for an unresolved name/candidate. Omitted
  // geometry means no association in this extraction, never an open road.
  const implicated = new Set(resultados.flatMap((r) => [r.geometryId, ...r.candidates.map((c) => c.geometryId)]).filter(Boolean));
  for (const entry of catalog.entries) if (resultados.some((r) =>
    entry.provinces.some((p) => provinceKey(p) === provinceKey(r.report.provincia)) &&
    [entry.name, ...entry.aliases.map((a) => a.name)].some((n) => normalizeRoadName(n) === normalizeRoadName(r.report.via)))) implicated.add(entry.id);
  const members = new Set([...implicated].flatMap((id) => catalog.byId.get(id)?.members || []));
  const geometryHashes = new Set([...implicated].map((id) => catalog.byId.get(id)?.geometryHash));
  const available = catalog.entries.filter((e) => e.verification === 'verified' && !implicated.has(e.id) &&
    !geometryHashes.has(e.geometryHash) && !e.members.some((id) => members.has(id)));
  return {
    experimental: true, fuente: snapshot.fuente, proveedor: snapshot.proveedor, completo: true,
    consultado_en: snapshot.consultado_en, fecha_publicada_en_pagina: snapshot.fecha_publicada_en_pagina ?? null,
    catalogRevision: catalog.revision ?? null, totalReportes: resultados.length,
    matched: resultados.filter((r) => r.matchStatus === 'matched').length,
    ambiguous: resultados.filter((r) => r.matchStatus === 'ambiguous').length,
    unmatched: resultados.filter((r) => r.matchStatus === 'unmatched').length,
    features, resultados, reportesSinGeometria: resultados.filter((r) => r.matchStatus !== 'matched'),
    viasNuevasRespectoCatalogoOriginal: newReports.map((r) => ({ reportId: r.reportId, via: r.report.via, matchStatus: r.matchStatus, geometryId: r.geometryId })),
    geometriesWithoutAssociatedReport: available.map((e) => ({ geometryId: e.id, name: e.name,
      estado: 'sin_reporte_asociado', circulacionConfirmada: false })),
    advertencias: [...(snapshot.advertencias || []), 'La fecha de consulta no acredita vigencia; ninguna geometría representa kilómetros afectados ni circulación confirmada.'],
  };
}

