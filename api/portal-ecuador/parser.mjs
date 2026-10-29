import { load, loadBuffer } from 'cheerio';
import { PortalError } from './errors.mjs';
import { clean, search } from './normalizer.mjs';

const LABEL_SELECTOR = 'b, strong, dt, h6';
const fieldName = (value) => {
  const label = search(value).replace(/[:.]+$/g, '').trim();
  if (/^vias? afectadas?$/.test(label)) return 'via';
  if (/^observacion(?:es)?$/.test(label)) return 'observaciones';
  if (/^vias? alternas?$/.test(label)) return 'vias_alternas';
  if (/^estado(?: de circulacion)?$/.test(label)) return 'estado';
  if (label === 'provincia') return 'provincia';
  if (label === 'canton') return 'canton';
  return null;
};

function text(node) {
  if (node.type === 'text') return node.data;
  if (node.name === 'br') return '\n';
  const contents = (node.children ?? []).map(text).join('');
  return /^(div|p|li|ul|ol|section|dd|dt|h[1-6])$/.test(node.name ?? '') ? `\n${contents}\n` : contents;
}
const multiline = (nodes) => nodes.toArray().map(text).join('\n').split(/\r?\n/).map(clean).filter(Boolean).join('\n');
const invalid = (message) => { throw new PortalError('PORTAL_HTML_STRUCTURE', 'parser', message); };

function fieldValue($, label, body) {
  if (label.is('dt')) return $('<div>').append(label.nextUntil('dt').clone());
  let block = label.parent();
  while (block.length && block[0] !== body[0]) {
    const labels = block.find(LABEL_SELECTOR).filter((_, element) => fieldName($(element).text()));
    if (labels.length > 1) break;
    const copy = block.clone();
    copy.find(LABEL_SELECTOR).filter((_, element) => fieldName($(element).text())).remove();
    if (clean(copy.text())) return copy;
    block = block.parent();
  }
  // Admite etiquetas y valores como hermanos directos en el cuerpo.
  const siblings = [];
  for (let node = label[0].nextSibling; node; node = node.nextSibling) {
    const candidate = $(node);
    if (candidate.find(LABEL_SELECTOR).addBack(LABEL_SELECTOR).toArray().some((node) => fieldName($(node).text()))) break;
    siblings.push(node);
  }
  return $('<div>').append($(siblings).clone());
}

export function parsePortalHtml(html) {
  const raw = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  if (!/<\/body\s*>/i.test(raw) || !/<\/html\s*>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(raw)) {
    invalid('El HTML no tiene un cierre completo de body y html.');
  }
  const $ = Buffer.isBuffer(html) ? loadBuffer(html) : load(raw);
  $('script, style, noscript, iframe, template').remove();
  if (/captcha|access denied|just a moment|attention required|acceso denegado/i.test($('title, h1').text()) ||
    $('[id*="challenge-form"], .g-recaptcha, .h-captcha').length) invalid('La respuesta parece un bloqueo, desafío o CAPTCHA.');
  const headings = $('h1,h2,h3,h4').filter((_, element) => /estado de las vias/.test(search($(element).text())));
  if (headings.length !== 1) invalid('No se identificó una única sección de estado de vías.');
  const scope = headings.first().closest('section, main');
  if (!scope.length || !/ecu\s*911/i.test(scope.text())) invalid('Falta la sección vial o su atribución declarada a ECU 911.');
  const records = [];
  scope.find('.card, article, [data-vial-report]').each((_, element) => {
    const card = $(element);
    if (card.find('.card, article, [data-vial-report]').length) return;
    const body = card.find('.card-body').first().length ? card.find('.card-body').first() : card;
    const labels = body.find(LABEL_SELECTOR).filter((_, node) => fieldName($(node).text()));
    const names = labels.toArray().map((node) => fieldName($(node).text()));
    const title = body.find('.card-title, [data-field="canton"], h4, h5').first();
    const status = body.find('[data-field="estado"], .estado, .status').first();
    const statusSibling = title.nextAll().filter((_, node) => {
      const candidate = $(node);
      return !candidate.find(LABEL_SELECTOR).addBack(LABEL_SELECTOR).toArray().some((node) => fieldName($(node).text())) && clean(candidate.text());
    }).first();
    const rawStatus = clean((status.length ? status : statusSibling).text());
    const header = card.find('.card-header, header, [data-field="provincia"]').first();
    if (!names.includes('via') && !(header.length && title.length &&
      (names.length || /habilitad|cerrad|restring|restric|transitable|bloquead/.test(search(rawStatus))))) return;
    if (new Set(names).size !== names.length) invalid(`Tarjeta ${records.length + 1}: encabezados de campos repetidos.`);
    const fields = {};
    labels.each((_, node) => { fields[fieldName($(node).text())] = fieldValue($, $(node), body); });
    const record = {
      provincia: fields.provincia ? clean(fields.provincia.text()) : clean(header.text()),
      canton: fields.canton ? clean(fields.canton.text()) : clean(title.text()),
      via: fields.via ? clean(fields.via.text()) : '',
      estado: fields.estado ? clean(fields.estado.text()) : rawStatus,
      observaciones: fields.observaciones ? multiline(fields.observaciones.contents()) : '',
      vias_alternas: fields.vias_alternas ? (fields.vias_alternas.find('li').length
        ? fields.vias_alternas.find('li').toArray().map((node) => clean($(node).text()))
        : multiline(fields.vias_alternas.contents()).split('\n').filter(Boolean)) : []
    };
    if (!record.provincia || !record.via || !record.estado) invalid(`Tarjeta ${records.length + 1}: falta provincia, vía o estado.`);
    for (const name of ['observaciones', 'vias_alternas']) {
      if (fields[name] && !clean(fields[name].text())) invalid(`Tarjeta ${records.length + 1}: la sección ${name} está vacía.`);
    }
    records.push(record);
  });
  if (!records.length) invalid('No se encontraron tarjetas viales válidas.');
  return { records, fecha_publicada_en_pagina: null, origen_declarado: 'ECU 911' };
}

