import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { isValidE164PhoneNumber } from '../utils/phone';

// Load root .env first, then backend/.env if present
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const trimmedString = (defaultValue = '') =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined) return defaultValue;
      const trimmed = val.trim();
      return trimmed === '' ? defaultValue : trimmed;
    });

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val.trim() === '') return defaultValue;
      return val.trim().toLowerCase() === 'true';
    });

const sarvamAgentVersionSchema = z
  .string()
  .optional()
  .transform((val, ctx) => {
    const trimmed = (val ?? '').trim();
    if (trimmed === '') return 1;
    if (!/^[1-9]\d*$/.test(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SARVAM_AGENT_VERSION must be a positive integer (e.g., 1)',
      });
      return z.NEVER;
    }
    const parsedInt = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsedInt) || parsedInt < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SARVAM_AGENT_VERSION must be a safe positive integer',
      });
      return z.NEVER;
    }
    return parsedInt;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: trimmedString('http://localhost:3000'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: trimmedString('carevoice'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: trimmedString('7d'),
  VOICE_AGENT_INTERNAL_TOKEN: z
    .string()
    .min(16, 'VOICE_AGENT_INTERNAL_TOKEN must be at least 16 characters'),

  REDIS_URL: trimmedString('redis://127.0.0.1:6379'),
  REDIS_ENABLED: boolFromEnv(true),

  VOICE_PROVIDER_MODE: z.enum(['mock', 'sarvam']).default('mock'),
  TELEPHONY_ENABLED: boolFromEnv(false),
  SARVAM_API_KEY: trimmedString(''),
  SARVAM_API_BASE_URL: trimmedString('https://apps.sarvam.ai').refine(
    (v) => /^https?:\/\//i.test(v),
    'SARVAM_API_BASE_URL must be an http(s) URL'
  ),
  SARVAM_ORG_ID: trimmedString(''),
  SARVAM_WORKSPACE_ID: trimmedString(''),
  SARVAM_AGENT_ID: trimmedString(''),
  SARVAM_AGENT_VERSION: sarvamAgentVersionSchema,
  SARVAM_CONNECTION_ID: trimmedString(''),
  SARVAM_PHONE_NUMBER: trimmedString('').refine(
    (v) => v === '' || isValidE164PhoneNumber(v),
    'SARVAM_PHONE_NUMBER must be in strict E.164 format (e.g., +917965860596)'
  ),
  SARVAM_WEBHOOK_TOKEN: trimmedString('').refine(
    (v) => v === '' || v.length >= 24,
    'SARVAM_WEBHOOK_TOKEN must be at least 24 characters for high-entropy webhook route security'
  ),
  SARVAM_WEBHOOK_SECRET: trimmedString(''),
  PUBLIC_WEBHOOK_BASE_URL: trimmedString('').refine(
    (v) => v === '' || /^https?:\/\//i.test(v),
    'PUBLIC_WEBHOOK_BASE_URL must start with http:// or https://'
  ),
  SARVAM_ALLOWED_LANGUAGES: trimmedString(''),

  WHATSAPP_ENABLED: boolFromEnv(false),
  WHATSAPP_PROVIDER_URL: trimmedString(''),
  WHATSAPP_API_TOKEN: trimmedString(''),
  SMS_ENABLED: boolFromEnv(false),
  SMS_PROVIDER_URL: trimmedString(''),
  SMS_API_TOKEN: trimmedString(''),

  ALLOW_DEV_DEMO_MODE: boolFromEnv(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;

export function getSarvamCredentialDiagnostics(): {
  validSyntax: boolean;
  issues: string[];
  hasSurroundingQuotes: boolean;
  hasInternalWhitespace: boolean;
  hasBearerPrefix: boolean;
  apiKeyLength: number;
  orgAndWorkspaceDistinct: boolean;
} {
  const issues: string[] = [];
  const key = env.SARVAM_API_KEY;
  const hasSurroundingQuotes = /^["']|["']$/.test(key);
  const hasInternalWhitespace = /\s/.test(key);
  const hasBearerPrefix = /^bearer\s+/i.test(key);

  if (!key) {
    issues.push('SARVAM_API_KEY is empty.');
  }
  if (hasSurroundingQuotes) {
    issues.push('SARVAM_API_KEY appears wrapped in literal quotes; store the raw key without quotes in Render.');
  }
  if (hasInternalWhitespace) {
    issues.push('SARVAM_API_KEY contains whitespace or line breaks.');
  }
  if (hasBearerPrefix) {
    issues.push('SARVAM_API_KEY should not include a "Bearer " prefix; X-API-Key expects the raw workspace key.');
  }

  for (const [label, val] of [
    ['SARVAM_ORG_ID', env.SARVAM_ORG_ID],
    ['SARVAM_WORKSPACE_ID', env.SARVAM_WORKSPACE_ID],
    ['SARVAM_AGENT_ID', env.SARVAM_AGENT_ID],
    ['SARVAM_CONNECTION_ID', env.SARVAM_CONNECTION_ID],
  ] as const) {
    if (val && (/^["']|["']$/.test(val) || /\s/.test(val))) {
      issues.push(`${label} contains quotes or whitespace.`);
    }
  }

  const orgAndWorkspaceDistinct =
    !env.SARVAM_ORG_ID ||
    !env.SARVAM_WORKSPACE_ID ||
    env.SARVAM_ORG_ID !== env.SARVAM_WORKSPACE_ID;

  if (!orgAndWorkspaceDistinct) {
    issues.push('SARVAM_ORG_ID and SARVAM_WORKSPACE_ID are identical; verify both IDs from Sarvam Settings.');
  }

  return {
    validSyntax: issues.length === 0,
    issues,
    hasSurroundingQuotes,
    hasInternalWhitespace,
    hasBearerPrefix,
    apiKeyLength: key.length,
    orgAndWorkspaceDistinct,
  };
}

export function getSarvamWebhookReadiness(): {
  ready: boolean;
  missingFields: string[];
  hasPublicUrl: boolean;
  isHttps: boolean;
  hasRouteToken: boolean;
  hasHmacSecret: boolean;
} {
  const missingFields: string[] = [];
  const hasPublicUrl = Boolean(env.PUBLIC_WEBHOOK_BASE_URL);
  const isHttps = /^https:\/\//i.test(env.PUBLIC_WEBHOOK_BASE_URL);
  const hasRouteToken = env.SARVAM_WEBHOOK_TOKEN.length >= 24;
  const hasHmacSecret = env.SARVAM_WEBHOOK_SECRET.length >= 16;

  if (!hasPublicUrl) {
    missingFields.push('PUBLIC_WEBHOOK_BASE_URL');
  } else if (!isHttps) {
    missingFields.push('PUBLIC_WEBHOOK_BASE_URL (must use https://)');
  }
  if (!hasRouteToken && !hasHmacSecret) {
    missingFields.push('SARVAM_WEBHOOK_TOKEN');
  }

  return {
    ready: hasPublicUrl && isHttps && (hasRouteToken || hasHmacSecret),
    missingFields,
    hasPublicUrl,
    isHttps,
    hasRouteToken,
    hasHmacSecret,
  };
}

export function isMockSimulationAllowed(): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_DEV_DEMO_MODE;
}

export function isTelephonyReady(): {
  ready: boolean;
  missingFields: string[];
  mode: 'mock' | 'sarvam';
} {
  const missingFields: string[] = [];
  if (env.VOICE_PROVIDER_MODE !== 'sarvam') missingFields.push('VOICE_PROVIDER_MODE=sarvam');
  if (!env.TELEPHONY_ENABLED) missingFields.push('TELEPHONY_ENABLED=true');
  if (!env.SARVAM_API_KEY) missingFields.push('SARVAM_API_KEY');
  if (!env.SARVAM_ORG_ID) missingFields.push('SARVAM_ORG_ID');
  if (!env.SARVAM_WORKSPACE_ID) missingFields.push('SARVAM_WORKSPACE_ID');
  if (!env.SARVAM_AGENT_ID) missingFields.push('SARVAM_AGENT_ID');
  if (!env.SARVAM_CONNECTION_ID) missingFields.push('SARVAM_CONNECTION_ID');
  if (!env.SARVAM_PHONE_NUMBER || !isValidE164PhoneNumber(env.SARVAM_PHONE_NUMBER)) {
    missingFields.push('SARVAM_PHONE_NUMBER');
  }

  const ready =
    env.VOICE_PROVIDER_MODE === 'sarvam' &&
    env.TELEPHONY_ENABLED &&
    missingFields.length === 0;

  return {
    ready,
    missingFields,
    mode: ready ? 'sarvam' : 'mock',
  };
}

