import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { isValidE164PhoneNumber } from '../utils/phone';

// Load root .env first, then backend/.env if present
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return defaultValue;
      return val.toLowerCase() === 'true';
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
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().default('carevoice'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  VOICE_AGENT_INTERNAL_TOKEN: z
    .string()
    .min(16, 'VOICE_AGENT_INTERNAL_TOKEN must be at least 16 characters'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_ENABLED: boolFromEnv(true),

  VOICE_PROVIDER_MODE: z.enum(['mock', 'sarvam']).default('mock'),
  TELEPHONY_ENABLED: boolFromEnv(false),
  SARVAM_API_KEY: z.string().default(''),
  SARVAM_API_BASE_URL: z
    .string()
    .default('https://apps.sarvam.ai')
    .refine((v) => /^https?:\/\//i.test(v), 'SARVAM_API_BASE_URL must be an http(s) URL'),
  SARVAM_ORG_ID: z.string().default(''),
  SARVAM_WORKSPACE_ID: z.string().default(''),
  SARVAM_AGENT_ID: z.string().default(''),
  SARVAM_AGENT_VERSION: sarvamAgentVersionSchema,
  SARVAM_CONNECTION_ID: z.string().default(''),
  SARVAM_PHONE_NUMBER: z
    .string()
    .default('')
    .refine(
      (v) => v === '' || isValidE164PhoneNumber(v),
      'SARVAM_PHONE_NUMBER must be in strict E.164 format (e.g., +917965860596)'
    ),
  SARVAM_WEBHOOK_TOKEN: z
    .string()
    .default('')
    .refine(
      (v) => v === '' || v.length >= 24,
      'SARVAM_WEBHOOK_TOKEN must be at least 24 characters for high-entropy webhook route security'
    ),
  SARVAM_WEBHOOK_SECRET: z.string().default(''),
  PUBLIC_WEBHOOK_BASE_URL: z
    .string()
    .default('')
    .refine(
      (v) => v === '' || /^https?:\/\//i.test(v),
      'PUBLIC_WEBHOOK_BASE_URL must start with http:// or https://'
    ),

  WHATSAPP_ENABLED: boolFromEnv(false),
  WHATSAPP_PROVIDER_URL: z.string().default(''),
  WHATSAPP_API_TOKEN: z.string().default(''),
  SMS_ENABLED: boolFromEnv(false),
  SMS_PROVIDER_URL: z.string().default(''),
  SMS_API_TOKEN: z.string().default(''),

  ALLOW_DEV_DEMO_MODE: boolFromEnv(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;

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

  if (!hasPublicUrl) missingFields.push('PUBLIC_WEBHOOK_BASE_URL');
  if (!hasRouteToken && !hasHmacSecret) {
    missingFields.push('SARVAM_WEBHOOK_TOKEN');
  }

  return {
    ready: hasPublicUrl && (hasRouteToken || hasHmacSecret),
    missingFields,
    hasPublicUrl,
    isHttps,
    hasRouteToken,
    hasHmacSecret,
  };
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

