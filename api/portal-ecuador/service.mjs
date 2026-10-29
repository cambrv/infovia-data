import { PORTAL_SOURCE, readPortalConfig } from './config.mjs';
import { createPortalClient } from './client.mjs';
import { parsePortalHtml } from './parser.mjs';
import { normalizeRecord, search } from './normalizer.mjs';
import { asPortalError, PortalError } from './errors.mjs';

const defaultLog = (evento, data) => console.log(JSON.stringify({ servicio: 'PortalEcuador', evento, ...data }));

export function createPortalService({ config, client = createPortalClient({ config }), now = Date.now, log = defaultLog }) {
  let cache = null;
  let expiresAt = 0;
  let inFlight = null;
  let lastError = null;
  let nextAttemptAt = 0;
  const lastSuccess = () => cache?.consultado_en ?? null;
  const get = async () => {
    if (cache && now() < expiresAt) return cache;
    if (inFlight) return inFlight;
    if (lastError && now() < nextAttemptAt) throw lastError;
    inFlight = Promise.resolve().then(async () => {
      try {
        const document = await client();
        const parsed = parsePortalHtml(document.html);
        const vias = parsed.records.map(normalizeRecord);
        const baseline = Math.max(config.baselineCount, cache?.total ?? 0);
        const minimum = Math.max(config.minRecords, Math.ceil(baseline * config.minRetainedRatio));
        if (vias.length < minimum) throw new PortalError('PORTAL_INCOMPLETE', 'validacion',
          `Se extrajeron ${vias.length} registros; el mínimo de integridad para esta consulta es ${minimum}.`);
        const warnings = [];
        const identities = new Map();
        vias.forEach((record, index) => {
          const key = [record.provincia, record.canton, record.via].map(search).join('|');
          if (!identities.has(key)) identities.set(key, []);
          identities.get(key).push(index + 1);
          if (record.estado_normalizado === 'desconocido') warnings.push({ codigo: 'ESTADO_DESCONOCIDO', tarjeta: index + 1, estado_original: record.estado });
        });
        for (const indices of identities.values()) if (indices.length > 1) warnings.push({ codigo: 'POSIBLES_DUPLICADOS', tarjetas: indices });
        if (cache && cache.total !== vias.length) warnings.push({ codigo: 'CAMBIO_DE_TOTAL', anterior: cache.total, actual: vias.length });
        const result = {
          fuente: PORTAL_SOURCE, proveedor: 'Fuente de datos', origen_declarado: parsed.origen_declarado,
          metodo_extraccion: 'http_html', experimental: true, completo: true,
          consultado_en: document.consultado_en, fecha_publicada_en_pagina: parsed.fecha_publicada_en_pagina,
          total: vias.length, vias, advertencias: warnings
        };
        cache = result;
        expiresAt = now() + config.cacheMs;
        lastError = null;
        log('extraccion_valida', { total: result.total, advertencias: warnings, consultado_en: result.consultado_en });
        return result;
      } catch (error) {
        lastError = asPortalError(error, 'extraccion');
        nextAttemptAt = now() + 60_000;
        log('extraccion_fallida', { codigo: lastError.code, etapa: lastError.stage, detalle: lastError.message, ultima_consulta_exitosa: lastSuccess() });
        throw lastError;
      }
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  return { get, lastSuccess };
}

export function registerPortalEndpoint(app, { env = process.env, service, log = defaultLog } = {}) {
  let config;
  let configError;
  try { config = readPortalConfig(env); } catch { configError = true; }
  if (config?.enabled) service ??= createPortalService({ config, log });
  app.get('/api/estado-vias', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (configError) return res.status(503).json({ error: 'Configuración experimental no válida.', codigo: 'PORTAL_CONFIG' });
    if (!config.enabled) return res.status(404).json({ error: 'Endpoint experimental no habilitado.', codigo: 'PORTAL_ECUADOR_DISABLED' });
    if (Object.keys(req.query).some((key) => !['provincia', 'buscar'].includes(key)) ||
      Object.values(req.query).some((value) => typeof value !== 'string' || value.length > 250)) {
      return res.status(400).json({ error: 'Usa únicamente provincia y buscar como texto de hasta 250 caracteres.' });
    }
    try {
      const data = await service.get();
      const province = search(req.query.provincia);
      const query = search(req.query.buscar);
      const vias = data.vias.filter((record) => (!province || search(record.provincia).includes(province)) &&
        (!query || Object.values(record).some((value) => search(Array.isArray(value) ? value.join(' ') : value).includes(query))));
      res.json({ ...data, total_fuente: data.total, total: vias.length, vias });
    } catch (error) {
      const failure = asPortalError(error, 'extraccion');
      res.status(503).json({ error: 'No fue posible obtener una extracción válida de la fuente de datos.',
        codigo: failure.code, etapa: failure.stage, detalle: failure.message, fuente: PORTAL_SOURCE,
        proveedor: 'Fuente de datos', experimental: true, ultima_consulta_exitosa: service.lastSuccess(),
        datos_obsoletos_disponibles: Boolean(service.lastSuccess()) });
    }
  });
}

