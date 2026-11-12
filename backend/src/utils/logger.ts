const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'jwt',
  'apiKey',
  'x-api-key',
  'sarvam_api_key',
  'sarvam_webhook_token',
  'sarvam_webhook_secret',
  'webhookToken',
  'MONGODB_URI',
  'authorization',
  'secret',
];

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/(\/webhook\/sarvam\/)[^?\s"']+/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  }
  return value;
}

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return sanitizeValue(obj);
  if (Array.isArray(obj)) return obj.map(redact);

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
      output[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      output[key] = redact(value);
    } else {
      output[key] = sanitizeValue(value);
    }
  }
  return output;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    const payload = meta ? ` ${JSON.stringify(redact(meta))}` : '';
    console.log(`[INFO] ${new Date().toISOString()} ${message}${payload}`);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    const payload = meta ? ` ${JSON.stringify(redact(meta))}` : '';
    console.warn(`[WARN] ${new Date().toISOString()} ${message}${payload}`);
  },
  error(message: string, meta?: Record<string, unknown>) {
    const payload = meta ? ` ${JSON.stringify(redact(meta))}` : '';
    console.error(`[ERROR] ${new Date().toISOString()} ${message}${payload}`);
  },
};

