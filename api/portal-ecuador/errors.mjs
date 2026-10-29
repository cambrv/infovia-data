export class PortalError extends Error {
  constructor(code, stage, message) {
    super(message);
    this.name = 'PortalError';
    this.code = code;
    this.stage = stage;
  }
}

export function asPortalError(error, stage = 'http') {
  if (error instanceof PortalError) return error;
  const code = error.code ?? error.cause?.code ?? 'PORTAL_NETWORK_ERROR';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(code)) stage = 'dns';
  else if (/CERT|TLS|SSL/.test(code)) stage = 'tls';
  else if (['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) stage = 'tcp';
  return new PortalError(/^[A-Z0-9_]{1,64}$/.test(code) ? code : 'PORTAL_NETWORK_ERROR', stage,
    stage === 'body' ? 'No se recibió el documento completo de la fuente de datos.' : 'Falló la conexión HTTP con la fuente de datos.');
}

export function abortable(operation, signal) {
  let abort;
  return Promise.race([operation, new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  })]).finally(() => signal.removeEventListener('abort', abort));
}

