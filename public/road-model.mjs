// Presentation helpers preserve the original ECU 911 and IEDG records.
export const STATUS = Object.freeze({
  open: { label: "Habilitada", color: "#10D8A0", icon: "✓", variable: "--road-open" },
  partial: { label: "Parcial", color: "#F8B800", icon: "!", variable: "--road-partial" },
  restricted: { label: "Restringida", color: "#F83850", icon: "!", variable: "--road-closed" },
  unknown: { label: "Sin confirmar", color: "#AAA8CC", icon: "?", variable: "--road-unknown" },
  no_report: { label: "Sin reporte vigente", color: "#75C9FF", icon: "—", variable: "--road-no-report" },
});
export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const reportKey = (report) =>
  [report.provincia, report.canton, report.via].map(normalize).join("|");
export function statusOf(report) {
  // Raw status takes precedence over the scraper's broad normalization.
  const text = normalize(report.estado);
  if (/cerrad|bloquead|inhabilitad|interrumpid|no habilitad/.test(text))
    return "restricted";
  if (/restric|restring/.test(text)) return "restricted";
  if (/parcial|controlad|intermitente/.test(text)) return "partial";
  if (/habilitad|abiert|transitable/.test(text)) return "open";
  const known = {
    parcial: "partial",
    restringida: "restricted",
    cerrada: "restricted",
    habilitada: "open",
  };
  return known[normalize(report.estado_normalizado)] || "unknown";
}
export const statusLabel = (report) =>
  /cerrad|bloquead|inhabilitad|interrumpid|no habilitad/.test(
    normalize(report.estado),
  )
    ? "Cerrada"
    : STATUS[statusOf(report)].label;
export const isE59Report = (report) => {
  const name = normalize(report.via);
  return (
    name.includes("cuenca") &&
    name.includes("giron") &&
    name.includes("pasaje") &&
    name.includes("machala")
  );
};
export function displayName(value) {
  return String(value || "")
    .toLocaleLowerCase("es-EC")
    .replace(/(^|[\s/–-])\p{L}/gu, (letter) =>
      letter.toLocaleUpperCase("es-EC"),
    )
    .replace(/\s*-\s*/g, " – ");
}
export function filterReports(
  reports,
  { query = "", status = "all", alertsOnly = false, sort = "relevance" } = {},
) {
  const terms = normalize(query).split(" ").filter(Boolean);
  const rank = { restricted: 0, partial: 1, unknown: 2, open: 3 };
  return reports
    .filter((report) => {
      const state = statusOf(report);
      const searchable = normalize(
        [
          report.provincia,
          report.canton,
          report.via,
          report.observaciones,
        ].join(" "),
      );
      return (
        (status === "all" || state === status) &&
        (!alertsOnly || ["restricted", "partial"].includes(state)) &&
        terms.every((term) => searchable.includes(term))
      );
    })
    .sort((a, b) => {
      if (sort === "province")
        return (
          String(a.provincia).localeCompare(String(b.provincia), "es") ||
          String(a.via).localeCompare(String(b.via), "es")
        );
      if (sort === "name")
        return String(a.via).localeCompare(String(b.via), "es");
      return (
        rank[statusOf(a)] - rank[statusOf(b)] ||
        Number(isE59Report(b)) - Number(isE59Report(a)) ||
        String(a.via).localeCompare(String(b.via), "es")
      );
    });
}
export function validateSnapshot(data) {
  if (
    !data ||
    !Array.isArray(data.vias) ||
    (!Number.isInteger(data.total) || data.total !== data.vias.length) ||
    data.completo === false || data.partial === true ||
    !data.vias.every(
      (v) => v && typeof v.via === "string" && typeof v.provincia === "string",
    )
  ) {
    throw new Error("La API no devolvió un listado de vías válido.");
  }
  return data;
}
export function sourceDate(snapshot) {
  const raw = snapshot?.fecha_publicada_en_pagina;
  const match =
    typeof raw === "string" &&
    raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s*,?\s*(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match)
    return new Date(
      `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6] || "00"}-05:00`,
    );
  // A retrieval timestamp is not a source publication date.
  return null;
}
export function relativeTime(date, now = Date.now()) {
  if (!date || !Number.isFinite(date.getTime()))
    return "Fecha de la fuente no disponible";
  const age = Math.floor((now - date.getTime()) / 60_000);
  if (age < 0) return "Fecha publicada por la fuente";
  if (age === 0) return "Actualizado hace menos de un minuto";
  if (age === 1) return "Actualizado hace un minuto";
  if (age < 60) return `Actualizado hace ${age} minutos`;
  const hours = Math.floor(age / 60);
  if (hours < 24)
    return `Actualizado hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `Actualizado hace ${days} ${days === 1 ? "día" : "días"}`;
}

