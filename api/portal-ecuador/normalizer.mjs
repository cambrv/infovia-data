export const clean = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
export const search = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function normalizeState(value) {
  const state = search(value);
  if (/cerrad|bloquead|inhabilitad|interrumpid|no habilitad/.test(state)) return 'cerrada';
  if (/restric|restring/.test(state)) return 'restringida';
  if (/parcial|controlad|intermitente/.test(state)) return 'parcial';
  if (/^(habilitad[ao]s?|abiert[ao]s?|transitable[s]?)[.!\s]*$/.test(state)) return 'habilitada';
  return 'desconocido';
}

export function normalizeRecord(record) {
  const original = clean(record.estado);
  const alternates = record.vias_alternas.map(clean).filter(Boolean);
  return {
    provincia: clean(record.provincia), canton: clean(record.canton), via: clean(record.via),
    estado: original, estado_original: original, estado_normalizado: normalizeState(original),
    observaciones: String(record.observaciones ?? '').split(/\r?\n/).map(clean).filter(Boolean).join('\n'),
    vias_alternas: alternates.join('\n'), vias_alternas_lista: alternates
  };
}

