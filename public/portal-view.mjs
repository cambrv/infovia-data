// Browser adapter only. The backend owns matching and geographic verification.
import { validateSnapshot } from './road-model.mjs';

export const portalMode = (search = '', pathname = '/') => {
  const fuente = new URLSearchParams(search).get('fuente');

  if (fuente === 'portal-experimental') return true;
  if (fuente === 'ecu-911') return false;

  return !/^\/ecu-911\/?$/i.test(pathname);
};

const metadata = new WeakMap();
// Current API label, original label and the archived audit label identify the
// same provider. Keep all structural and geographic validation below intact.
const portalProviders = new Set(['Portal Ecuador', 'Fuente de datos', 'PE']);
export const portalReportId = (report) => metadata.get(report)?.reportId;
export const portalMatch = (report) => metadata.get(report);
export const PORTAL_ENDPOINT = '/api/estado-vias/geometria';

function validLine(geometry) {
  const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
  return Array.isArray(lines) && lines.length > 0 && lines.every((line) => Array.isArray(line) && line.length >= 2 &&
    line.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) &&
    line.some((p) => p[0] !== line[0][0] || p[1] !== line[0][1]));
}

/** Validate everything before replacing the last successfully displayed view. */
export function adaptPortalSnapshot(data, previousGeometries = new Map()) {
  if (!data || data.experimental !== true || !portalProviders.has(data.proveedor) || data.completo !== true || data.partial === true ||
    !Number.isInteger(data.totalReportes) || data.totalReportes < 1 || !Array.isArray(data.resultados) ||
    data.resultados.length !== data.totalReportes || !Array.isArray(data.features) ||
    ['matched', 'ambiguous', 'unmatched'].some((key) => !Number.isInteger(data[key]) ||
      data[key] !== data.resultados.filter((r) => r.matchStatus === key).length) ||
    data.matched + data.ambiguous + data.unmatched !== data.totalReportes) throw new Error('Correspondencia geográfica incompleta o inválida.');
  const features = new Map();
  for (const feature of data.features) {
    const p = feature?.properties;
    if (feature?.type !== 'Feature' || !p || typeof p.geometryId !== 'string' || !validLine(feature.geometry) ||
      p.verification !== 'verified' || !Array.isArray(p.geometryIds) || !p.geometryIds.includes(p.geometryId)) throw new Error('Geometría de referencia inválida.');
    for (const id of p.geometryIds) {
      if (typeof id !== 'string' || features.has(id)) throw new Error('Identificador de geometría repetido.');
      features.set(id, feature);
    }
  }
  const ids = new Set(), vias = [], links = new Map(), geometries = new Map(previousGeometries);
  const featureObjects = new Map();
  // Reuse the same geometry object when its server hash is unchanged. Never
  // simplify, interpolate, join or otherwise alter source coordinates.
  for (const [id, feature] of features) {
    const previous = previousGeometries.get(id);
    const { reports: _reports, ...properties } = feature.properties;
    const cached = { type: 'Feature', id: feature.id, properties,
      geometry: previous?.properties.geometryHash && previous.properties.geometryHash === properties.geometryHash
        ? previous.geometry : feature.geometry };
    featureObjects.set(id, cached);
    geometries.set(id, cached);
  }
  for (const result of data.resultados) {
    if (typeof result.reportId !== 'string' || !result.reportId || ids.has(result.reportId) ||
      !['matched', 'ambiguous', 'unmatched'].includes(result.matchStatus) || !result.report ||
      typeof result.report.via !== 'string' || !result.report.via.trim() ||
      typeof result.report.provincia !== 'string' || !result.report.provincia.trim() ||
      (result.matchStatus !== 'matched' && result.geometryId != null)) throw new Error('Asociación de reporte inválida.');
    ids.add(result.reportId);
    const feature = result.matchStatus === 'matched' ? featureObjects.get(result.geometryId) : null;
    if (result.matchStatus === 'matched' && (!feature || result.requiresReview !== false)) throw new Error('Falta una geometría confirmada para el reporte.');
    const report = { ...result.report };
    metadata.set(report, result);
    vias.push(report);
    links.set(result.reportId, {
      ...report, geometry: feature?.geometry ?? null, ruta_id: feature ? result.geometryId : null,
      codigo_vial: feature?.properties.codes || [],
      // RVE members are used for selecting an identified segment, never paint.
      tramos_rve: result.geometryId?.startsWith('rve:') ? [result.geometryId.slice(4)] : [],
      confianza_trazado: feature ? 'portal_reference' : result.matchStatus,
      estado_verificacion: feature ? 'identidad_confirmada_referencia' : result.matchStatus,
      nota_geografica: feature?.properties.notes || result.reason || '',
      advertencia: 'Referencia de carretera; el incidente no está delimitado y la circulación no está confirmada.',
      representation: 'reference_only', canColorGeometry: false, visual_status: 'unknown',
      geometry_version: feature?.properties.geometryHash,
      match: result, source: feature?.properties.source,
    });
    metadata.set(links.get(result.reportId), result);
  }
  const snapshot = validateSnapshot({
    fuente: data.fuente, proveedor: data.proveedor, experimental: true, completo: true,
    consultado_en: data.consultado_en, fecha_publicada_en_pagina: data.fecha_publicada_en_pagina,
    total: vias.length, vias,
  });
  return { snapshot, links, geometries, catalogRevision: data.catalogRevision,
    counts: { matched: data.matched, ambiguous: data.ambiguous, unmatched: data.unmatched } };
}

/** Revalidate with max-age=0 rather than no-store (which defeats Express fresh).
 * Keep a validator only after a fully validated response has been accepted.
 */
export function createPortalViewClient({ fetchImpl = globalThis.fetch } = {}) {
  let etag = null, view = null;
  return {
    async get(signal) {
      const response = await fetchImpl(PORTAL_ENDPOINT, { signal, cache: 'no-cache',
        headers: etag ? { 'If-None-Match': etag } : {} });
      if (response.status === 304) {
        if (!view) throw new Error('La API devolvió 304 sin una extracción anterior.');
        return view;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = adaptPortalSnapshot(await response.json(), view?.geometries);
      etag = response.headers.get('etag');
      view = next;
      return view;
    },
  };
}

