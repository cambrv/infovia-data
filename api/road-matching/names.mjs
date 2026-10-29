// Only typographic variants and these explicit abbreviations are equivalent.
export const normalizeText = (value) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const codePattern = /\bE\s*[- ]?\s*\d{1,3}[A-Z]?(?:-\d+)?\b/gi;
export function roadCodes(value) {
  return [...new Set((String(value ?? '').match(codePattern) || [])
    .map((code) => code.toUpperCase().replace(/^E\s*-?\s*/, 'E')))];
}
export function normalizeRoadName(value) {
  return normalizeText(String(value ?? '').replace(codePattern, ' ')
    .replace(/\bctra\./gi, 'carretera').replace(/\bav\./gi, 'avenida')
    .replace(/\bkm\./gi, 'km'));
}
export function localitySequence(value) {
  return String(value ?? '').replace(codePattern, '').split(/\s*[-–—→/]\s*/)
    .map(normalizeRoadName).filter(Boolean);
}
export function provinceKey(value) {
  const key = normalizeText(value);
  // The supplied RVE uses ZAMORA; the report/corridor files use ZAMORA CHINCHIPE.
  return key === 'zamora' ? 'zamora chinchipe' : key;
}
export function tokenSimilarity(a, b) {
  const left = new Set(normalizeRoadName(a).split(' ').filter(Boolean));
  const right = new Set(normalizeRoadName(b).split(' ').filter(Boolean));
  return left.size + right.size ? 2 * [...left].filter((x) => right.has(x)).length / (left.size + right.size) : 0;
}

