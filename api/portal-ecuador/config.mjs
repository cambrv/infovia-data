export const PORTAL_SOURCE = 'https://portalecuador.com/estado-vias';
export const PORTAL_USER_AGENT = 'InfoViaEC-Experimental/1.0 (road-report HTML evaluation; no browser automation)';

export function readPortalConfig(env = process.env) {
  const number = (name, fallback, min, max, integer = true) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
      throw new Error(`${name} debe estar entre ${min} y ${max}.`);
    }
    return value;
  };
  const enabled = env.PORTAL_ECUADOR_ENABLED === 'true';
  // Una configuración experimental inválida no impide arrancar la API oficial.
  if (!enabled) return { enabled: false };
  return {
    enabled,
    timeoutMs: number('PORTAL_ECUADOR_TIMEOUT_MS', 20_000, 1, 60_000),
    cacheMs: number('PORTAL_ECUADOR_CACHE_MINUTES', 15, 1, 1440) * 60_000,
    maxBytes: number('PORTAL_ECUADOR_MAX_RESPONSE_BYTES', 2_097_152, 1024, 10_485_760),
    minRecords: number('PORTAL_ECUADOR_MIN_RECORDS', 1, 1, 10_000),
    baselineCount: number('PORTAL_ECUADOR_BASELINE_COUNT', 0, 0, 10_000),
    minRetainedRatio: number('PORTAL_ECUADOR_MIN_RETAINED_RATIO', 0.8, 0.01, 1, false)
  };
}

