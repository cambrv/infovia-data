import { normalize, statusOf } from "../road-model.mjs";

/** Static GIS audit and joins. No historical operating states enter this index. */
export const normaliza = (texto = "") => normalize(texto).toUpperCase();
export const normalizaEstado = (original = "") =>
  ({
    open: "habilitada",
    partial: "parcial",
    restricted: "restringida",
    unknown: "sin_dato",
  })[statusOf({ estado: original })];
export const claveCorredor = (provincia, via) =>
  `${normaliza(provincia)}:${normaliza(via)}`;
export const AVISO_CORREDOR =
  "Corredor de referencia; no localiza los incidentes ni representa todos sus kilómetros como afectados.";
// Local QA gates, not a certification of connectivity or road safety.
export const LIMITE_SEPARACION_KM = 5;
export const AVISO_SEPARACION_KM = 1;
const indices = new WeakMap();

export function lineasGeometria(geometry) {
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
}
export function geometriaValida(geometry) {
  const lines = lineasGeometria(geometry);
  return (
    Array.isArray(lines) &&
    lines.length > 0 &&
    lines.every(
      (line) =>
        Array.isArray(line) &&
        line.length >= 2 &&
        line.every(
          (point) =>
            Array.isArray(point) &&
            point.length >= 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]) &&
            Math.abs(point[0]) <= 180 &&
            Math.abs(point[1]) <= 90,
        ) &&
        line.some(
          (point) => point[0] !== line[0][0] || point[1] !== line[0][1],
        ),
    )
  );
}
function distanciaKm(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitude = radians(b[1] - a[1]),
    longitude = radians(b[0] - a[0]);
  const haversine =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a[1])) *
      Math.cos(radians(b[1])) *
      Math.sin(longitude / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}
/** Largest join in a minimum spanning tree of line parts, using real vertices. */
export function separacionMaximaKm(geometry) {
  if (!geometriaValida(geometry)) return Infinity;
  const lines = lineasGeometria(geometry);
  const distances = lines.map(() => []);
  for (let a = 0; a < lines.length; a++) {
    for (let b = 0; b < a; b++) {
      let distance = Infinity;
      for (const endpoint of [lines[a][0], lines[a].at(-1)]) {
        for (const vertex of lines[b])
          distance = Math.min(distance, distanciaKm(endpoint, vertex));
      }
      for (const endpoint of [lines[b][0], lines[b].at(-1)]) {
        for (const vertex of lines[a])
          distance = Math.min(distance, distanciaKm(endpoint, vertex));
      }
      distances[a][b] = distances[b][a] = distance;
    }
  }
  const joined = new Set([0]);
  let maxGap = 0;
  while (joined.size < lines.length) {
    let next = null,
      minimum = Infinity;
    for (let candidate = 0; candidate < lines.length; candidate++) {
      if (joined.has(candidate)) continue;
      for (const previous of joined) {
        if (distances[candidate][previous] < minimum) {
          minimum = distances[candidate][previous];
          next = candidate;
        }
      }
    }
    if (next === null) return Infinity;
    joined.add(next);
    maxGap = Math.max(maxGap, minimum);
  }
  return maxGap;
}
const firmaLinea = (line) => {
  const forward = JSON.stringify(line),
    reverse = JSON.stringify([...line].reverse());
  return forward < reverse ? forward : reverse;
};
function mismasLineas(actual, expected) {
  if (actual.length !== expected.length) return false;
  const counts = new Map();
  expected.forEach((line) => {
    const key = firmaLinea(line);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  for (const line of actual) {
    const key = firmaLinea(line);
    if (!counts.get(key)) return false;
    counts.set(key, counts.get(key) - 1);
  }
  return true;
}

/** Audit once, retaining exact source geometries and their original confidence. */
export function prepararCatalogo(catalogo, redVial) {
  if (indices.has(catalogo) && indices.get(catalogo).redVial === redVial)
    return indices.get(catalogo);
  if (
    catalogo?.type !== "FeatureCollection" ||
    !Array.isArray(catalogo.features)
  )
    throw new Error("El catálogo vial no es un GeoJSON válido.");
  if (!Array.isArray(redVial?.features))
    throw new Error(
      "Se necesita la red IEDG para verificar las geometrías del catálogo.",
    );
  const mit = new Map(
    redVial.features.map((feature) => [feature.properties.TRAMO_ID, feature]),
  );
  const keys = new Map(),
    ids = new Map();
  for (const feature of catalogo.features) {
    const p = feature.properties || {},
      key = claveCorredor(p.provincia, p.nombre_reporte_referencia);
    keys.set(key, (keys.get(key) || 0) + 1);
    ids.set(feature.id, (ids.get(feature.id) || 0) + 1);
  }
  const byKey = new Map(),
    byId = new Map();
  for (const feature of catalogo.features) {
    const p = feature.properties || {},
      key = claveCorredor(p.provincia, p.nombre_reporte_referencia);
    const source = Array.isArray(p.tramos_rve)
      ? p.tramos_rve.map((id) => mit.get(id))
      : [];
    const validGeometry = geometriaValida(feature.geometry);
    const reasons = [];
    if (!p.provincia || !p.nombre_reporte_referencia || !feature.id)
      reasons.push("Faltan identificadores del corredor.");
    if (keys.get(key) > 1 || ids.get(feature.id) > 1)
      reasons.push(
        "Hay más de una entrada para la misma denominación o identificador.",
      );
    if (!validGeometry)
      reasons.push("La geometría no contiene líneas WGS84 válidas.");
    if (!source.length || source.some((item) => !item))
      reasons.push("Faltan identificadores TRAMO_ID en la red MIT.");
    else {
      if (
        !validGeometry ||
        !mismasLineas(
          lineasGeometria(feature.geometry),
          source.flatMap((item) => lineasGeometria(item.geometry)),
        )
      )
        reasons.push(
          "Las coordenadas no coinciden con los tramos IEDG declarados.",
        );
      const codes = [
        ...new Set(source.map((item) => item.properties.CODIGO_DE_)),
      ].sort();
      if (
        !Array.isArray(p.ruta_codigo) ||
        JSON.stringify([...p.ruta_codigo].sort()) !== JSON.stringify(codes)
      )
        reasons.push(
          "Los códigos del catálogo no coinciden con los tramos MIT.",
        );
    }
    if (!["alta", "media"].includes(p.confianza))
      reasons.push(
        "La correspondencia no tiene una confianza suficiente declarada.",
      );
    const gap = validGeometry ? separacionMaximaKm(feature.geometry) : null;
    if (gap > LIMITE_SEPARACION_KM)
      reasons.push(
        `El catálogo tiene componentes separados por aproximadamente ${gap.toFixed(2)} km; falta verificar el enlace. No se unen con líneas inventadas.`,
      );
    const selectable = reasons.length === 0;
    const confidence = !selectable
      ? "no_verificada"
      : p.confianza === "media" || gap > AVISO_SEPARACION_KM
        ? "media"
        : "alta";
    const warning =
      selectable && gap > AVISO_SEPARACION_KM
        ? `El trazado conserva una separación de aproximadamente ${gap.toFixed(2)} km. No se completa el enlace faltante.`
        : "";
    const entry = Object.freeze({
      id: feature.id,
      clave: key,
      provincia: p.provincia,
      nombre: p.nombre_reporte_referencia,
      geometry: selectable ? feature.geometry : null,
      seleccionable: selectable,
      confianza: confidence,
      confianza_fuente: p.confianza,
      codigos: p.ruta_codigo || [],
      tramos_rve: p.tramos_rve || [],
      nota: p.nota_geografica || "",
      motivo: reasons.join(" "),
      advertencia: [AVISO_CORREDOR, warning].filter(Boolean).join(" "),
      separacion_maxima_km: gap,
    });
    byKey.set(key, entry);
    byId.set(feature.id, entry);
  }
  const index = { byKey, byId, redVial };
  indices.set(catalogo, index);
  return index;
}

/** Exact normalized province + road name only. Unknown/new reports are retained. */
export function vincularReportes(catalogoOIndice, snapshotECU911, redVial) {
  const index =
    catalogoOIndice?.byKey instanceof Map
      ? catalogoOIndice
      : prepararCatalogo(catalogoOIndice, redVial);
  return (snapshotECU911.vias || []).map((reporte) => {
    const route = index.byKey.get(
      claveCorredor(reporte.provincia, reporte.via),
    );
    return {
      ...reporte,
      // Keep every API attribute, including its original normalized state.
      estado_circulacion: normalizaEstado(reporte.estado),
      geometry: route?.geometry || null,
      ruta_id: route?.id || null,
      codigo_vial: route?.codigos || [],
      tramos_rve: route?.tramos_rve || [],
      confianza_trazado: route?.confianza || "sin_geometria",
      confianza_fuente: route?.confianza_fuente || null,
      nota_geografica: route?.nota || "",
      motivo_geografico: route?.motivo || "",
      advertencia: route?.advertencia || AVISO_CORREDOR,
    };
  });
}

