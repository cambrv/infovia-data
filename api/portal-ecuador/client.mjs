import { PORTAL_SOURCE, PORTAL_USER_AGENT } from './config.mjs';
import { abortable, asPortalError, PortalError } from './errors.mjs';

export function createPortalClient({ config, fetchImpl = globalThis.fetch, now = Date.now }) {
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new PortalError('PORTAL_TIMEOUT', stage,
      `No se completó la respuesta en ${config.timeoutMs} ms.`)), config.timeoutMs);
    let response;
    let reader;
    let stage = 'http';
    try {
      let url = new URL(PORTAL_SOURCE);
      for (let hop = 0; ; hop++) {
        response = await abortable(fetchImpl(url.href, {
          signal: controller.signal, redirect: 'manual',
          headers: { 'User-Agent': PORTAL_USER_AGENT, Accept: 'text/html, application/xhtml+xml', Connection: 'close' }
        }), controller.signal);
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        const next = location ? new URL(location, url) : null;
        void response.body?.cancel().catch(() => {});
        if (hop >= 4 || !next || next.protocol !== 'https:' || next.port || next.username || next.password ||
          !['portalecuador.com', 'www.portalecuador.com'].includes(next.hostname)) {
          throw new PortalError('PORTAL_REDIRECT', 'http', 'Redirección no permitida o excesiva en fuente de datos.');
        }
        url = next;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new PortalError(`PORTAL_HTTP_${response.status}`, 'http', `Fuente de datos respondió HTTP ${response.status}.`);
      }
      if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
        throw new PortalError('PORTAL_NOT_HTML', 'http', 'Fuente de datos no devolvió contenido HTML.');
      }
      const length = response.headers.get('content-length');
      if (length && Number(length) > config.maxBytes) throw new PortalError('PORTAL_TOO_LARGE', 'body', 'El documento excede el tamaño máximo permitido.');
      stage = 'body';
      if (!response.body) throw new PortalError('PORTAL_EMPTY_BODY', stage, 'La respuesta no contiene documento HTML.');
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await abortable(reader.read(), controller.signal);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > config.maxBytes) throw new PortalError('PORTAL_TOO_LARGE', stage, 'El documento excede el tamaño máximo permitido.');
        chunks.push(Buffer.from(value));
      }
      if (!bytes) throw new PortalError('PORTAL_EMPTY_BODY', stage, 'El documento está vacío.');
      return { html: Buffer.concat(chunks), consultado_en: new Date(now()).toISOString(), url_final: url.href };
    } catch (error) {
      throw asPortalError(controller.signal.aborted ? controller.signal.reason : error, stage);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch { /* Una lectura abortada puede estar terminando. */ }
      } else if (response?.body) void response.body.cancel().catch(() => {});
    }
  };
}

