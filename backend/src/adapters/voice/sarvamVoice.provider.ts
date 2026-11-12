import {
  env,
  getSarvamCredentialDiagnostics,
  getSarvamWebhookReadiness,
  isTelephonyReady,
} from '../../config/env';
import {
  buildLocalizedInitialGreeting,
  checkSarvamLanguageSupport,
  getLanguageMeta,
  tryGetSupportedLanguage,
} from '../../constants/languages';
import { CallErrorCategory } from '../../constants/statuses';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { normalizeAndValidateE164 } from '../../utils/phone';
import {
  IVoiceProvider,
  MockCallScenario,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from './voiceProvider.interface';

export type SarvamAuthCategory =
  | 'VERIFIED'
  | 'CONNECTION_VERIFICATION_UNAVAILABLE'
  | 'CONFIG_MISSING'
  | 'KEY_SYNTAX_ERROR'
  | 'INVALID_API_KEY_FORMAT'
  | 'UNAUTHORIZED_INVALID_OR_REVOKED_KEY'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'WORKSPACE_OR_ORG_NOT_FOUND'
  | 'APP_NOT_FOUND_IN_WORKSPACE'
  | 'AGENT_UNVERIFIED_IN_WORKSPACE'
  | 'DEPLOYMENT_INACTIVE'
  | 'DEPLOYMENT_MISMATCH'
  | 'LANGUAGE_UNSUPPORTED'
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_ERROR';

export type SarvamPreflightCheckStatus =
  | 'VERIFIED'
  | 'READY'
  | 'CONNECTION_VERIFICATION_UNAVAILABLE'
  | 'UNVERIFIED'
  | 'INACTIVE'
  | 'MISMATCH'
  | 'NOT_FOUND'
  | 'MISSING'
  | 'ERROR';

export interface SarvamPreflightCheckItem {
  status: SarvamPreflightCheckStatus;
  label: string;
  detail: string;
  blocking: boolean;
  source?: string;
}

export interface SarvamPreflightChecks {
  apiAuthentication: SarvamPreflightCheckItem;
  agentIdAndVersion: SarvamPreflightCheckItem;
  connectionIdValidity: SarvamPreflightCheckItem;
  callerNumberAvailability: SarvamPreflightCheckItem;
  outboundCapability: SarvamPreflightCheckItem;
  webhookReadiness: SarvamPreflightCheckItem;
  dynamicVariableCompatibility: SarvamPreflightCheckItem;
}

/**
 * Exact 8 input variables currently configured on the Sarvam "Family Medicine Assistant"
 * Variables page (live committed baseline — prevents HTTP 422 unknown-variable rejections).
 */
export const SARVAM_CANONICAL_COMMITTED_VARIABLES = [
  'call_purpose',
  'doctor_instructions',
  'dosage',
  'dose_number',
  'food_instruction',
  'meal',
  'medicine_name',
  'user_name',
] as const;

/**
 * Minimum 5 additional variables to add on Sarvam Canvas -> Variables to expose
 * full language steering & meal slot context to the prompt alongside app_overrides.
 */
export const SARVAM_CANONICAL_ADDITIONAL_VARIABLES = [
  'language_name',
  'language_code',
  'language_directive',
  'associated_meal',
  'slot_label',
] as const;

export const CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS = [
  ...SARVAM_CANONICAL_COMMITTED_VARIABLES,
  ...SARVAM_CANONICAL_ADDITIONAL_VARIABLES,
] as const;

/**
 * Keys that MUST NEVER be sent inside Sarvam `app_config.agent_variables`:
 * - Internal CareVoice DB identifiers (stored in CareVoice & private webhook_config.metadata only)
 * - Duplicate aliases already represented by canonical keys (`user_name`, `language_name`, `call_purpose`)
 * - Unsupported voice-persona overrides (Sarvam configures per-language voices in Canvas -> Speakers & voice)
 */
export const CAREVOICE_INTERNAL_ONLY_VARIABLES = [
  'patient_id',
  'dose_id',
  'call_log_id',
  'family_id',
  'patient_name',
  'preferred_language',
  'language_bcp47',
  'call_type',
  'voice_gender',
  'recommended_voice',
] as const;

export type CareVoiceCanonicalVariableKey =
  (typeof CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS)[number];

const CANONICAL_VARIABLE_KEY_SET = new Set<string>(CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS);
const INTERNAL_ONLY_VARIABLE_SET = new Set<string>(CAREVOICE_INTERNAL_ONLY_VARIABLES);

export function parseConfiguredAllowedAgentVariables(
  raw = env.SARVAM_ALLOWED_AGENT_VARIABLES,
  profile: 'committed' | 'extended' = env.SARVAM_AGENT_VARIABLE_PROFILE
): string[] {
  const trimmed = (raw || '').trim();
  if (trimmed) {
    if (trimmed.toLowerCase() === 'none') return [];
    return Array.from(
      new Set(
        trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
  return profile === 'extended'
    ? [...CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS]
    : [...SARVAM_CANONICAL_COMMITTED_VARIABLES];
}

export function parseAgentVariableAliasMap(
  raw = env.SARVAM_AGENT_VARIABLE_MAP
): Record<string, CareVoiceCanonicalVariableKey> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new AppError(
      'SARVAM_AGENT_VARIABLE_MAP must be valid JSON mapping Sarvam variable names to CareVoice canonical keys',
      422,
      'CONFIGURATION_ERROR',
      { errorCategory: 'CONFIGURATION_ERROR' }
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(
      'SARVAM_AGENT_VARIABLE_MAP must be a JSON object of { "<sarvamKey>": "<canonicalKey>" }',
      422,
      'CONFIGURATION_ERROR',
      { errorCategory: 'CONFIGURATION_ERROR' }
    );
  }

  const out: Record<string, CareVoiceCanonicalVariableKey> = {};
  for (const [sarvamKey, canonicalKey] of Object.entries(parsed as Record<string, unknown>)) {
    const cleanSarvamKey = sarvamKey.trim();
    const cleanCanonical = typeof canonicalKey === 'string' ? canonicalKey.trim() : '';
    if (!cleanSarvamKey || !CANONICAL_VARIABLE_KEY_SET.has(cleanCanonical)) {
      throw new AppError(
        `Invalid SARVAM_AGENT_VARIABLE_MAP entry "${sarvamKey}" -> "${String(
          canonicalKey
        )}". Supported CareVoice canonical keys: ${CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS.join(', ')}`,
        422,
        'CONFIGURATION_ERROR',
        {
          errorCategory: 'CONFIGURATION_ERROR',
          invalidVariables: [cleanSarvamKey || sarvamKey],
        }
      );
    }
    out[cleanSarvamKey] = cleanCanonical as CareVoiceCanonicalVariableKey;
  }
  return out;
}

export function resolveSarvamAgentVariables(
  canonicalValues: Record<CareVoiceCanonicalVariableKey, string>,
  options?: {
    allowedVariablesCsv?: string;
    profile?: 'committed' | 'extended';
    aliasMapJson?: string;
    extraAgentVariables?: Record<string, string>;
  }
): Record<string, string> | undefined {
  const allowedKeys = parseConfiguredAllowedAgentVariables(
    options?.allowedVariablesCsv ?? env.SARVAM_ALLOWED_AGENT_VARIABLES,
    options?.profile ?? env.SARVAM_AGENT_VARIABLE_PROFILE
  );
  const aliasMap = parseAgentVariableAliasMap(
    options?.aliasMapJson ?? env.SARVAM_AGENT_VARIABLE_MAP
  );
  const allowedSet = new Set(allowedKeys);
  const extraVars = options?.extraAgentVariables ?? {};

  // Reject any explicit override/dynamic variable that is internal-only, duplicate, or not in configured Sarvam schema BEFORE dialing
  const disallowedExtras = Object.keys(extraVars).filter(
    (key) => INTERNAL_ONLY_VARIABLE_SET.has(key) || !allowedSet.has(key)
  );
  if (disallowedExtras.length > 0) {
    throw new AppError(
      `Attempted to send unconfigured or internal-only Sarvam agent variable(s) [${disallowedExtras.join(
        ', '
      )}]. Allowed schema: [${allowedKeys.join(', ') || 'none'}]`,
      422,
      'CONFIGURATION_ERROR',
      {
        errorCategory: 'CONFIGURATION_ERROR',
        invalidVariables: disallowedExtras,
        allowedVariables: allowedKeys,
      }
    );
  }

  if (allowedKeys.length === 0) {
    return undefined;
  }

  const resolved: Record<string, string> = {};
  const invalidSchemaKeys: string[] = [];

  for (const sarvamKey of allowedKeys) {
    if (INTERNAL_ONLY_VARIABLE_SET.has(sarvamKey) && !aliasMap[sarvamKey]) {
      invalidSchemaKeys.push(sarvamKey);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(extraVars, sarvamKey)) {
      resolved[sarvamKey] = String(extraVars[sarvamKey] ?? '');
      continue;
    }
    const mappedCanonicalKey =
      aliasMap[sarvamKey] ??
      (CANONICAL_VARIABLE_KEY_SET.has(sarvamKey)
        ? (sarvamKey as CareVoiceCanonicalVariableKey)
        : undefined);
    if (!mappedCanonicalKey) {
      invalidSchemaKeys.push(sarvamKey);
      continue;
    }
    resolved[sarvamKey] = canonicalValues[mappedCanonicalKey] ?? '';
  }

  if (invalidSchemaKeys.length > 0) {
    throw new AppError(
      `Invalid or internal-only key(s) in configured Sarvam agent variable schema: [${invalidSchemaKeys.join(
        ', '
      )}]. Internal DB IDs (patient_id, dose_id, call_log_id), duplicate aliases (patient_name, preferred_language), and unsupported voice keys (voice_gender) must not be sent as agent variables.`,
      422,
      'CONFIGURATION_ERROR',
      {
        errorCategory: 'CONFIGURATION_ERROR',
        invalidVariables: invalidSchemaKeys,
        supportedCanonicalVariables: [...CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS],
      }
    );
  }

  return resolved;
}

export interface SarvamOutboundRequestPayload {
  app_config: {
    app_id: string;
    app_version: number;
    connection_config: {
      connection_id: string;
      agent_phone_number: string;
    };
    agent_variables?: Record<string, string>;
    app_overrides?: {
      initial_language_name?: string;
      initial_bot_message?: string;
    };
  };
  user_config: {
    user_phone_number: string;
  };
  webhook_config?: {
    url: string;
    metadata: {
      patient_id: string;
      dose_id: string;
      call_log_id: string;
      family_id: string;
      call_type: string;
      language: string;
      preferred_language_name?: string;
      patient_name?: string;
      medicine_name?: string;
      dosage?: string;
      food_instruction?: string;
      associated_meal?: string;
      recording_consent_granted?: string;
      transcript_consent_granted?: string;
      call_purpose?: string;
      is_test_call?: string;
    };
  };
}

export interface SarvamAnalyticsAttemptRecord {
  attempt_id?: string;
  connectivity_status?: string;
  failure_reason?: string;
  ended_by?: string;
  duration_in_seconds?: number;
  start_datetime?: string;
  end_datetime?: string;
  attempted_at?: string;
  language_name?: string;
  interaction_id?: string;
  audio_url?: string;
  agent_variables?: Record<string, unknown>;
}

export interface SarvamAnalyticsInteractionRecord {
  interaction_id?: string;
  app_version?: number;
  start_datetime?: string;
  end_datetime?: string;
  duration_in_seconds?: number;
  language_name?: string;
  original_transcript?: unknown;
  translate_transcript?: unknown;
  agent_variables?: Record<string, unknown>;
  audio_url?: string;
}

export interface SarvamAnalyticsTranscriptMessage {
  turn_id?: number | string;
  role?: string;
  content?: string;
  language_name?: string;
}

export function parseSarvamUtcTimestamp(raw?: string | null): Date | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Sarvam Analytics timestamps omit trailing 'Z' (e.g., '2026-10-07T05:12:08'); treat naive timestamps as UTC.
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const candidate = hasZone ? trimmed : `${trimmed}Z`;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed);
}

export type SarvamDiscoverySource =
  | 'deployment'
  | 'campaign'
  | 'experiment'
  | 'test_suite'
  | 'analytics';

export interface SarvamDiscoveredAppSummary {
  appId: string;
  matchesConfiguredAppId: boolean;
  sources: SarvamDiscoverySource[];
  versions: number[];
  statuses: string[];
  deploymentIds: string[];
  campaignIds: string[];
  connectionIds: string[];
  phoneNumbersMasked: string[];
  matchesVersion?: boolean;
  matchesConnectionId?: boolean;
  matchesPhoneNumber?: boolean;
}

export interface SarvamDiscoveredConnectionSummary {
  connectionId: string;
  matchesConfiguredConnectionId: boolean;
  phoneNumbersMasked: string[];
  matchesConfiguredPhone: boolean;
  source: 'deployment' | 'campaign';
}

export interface SarvamWorkspaceDiscoverySummary {
  orgId: string;
  workspaceId: string;
  configuredAgentId: string;
  configuredAgentVersion: number;
  configuredConnectionId: string;
  configuredPhoneMasked: string;
  analyticsAppCheckStatus?: number;
  analyticsAppCheckDetail?: string;
  analyticsTotalInteractions?: number;
  analyticsCallerPhonesMasked?: string[];
  observedAgentVariables?: string[];
  configuredAllowedAgentVariables?: string[];
  endpointsChecked: string[];
  discoveredApps: SarvamDiscoveredAppSummary[];
  discoveredConnections: SarvamDiscoveredConnectionSummary[];
}

export interface SarvamDeploymentVerificationResult {
  verified: boolean;
  instantOutboundReady: boolean;
  inboundDeploymentReady: boolean;
  campaignReady: boolean;
  connectionVerificationUnavailable: boolean;
  status:
    | 'active'
    | 'verified_campaign'
    | 'instant_outbound_ready'
    | 'connection_verification_unavailable'
    | 'inactive'
    | 'mismatch'
    | 'not_found'
    | 'unverified'
    | 'error';
  authCategory: SarvamAuthCategory;
  matchedDeploymentId?: string;
  matchedAppVersion?: number;
  connectionVerified: boolean;
  phoneVerified: boolean;
  message: string;
  upstreamStatus?: number;
  upstreamDetail?: string;
  diagnosticHint?: string;
  authHeader: 'X-API-Key';
  credentialsSharedWithOutbound: boolean;
  checks: SarvamPreflightChecks;
  workspaceDiscovery?: SarvamWorkspaceDiscoverySummary;
}

interface SarvamDeploymentRecord {
  deployment_id?: string;
  app_id?: string;
  app_version?: number;
  status?: string;
  channel_direction?: string;
  phone_numbers?: string[];
  connection_configs?: Array<{
    connection_id?: string;
    phone_numbers?: string[];
    agent_phone_number?: string;
  }>;
}

interface SarvamCampaignRecord {
  campaign_id?: string;
  name?: string;
  status?: string;
  app_id?: string;
  app_version?: number;
  app_config?: {
    app_id?: string;
    app_version?: number;
    connection_configs?: Array<{
      connection_id?: string;
      phone_numbers?: string[];
      agent_phone_number?: string;
    }>;
  };
}

interface SarvamExperimentRecord {
  experiment_id?: string;
  name?: string;
  variants?: Array<{
    app_config?: {
      app_id?: string;
      app_version?: number;
    };
  }>;
}

interface SarvamTestSuiteRecord {
  test_suite_id?: string;
  name?: string;
  app_id?: string;
}

function maskPhoneSafe(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 6) return '***';
  return `${trimmed.slice(0, 3)}******${trimmed.slice(-4)}`;
}

function extractPagedItems<T>(json: unknown, altKeys: string[] = []): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === 'object') {
    const rec = json as Record<string, unknown>;
    for (const key of ['items', ...altKeys, 'data']) {
      if (Array.isArray(rec[key])) {
        return rec[key] as T[];
      }
    }
  }
  return [];
}

function redactSecrets(input: string): string {
  let sanitized = input;
  for (const secret of [
    env.SARVAM_API_KEY,
    env.SARVAM_WEBHOOK_TOKEN,
    env.SARVAM_WEBHOOK_SECRET,
  ]) {
    if (secret && secret.length >= 6) {
      sanitized = sanitized.split(secret).join('[REDACTED]');
    }
  }
  sanitized = sanitized
    .replace(/(x-api-key|api-subscription-key|authorization)\s*[:=]\s*[^\s,;}"']+/gi, '$1: [REDACTED]');
  return sanitized;
}

async function parseSarvamResponseBody(response: Response): Promise<{
  rawText: string;
  json: unknown;
}> {
  if (typeof response.text === 'function') {
    const rawText = await response.text().catch(() => '');
    if (!rawText) return { rawText: '', json: null };
    try {
      return { rawText, json: JSON.parse(rawText) };
    } catch {
      return { rawText, json: null };
    }
  }
  if (typeof response.json === 'function') {
    const json = await response.json().catch(() => null);
    return { rawText: '', json };
  }
  return { rawText: '', json: null };
}

function extractSarvamErrorDetails(rawText: string, json: unknown): {
  summary?: string;
  detailsOnly?: string;
} {
  const obj =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};

  // Nested Sarvam gateway format: { error: { message, type, code, data: { details } } }
  if (obj.error && typeof obj.error === 'object' && !Array.isArray(obj.error)) {
    const errObj = obj.error as Record<string, unknown>;
    const msg = typeof errObj.message === 'string' ? errObj.message.trim() : '';
    const dataObj =
      errObj.data && typeof errObj.data === 'object' && !Array.isArray(errObj.data)
        ? (errObj.data as Record<string, unknown>)
        : {};
    const nestedDetails =
      typeof dataObj.details === 'string'
        ? dataObj.details.trim()
        : typeof dataObj.detail === 'string'
          ? dataObj.detail.trim()
          : '';
    const parts = [msg, nestedDetails].filter(Boolean);
    if (parts.length > 0) {
      const combined = redactSecrets(parts.join(' — ')).slice(0, 360);
      return {
        summary: combined,
        detailsOnly: redactSecrets(nestedDetails || msg).slice(0, 260),
      };
    }
  }

  // FastAPI validation list shape: { detail: [{ loc: [...], msg: "..." }] }
  if (Array.isArray(obj.detail)) {
    const items = obj.detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          const loc = Array.isArray(rec.loc) ? rec.loc.join('.') : '';
          const msg = typeof rec.msg === 'string' ? rec.msg : '';
          return loc && msg ? `${loc}: ${msg}` : msg || loc;
        }
        return typeof item === 'string' ? item : '';
      })
      .filter(Boolean);
    if (items.length > 0) {
      const combined = redactSecrets(items.join('; ')).slice(0, 360);
      return { summary: combined, detailsOnly: combined };
    }
  }

  const flat =
    typeof obj.detail === 'string'
      ? obj.detail.trim()
      : typeof obj.message === 'string'
        ? obj.message.trim()
        : typeof obj.error === 'string'
          ? obj.error.trim()
          : '';

  if (flat) {
    const safe = redactSecrets(flat).slice(0, 360);
    return { summary: safe, detailsOnly: safe };
  }

  const trimmedRaw = rawText.trim();
  if (trimmedRaw) {
    const safe = redactSecrets(trimmedRaw).slice(0, 240);
    return { summary: safe, detailsOnly: safe };
  }

  return {};
}

function classifySarvamHttpFailure(
  statusCode: number,
  extractedSummary?: string
): {
  authCategory: SarvamAuthCategory;
  errorCategory: CallErrorCategory;
  diagnosticHint: string;
} {
  const detailText = extractedSummary || '';

  if (statusCode === 401) {
    if (/invalid api key format|provide a bearer token or x-api-key|api key required/i.test(detailText)) {
      return {
        authCategory: 'INVALID_API_KEY_FORMAT',
        errorCategory: 'AUTHENTICATION_ERROR',
        diagnosticHint:
          'Sarvam Voice Agents (apps.sarvam.ai) rejected SARVAM_API_KEY at X-API-Key format validation before checking workspace permissions. Generate a Voice Agents Workspace API Key in https://apps.sarvam.ai -> select workspace -> Settings -> API Key (do NOT use a dashboard.sarvam.ai Model API subscription key), and store the raw key without quotes or spaces.',
      };
    }
    return {
      authCategory: 'UNAUTHORIZED_INVALID_OR_REVOKED_KEY',
      errorCategory: 'AUTHENTICATION_ERROR',
      diagnosticHint:
        'Sarvam returned HTTP 401 Unauthorized. Confirm SARVAM_API_KEY is active (not expired or revoked), has no accidental quotes/whitespace, and was created for the configured workspace in https://apps.sarvam.ai -> Settings -> API Key.',
    };
  }

  if (statusCode === 403) {
    return {
      authCategory: 'INSUFFICIENT_PERMISSIONS',
      errorCategory: 'AUTHENTICATION_ERROR',
      diagnosticHint:
        'Sarvam returned HTTP 403 Forbidden. The API key was recognized, but lacks permissions for the configured SARVAM_ORG_ID / SARVAM_WORKSPACE_ID. Generate a Workspace API key inside the target workspace in https://apps.sarvam.ai.',
    };
  }

  if (statusCode === 404) {
    if (/\bapp\b.*not found|\bagent\b.*not found/i.test(detailText)) {
      return {
        authCategory: 'APP_NOT_FOUND_IN_WORKSPACE',
        errorCategory: 'CONFIGURATION_ERROR',
        diagnosticHint:
          'Sarvam returned HTTP 404 because SARVAM_AGENT_ID does not match a committed/accessible agent inside the configured SARVAM_ORG_ID + SARVAM_WORKSPACE_ID. Do not copy the browser URL slug: open the agent in https://apps.sarvam.ai, click "···" -> "Copy agent ID", ensure the agent version is Committed (not Draft), and update SARVAM_AGENT_ID & SARVAM_AGENT_VERSION.',
      };
    }
    return {
      authCategory: 'WORKSPACE_OR_ORG_NOT_FOUND',
      errorCategory: 'CONFIGURATION_ERROR',
      diagnosticHint:
        'Sarvam returned HTTP 404 Not Found. Confirm SARVAM_ORG_ID and SARVAM_WORKSPACE_ID belong to the same Sarvam account/workspace.',
    };
  }

  if (statusCode === 400 || statusCode === 422) {
    // IMPORTANT: Check Agent Variable / Parameter schema mismatch BEFORE language checks so
    // rejected variable names like "language_name" are NEVER misclassified as LANGUAGE_UNSUPPORTED.
    if (
      /agent variables?\s+not found|not found in agent variables|invalid parameter|unknown variable|missing.*required.*variable|extra inputs are not permitted|field required/i.test(
        detailText
      )
    ) {
      return {
        authCategory: 'CONFIGURATION_ERROR',
        errorCategory: 'CONFIGURATION_ERROR',
        diagnosticHint:
          'Sarvam rejected custom agent_variables or outbound parameters not present in the committed Sarvam agent schema (HTTP 400/422). Ensure SARVAM_ALLOWED_AGENT_VARIABLES matches ONLY the variables defined & committed in Sarvam Canvas for SARVAM_AGENT_VERSION (or leave SARVAM_ALLOWED_AGENT_VARIABLES empty so CareVoice uses app_overrides + webhook_config.metadata without unconfigured agent variables).',
      };
    }

    if (
      /\binitial_language_name\b|\bunsupported language\b|\blanguage\b.*\b(?:not supported|not enabled|unavailable)\b/i.test(
        detailText
      )
    ) {
      return {
        authCategory: 'LANGUAGE_UNSUPPORTED',
        errorCategory: 'LANGUAGE_UNAVAILABLE',
        diagnosticHint:
          'Sarvam rejected the requested initial_language_name. Enable this language (e.g., Telugu) and assign a per-language voice persona on Sarvam Canvas -> Settings -> Language personalisation & Speakers & voice, or obtain caregiver permission for an explicit fallback language.',
      };
    }

    if (/connection|phone_number|agent_phone_number|vobiz/i.test(detailText)) {
      return {
        authCategory: 'CONFIGURATION_ERROR',
        errorCategory: 'CONFIGURATION_ERROR',
        diagnosticHint:
          'Sarvam rejected the telephony connection_id or agent_phone_number. Open https://apps.sarvam.ai -> Deploy -> Phone Numbers -> Sarvam Vobiz (Rent from Sarvam) to copy the exact connection ID and rented phone number into SARVAM_CONNECTION_ID and SARVAM_PHONE_NUMBER (no external Vobiz credentials required).',
      };
    }

    return {
      authCategory: 'CONFIGURATION_ERROR',
      errorCategory: 'CONFIGURATION_ERROR',
      diagnosticHint:
        'Sarvam returned HTTP 400/422 validation error. Verify SARVAM_AGENT_VERSION, SARVAM_CONNECTION_ID, SARVAM_PHONE_NUMBER, and agent variables schema.',
    };
  }

  return {
    authCategory: 'UPSTREAM_ERROR',
    errorCategory: 'PROVIDER_ERROR',
    diagnosticHint:
      'Sarvam Voice Agents API returned a non-2xx error. Verify agent ID, committed version, Sarvam Vobiz connection ID (Rent from Sarvam), and Sarvam API service status.',
  };
}

/**
 * Official Sarvam AI Voice Agents Instant Outbound Call Adapter.
 * Documentation: https://docs.sarvam.ai/voice-agents/api/instant-outbound/create
 *
 * Security & Safety Guardrails:
 * - Real telephony stays strictly disabled unless VOICE_PROVIDER_MODE=sarvam AND
 *   TELEPHONY_ENABLED=true AND all required Sarvam credentials + E.164 phone number exist.
 * - Never invents undocumented endpoints or payload fields.
 * - Never logs API keys, authorization headers, or high-entropy webhook route tokens.
 */
export class SarvamVoiceProvider implements IVoiceProvider {
  public readonly providerName = 'sarvam' as const;

  isConfigured(): boolean {
    return isTelephonyReady().ready;
  }

  getStatus() {
    const info = isTelephonyReady();
    const webhookInfo = getSarvamWebhookReadiness();
    return {
      provider: 'sarvam' as const,
      configured: info.ready,
      telephonyEnabled: env.TELEPHONY_ENABLED,
      missingFields: info.missingFields,
      webhookReady: webhookInfo.ready,
      missingWebhookFields: webhookInfo.missingFields,
    };
  }

  public getOutboundEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/outbounds/v1/orgs/${orgId}/workspaces/${workspaceId}/outbounds`;
  }

  public getDeploymentsEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/app-authoring/v1/orgs/${orgId}/workspaces/${workspaceId}/deployments`;
  }

  public getDeploymentDetailEndpointUrl(deploymentId: string): string {
    return `${this.getDeploymentsEndpointUrl()}/${encodeURIComponent(deploymentId)}`;
  }

  public getCampaignsEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/scheduling/v1/orgs/${orgId}/workspaces/${workspaceId}/campaigns`;
  }

  public getCampaignDetailEndpointUrl(campaignId: string): string {
    return `${this.getCampaignsEndpointUrl()}/${encodeURIComponent(campaignId)}`;
  }

  public getExperimentsEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/scheduling/v1/orgs/${orgId}/workspaces/${workspaceId}/experiments`;
  }

  public getTestSuitesEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/evals/v1/${orgId}/${workspaceId}/test-suites`;
  }

  public getTestSuiteMappingEndpointUrl(testSuiteId: string, appId: string): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/evals/v1/${orgId}/${workspaceId}/test-suites/${encodeURIComponent(
      testSuiteId
    )}/mappings?app_id=${encodeURIComponent(appId)}`;
  }

  public getAnalyticsInteractionsEndpointUrl(
    appId: string,
    startIso: string,
    endIso: string,
    options?: { includeTranscript?: boolean; filterConditions?: string; limit?: number }
  ): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    const params = new URLSearchParams({
      start_datetime: startIso,
      end_datetime: endIso,
      limit: String(options?.limit ?? 1),
    });
    if (options?.includeTranscript) {
      params.set('include_transcript', 'true');
    }
    if (options?.filterConditions) {
      params.set('filter_conditions', options.filterConditions);
    }
    return `${baseUrl}/api/analytics/v1/${orgId}/${workspaceId}/${encodeURIComponent(
      appId
    )}/interactions?${params.toString()}`;
  }

  public getAnalyticsAttemptsEndpointUrl(
    appId: string,
    startIso: string,
    endIso: string,
    filterConditions?: string,
    limit = 5
  ): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    const params = new URLSearchParams({
      start_datetime: startIso,
      end_datetime: endIso,
      limit: String(limit),
    });
    if (filterConditions) {
      params.set('filter_conditions', filterConditions);
    }
    return `${baseUrl}/api/analytics/v1/${orgId}/${workspaceId}/${encodeURIComponent(
      appId
    )}/attempts?${params.toString()}`;
  }

  public getTranscriptEndpointUrl(interactionId: string): string {
    const trimmed = interactionId.trim();
    if (trimmed.includes('..') || !/^(?:[0-9]{8}\/)?[A-Za-z0-9._:-]+$/.test(trimmed)) {
      throw new AppError(
        'Invalid Sarvam interaction_id format for transcript retrieval',
        400,
        'INVALID_INTERACTION_ID'
      );
    }
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    const appId = encodeURIComponent(env.SARVAM_AGENT_ID);
    return `${baseUrl}/api/analytics/v1/${orgId}/${workspaceId}/${appId}/transcripts/${trimmed}`;
  }

  public getCredentialParitySummary() {
    return {
      authHeader: 'X-API-Key' as const,
      preflightEndpoint: this.getDeploymentsEndpointUrl(),
      outboundEndpoint: this.getOutboundEndpointUrl(),
      sameApiBaseUrl: true,
      sameOrgId: env.SARVAM_ORG_ID,
      sameWorkspaceId: env.SARVAM_WORKSPACE_ID,
      sameAgentId: env.SARVAM_AGENT_ID,
      agentVersion: env.SARVAM_AGENT_VERSION,
      connectionId: env.SARVAM_CONNECTION_ID,
    };
  }

  public getConfiguredAgentVariableSummary() {
    return {
      profile: env.SARVAM_AGENT_VARIABLE_PROFILE,
      allowedAgentVariables: parseConfiguredAllowedAgentVariables(),
      committedVariables: [...SARVAM_CANONICAL_COMMITTED_VARIABLES],
      additionalCanvasVariables: [...SARVAM_CANONICAL_ADDITIONAL_VARIABLES],
      internalOnlyVariables: [...CAREVOICE_INTERNAL_ONLY_VARIABLES],
      variableAliasMap: parseAgentVariableAliasMap(),
      supportedCanonicalVariables: [...CAREVOICE_CANONICAL_AGENT_VARIABLE_KEYS],
    };
  }

  public getRecordingEndpointUrl(interactionId: string): string {
    const trimmed = interactionId.trim();
    if (trimmed.includes('..') || !/^(?:[0-9]{8}\/)?[A-Za-z0-9._:-]+$/.test(trimmed)) {
      throw new AppError(
        'Invalid Sarvam interaction_id format for recording retrieval',
        400,
        'INVALID_INTERACTION_ID'
      );
    }
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    const appId = encodeURIComponent(env.SARVAM_AGENT_ID);
    return `${baseUrl}/api/analytics/v1/${orgId}/${workspaceId}/${appId}/recordings/${trimmed}`;
  }

  private async safeGetSarvamJson(
    url: string,
    timeoutMs = 6000
  ): Promise<{
    ok: boolean;
    status: number;
    json: unknown;
    errorSummary?: string;
  }> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': env.SARVAM_API_KEY,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const parsed = await parseSarvamResponseBody(response);
      if (!response.ok) {
        const extracted = extractSarvamErrorDetails(parsed.rawText, parsed.json);
        return {
          ok: false,
          status: response.status,
          json: parsed.json,
          errorSummary: extracted.summary,
        };
      }
      return {
        ok: true,
        status: response.status,
        json: parsed.json,
      };
    } catch (err) {
      const msg = redactSecrets(err instanceof Error ? err.message : 'Network error');
      return {
        ok: false,
        status: 0,
        json: null,
        errorSummary: msg,
      };
    }
  }

  private async discoverWorkspaceReadOnly(
    deploymentsList: SarvamDeploymentRecord[],
    configuredPhone: string
  ): Promise<{
    summary: SarvamWorkspaceDiscoverySummary;
    enrichedCampaignDetails: SarvamCampaignRecord[];
  }> {
    const endpointsChecked: string[] = ['deployments'];
    const appMap = new Map<
      string,
      {
        sources: Set<SarvamDiscoverySource>;
        versions: Set<number>;
        statuses: Set<string>;
        deploymentIds: Set<string>;
        campaignIds: Set<string>;
        connectionIds: Set<string>;
        rawPhones: Set<string>;
      }
    >();
    const connectionMap = new Map<
      string,
      {
        source: 'deployment' | 'campaign';
        rawPhones: Set<string>;
      }
    >();

    const touchApp = (appId: string | undefined, source: SarvamDiscoverySource) => {
      const trimmed = typeof appId === 'string' ? appId.trim() : '';
      if (!trimmed) return null;
      let entry = appMap.get(trimmed);
      if (!entry) {
        entry = {
          sources: new Set(),
          versions: new Set(),
          statuses: new Set(),
          deploymentIds: new Set(),
          campaignIds: new Set(),
          connectionIds: new Set(),
          rawPhones: new Set(),
        };
        appMap.set(trimmed, entry);
      }
      entry.sources.add(source);
      return entry;
    };

    const recordConnections = (
      appEntry: ReturnType<typeof touchApp>,
      source: 'deployment' | 'campaign',
      configs?: Array<{
        connection_id?: string;
        phone_numbers?: string[];
        agent_phone_number?: string;
      }>
    ) => {
      if (!Array.isArray(configs)) return;
      for (const cfg of configs) {
        const connId = typeof cfg?.connection_id === 'string' ? cfg.connection_id.trim() : '';
        const nums = [
          ...(Array.isArray(cfg?.phone_numbers) ? cfg.phone_numbers : []),
          ...(typeof cfg?.agent_phone_number === 'string' ? [cfg.agent_phone_number] : []),
        ]
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter(Boolean);

        if (connId) {
          if (appEntry) appEntry.connectionIds.add(connId);
          let connEntry = connectionMap.get(connId);
          if (!connEntry) {
            connEntry = { source, rawPhones: new Set() };
            connectionMap.set(connId, connEntry);
          }
          for (const n of nums) connEntry.rawPhones.add(n);
        }
        if (appEntry) {
          for (const n of nums) appEntry.rawPhones.add(n);
        }
      }
    };

    // Fetch missing deployment details for up to 10 deployments to recover connection_configs
    const deploymentsNeedingDetail = deploymentsList
      .filter(
        (d) =>
          Boolean(d?.deployment_id) &&
          (!Array.isArray(d.connection_configs) || d.connection_configs.length === 0)
      )
      .slice(0, 10);

    const endNow = new Date();
    const start30d = new Date(endNow.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      deploymentDetailsRes,
      campaignsRes,
      experimentsRes,
      testSuitesRes,
      analyticsRes,
    ] = await Promise.all([
      Promise.all(
        deploymentsNeedingDetail.map(async (d) => {
          const detail = await this.safeGetSarvamJson(
            this.getDeploymentDetailEndpointUrl(d.deployment_id as string)
          );
          return detail.ok && detail.json && typeof detail.json === 'object'
            ? (detail.json as SarvamDeploymentRecord)
            : d;
        })
      ),
      this.safeGetSarvamJson(`${this.getCampaignsEndpointUrl()}?limit=100`),
      this.safeGetSarvamJson(`${this.getExperimentsEndpointUrl()}?limit=100`),
      this.safeGetSarvamJson(`${this.getTestSuitesEndpointUrl()}?limit=100`),
      this.safeGetSarvamJson(
        this.getAnalyticsInteractionsEndpointUrl(
          env.SARVAM_AGENT_ID,
          start30d.toISOString(),
          endNow.toISOString()
        )
      ),
    ]);

    const detailByDeploymentId = new Map<string, SarvamDeploymentRecord>();
    for (const det of deploymentDetailsRes) {
      if (det?.deployment_id) detailByDeploymentId.set(det.deployment_id, det);
    }
    if (deploymentsNeedingDetail.length > 0) endpointsChecked.push('deployment-detail');

    for (const rawDep of deploymentsList) {
      const merged =
        rawDep.deployment_id && detailByDeploymentId.has(rawDep.deployment_id)
          ? { ...rawDep, ...detailByDeploymentId.get(rawDep.deployment_id) }
          : rawDep;
      const entry = touchApp(merged.app_id, 'deployment');
      if (!entry) continue;
      if (merged.app_version !== undefined && Number.isFinite(Number(merged.app_version))) {
        entry.versions.add(Number(merged.app_version));
      }
      if (merged.status) entry.statuses.add(merged.status);
      if (merged.deployment_id) entry.deploymentIds.add(merged.deployment_id);
      if (Array.isArray(merged.phone_numbers)) {
        for (const p of merged.phone_numbers) {
          if (typeof p === 'string' && p.trim()) entry.rawPhones.add(p.trim());
        }
      }
      recordConnections(entry, 'deployment', merged.connection_configs);
    }

    const enrichedCampaignDetails: SarvamCampaignRecord[] = [];
    if (campaignsRes.ok) {
      endpointsChecked.push('campaigns');
      const campaigns = extractPagedItems<SarvamCampaignRecord>(campaignsRes.json, ['campaigns']);
      const matchedCampaigns = campaigns.filter(
        (c) => (c?.app_config?.app_id || c?.app_id) === env.SARVAM_AGENT_ID
      );
      const otherCampaigns = campaigns.filter(
        (c) => (c?.app_config?.app_id || c?.app_id) !== env.SARVAM_AGENT_ID
      );
      const detailTargets = [...matchedCampaigns, ...otherCampaigns].slice(0, 10);

      const campaignDetails = await Promise.all(
        detailTargets
          .filter((c) => Boolean(c?.campaign_id))
          .map(async (c) => {
            const det = await this.safeGetSarvamJson(
              this.getCampaignDetailEndpointUrl(c.campaign_id as string)
            );
            return det.ok && det.json && typeof det.json === 'object'
              ? ({ ...c, ...(det.json as SarvamCampaignRecord) } as SarvamCampaignRecord)
              : c;
          })
      );
      if (detailTargets.length > 0) endpointsChecked.push('campaign-detail');

      const campaignDetailById = new Map<string, SarvamCampaignRecord>();
      for (const cd of campaignDetails) {
        enrichedCampaignDetails.push(cd);
        if (cd.campaign_id) campaignDetailById.set(cd.campaign_id, cd);
      }

      for (const rawCamp of campaigns) {
        const merged =
          rawCamp.campaign_id && campaignDetailById.has(rawCamp.campaign_id)
            ? campaignDetailById.get(rawCamp.campaign_id)!
            : rawCamp;
        const appId = merged.app_config?.app_id || merged.app_id;
        const appVer = merged.app_config?.app_version ?? merged.app_version;
        const entry = touchApp(appId, 'campaign');
        if (!entry) continue;
        if (appVer !== undefined && Number.isFinite(Number(appVer))) {
          entry.versions.add(Number(appVer));
        }
        if (merged.status) entry.statuses.add(`campaign:${merged.status}`);
        if (merged.campaign_id) entry.campaignIds.add(merged.campaign_id);
        recordConnections(entry, 'campaign', merged.app_config?.connection_configs);
      }
    }

    if (experimentsRes.ok) {
      endpointsChecked.push('experiments');
      const experiments = extractPagedItems<SarvamExperimentRecord>(experimentsRes.json, [
        'experiments',
      ]);
      for (const exp of experiments) {
        const variants = Array.isArray(exp?.variants) ? exp.variants : [];
        for (const v of variants) {
          const entry = touchApp(v?.app_config?.app_id, 'experiment');
          if (!entry) continue;
          if (
            v?.app_config?.app_version !== undefined &&
            Number.isFinite(Number(v.app_config.app_version))
          ) {
            entry.versions.add(Number(v.app_config.app_version));
          }
        }
      }
    }

    if (testSuitesRes.ok) {
      endpointsChecked.push('test-suites');
      const suites = extractPagedItems<SarvamTestSuiteRecord>(testSuitesRes.json, ['test_suites']);
      const matchingSuites = suites.filter(
        (s) => s?.app_id === env.SARVAM_AGENT_ID && Boolean(s?.test_suite_id)
      );
      const mappings = await Promise.all(
        matchingSuites.slice(0, 3).map(async (s) => {
          const mapRes = await this.safeGetSarvamJson(
            this.getTestSuiteMappingEndpointUrl(s.test_suite_id as string, env.SARVAM_AGENT_ID)
          );
          return mapRes.ok && mapRes.json && typeof mapRes.json === 'object'
            ? (mapRes.json as { app_id?: string; app_version?: number })
            : null;
        })
      );
      for (const s of suites) {
        touchApp(s?.app_id, 'test_suite');
      }
      for (const m of mappings) {
        if (!m) continue;
        const entry = touchApp(m.app_id, 'test_suite');
        if (entry && m.app_version !== undefined && Number.isFinite(Number(m.app_version))) {
          entry.versions.add(Number(m.app_version));
        }
      }
    }

    endpointsChecked.push('analytics-interactions');
    let analyticsTotal = 0;
    const observedVariableKeys = new Set<string>();
    const analyticsCallerPhones = new Set<string>();
    if (analyticsRes.ok && analyticsRes.json && typeof analyticsRes.json === 'object') {
      const rec = analyticsRes.json as {
        total?: number;
        items?: Array<{
          app_version?: number;
          deployment_id?: string | null;
          bot_contact_identifier?: string | null;
          agent_variables?: Record<string, unknown> | null;
        }>;
      };
      const items = Array.isArray(rec.items) ? rec.items : [];
      analyticsTotal = typeof rec.total === 'number' ? rec.total : items.length;
      if (analyticsTotal > 0 || items.length > 0) {
        const entry = touchApp(env.SARVAM_AGENT_ID, 'analytics');
        if (entry) {
          for (const item of items) {
            if (item?.app_version !== undefined && Number.isFinite(Number(item.app_version))) {
              entry.versions.add(Number(item.app_version));
            }
            if (item?.deployment_id) entry.deploymentIds.add(item.deployment_id);
            if (item?.bot_contact_identifier) {
              const trimmedPhone = item.bot_contact_identifier.trim();
              if (trimmedPhone) {
                entry.rawPhones.add(trimmedPhone);
                analyticsCallerPhones.add(trimmedPhone);
              }
            }
            if (item?.agent_variables && typeof item.agent_variables === 'object') {
              for (const k of Object.keys(item.agent_variables)) {
                observedVariableKeys.add(k);
              }
            }
          }
        }
      }
    }

    const discoveredApps: SarvamDiscoveredAppSummary[] = Array.from(appMap.entries()).map(
      ([appId, info]) => {
        const versions = Array.from(info.versions).sort((a, b) => a - b);
        const connectionIds = Array.from(info.connectionIds);
        const rawPhones = Array.from(info.rawPhones);
        return {
          appId,
          matchesConfiguredAppId: appId === env.SARVAM_AGENT_ID,
          sources: Array.from(info.sources),
          versions,
          statuses: Array.from(info.statuses),
          deploymentIds: Array.from(info.deploymentIds),
          campaignIds: Array.from(info.campaignIds),
          connectionIds,
          phoneNumbersMasked: rawPhones.map(maskPhoneSafe),
          matchesVersion:
            versions.length > 0 ? versions.includes(env.SARVAM_AGENT_VERSION) : undefined,
          matchesConnectionId:
            connectionIds.length > 0
              ? connectionIds.includes(env.SARVAM_CONNECTION_ID)
              : undefined,
          matchesPhoneNumber:
            rawPhones.length > 0 ? rawPhones.includes(configuredPhone) : undefined,
        };
      }
    );

    const discoveredConnections: SarvamDiscoveredConnectionSummary[] = Array.from(
      connectionMap.entries()
    ).map(([connectionId, info]) => {
      const phones = Array.from(info.rawPhones);
      return {
        connectionId,
        matchesConfiguredConnectionId: connectionId === env.SARVAM_CONNECTION_ID,
        phoneNumbersMasked: phones.map(maskPhoneSafe),
        matchesConfiguredPhone: phones.includes(configuredPhone),
        source: info.source,
      };
    });

    return {
      enrichedCampaignDetails,
      summary: {
        orgId: env.SARVAM_ORG_ID,
        workspaceId: env.SARVAM_WORKSPACE_ID,
        configuredAgentId: env.SARVAM_AGENT_ID,
        configuredAgentVersion: env.SARVAM_AGENT_VERSION,
        configuredConnectionId: env.SARVAM_CONNECTION_ID,
        configuredPhoneMasked: maskPhoneSafe(configuredPhone),
        analyticsAppCheckStatus: analyticsRes.status || undefined,
        analyticsAppCheckDetail: analyticsRes.errorSummary
          ? redactSecrets(analyticsRes.errorSummary)
          : undefined,
        analyticsTotalInteractions: analyticsRes.ok ? analyticsTotal : undefined,
        analyticsCallerPhonesMasked:
          analyticsCallerPhones.size > 0
            ? Array.from(analyticsCallerPhones).map(maskPhoneSafe)
            : undefined,
        observedAgentVariables:
          observedVariableKeys.size > 0 ? Array.from(observedVariableKeys).sort() : undefined,
        configuredAllowedAgentVariables: parseConfiguredAllowedAgentVariables(),
        endpointsChecked,
        discoveredApps,
        discoveredConnections,
      },
    };
  }

  private evaluateLocalPreflightChecks(
    observedVariables?: string[]
  ): {
    webhookReadiness: SarvamPreflightCheckItem;
    dynamicVariableCompatibility: SarvamPreflightCheckItem;
  } {
    const webhookInfo = getSarvamWebhookReadiness();
    const webhookReadiness: SarvamPreflightCheckItem = webhookInfo.ready
      ? {
          status: 'READY',
          label: 'Webhook Readiness',
          detail:
            'HTTPS webhook base URL (PUBLIC_WEBHOOK_BASE_URL) and webhook authentication are configured.',
          blocking: false,
          source: 'env',
        }
      : {
          status: 'MISSING',
          label: 'Webhook Readiness',
          detail: `Webhook configuration incomplete or non-HTTPS: ${webhookInfo.missingFields.join(', ')}.`,
          blocking: true,
          source: 'env',
        };

    let dynamicVariableCompatibility: SarvamPreflightCheckItem;
    try {
      const allowedKeys = parseConfiguredAllowedAgentVariables();
      const aliasMap = parseAgentVariableAliasMap();
      const invalidSchemaKeys: string[] = [];

      for (const key of allowedKeys) {
        if (INTERNAL_ONLY_VARIABLE_SET.has(key) && !aliasMap[key]) {
          invalidSchemaKeys.push(key);
          continue;
        }
        const canonical =
          aliasMap[key] ??
          (CANONICAL_VARIABLE_KEY_SET.has(key)
            ? (key as CareVoiceCanonicalVariableKey)
            : undefined);
        if (!canonical) {
          invalidSchemaKeys.push(key);
        }
      }

      if (invalidSchemaKeys.length > 0) {
        dynamicVariableCompatibility = {
          status: 'ERROR',
          label: 'Dynamic Variable Compatibility',
          detail: `Invalid or internal-only key(s) in agent variable schema: [${invalidSchemaKeys.join(', ')}].`,
          blocking: true,
          source: 'env',
        };
      } else {
        const unobserved = observedVariables && observedVariables.length > 0
          ? allowedKeys.filter((k) => !observedVariables.includes(k))
          : [];
        const obsNote =
          observedVariables && observedVariables.length > 0
            ? unobserved.length === 0
              ? ' Matches variables observed in workspace analytics.'
              : ` Warning: recent analytics interactions did not include [${unobserved.join(', ')}]; confirm committed Sarvam Canvas Variables.`
            : '';
        dynamicVariableCompatibility = {
          status: 'VERIFIED',
          label: 'Dynamic Variable Compatibility',
          detail: `Canonical profile "${env.SARVAM_AGENT_VARIABLE_PROFILE}" (${allowedKeys.length} outbound variable(s)) passed internal-ID isolation and alias validation.${obsNote}`,
          blocking: false,
          source: 'schema',
        };
      }
    } catch (err) {
      dynamicVariableCompatibility = {
        status: 'ERROR',
        label: 'Dynamic Variable Compatibility',
        detail: err instanceof Error ? err.message : 'Invalid SARVAM_AGENT_VARIABLE_MAP configuration.',
        blocking: true,
        source: 'env',
      };
    }

    return { webhookReadiness, dynamicVariableCompatibility };
  }

  /**
   * Read-only preflight verification separating Instant Outbound readiness from
   * Inbound Deployment readiness and Bulk Campaign readiness across 7 independent checks.
   * Never creates deployments/campaigns, never treats Analytics HTTP 200 as telephony readiness,
   * never requires external Vobiz credentials (supports Rent from Sarvam), and never dials a phone.
   */
  async verifyAgentDeployment(): Promise<SarvamDeploymentVerificationResult> {
    const status = this.getStatus();
    const { webhookReadiness, dynamicVariableCompatibility } = this.evaluateLocalPreflightChecks();

    const makeUnavailableBaselineChecks = (
      overrides: Partial<SarvamPreflightChecks>
    ): SarvamPreflightChecks => ({
      apiAuthentication: {
        status: 'ERROR',
        label: 'API Authentication',
        detail: 'Not reached due to missing or invalid local Sarvam configuration.',
        blocking: true,
      },
      agentIdAndVersion: {
        status: 'UNVERIFIED',
        label: 'Agent ID & Committed Version',
        detail: 'Could not check workspace agent until API authentication succeeds.',
        blocking: true,
      },
      connectionIdValidity: {
        status: 'MISSING',
        label: 'Connection ID Validity',
        detail: 'Sarvam connection ID configuration was not verified.',
        blocking: true,
      },
      callerNumberAvailability: {
        status: 'MISSING',
        label: 'Caller Number Availability',
        detail: 'Caller phone number configuration was not verified.',
        blocking: true,
      },
      outboundCapability: {
        status: 'MISSING',
        label: 'Outbound Capability',
        detail: 'Outbound telephony readiness requires valid Sarvam configuration and authentication.',
        blocking: true,
      },
      webhookReadiness,
      dynamicVariableCompatibility,
      ...overrides,
    });

    if (!status.configured) {
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        authCategory: 'CONFIG_MISSING',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: false,
        phoneVerified: false,
        checks: makeUnavailableBaselineChecks({
          apiAuthentication: {
            status: 'MISSING',
            label: 'API Authentication',
            detail: `Sarvam configuration incomplete: ${status.missingFields.join(', ')}.`,
            blocking: true,
            source: 'env',
          },
          agentIdAndVersion: {
            status: 'MISSING',
            label: 'Agent ID & Committed Version',
            detail: `Agent / workspace env missing (${status.missingFields.join(', ')}).`,
            blocking: true,
            source: 'env',
          },
        }),
        message: `Sarvam telephony configuration incomplete: ${status.missingFields.join(', ')}`,
      };
    }

    const credDiag = getSarvamCredentialDiagnostics();
    if (!credDiag.validSyntax) {
      const joinedIssues = credDiag.issues.join(' ');
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        authCategory: 'KEY_SYNTAX_ERROR',
        upstreamDetail: joinedIssues,
        diagnosticHint: joinedIssues,
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: false,
        phoneVerified: false,
        checks: makeUnavailableBaselineChecks({
          apiAuthentication: {
            status: 'ERROR',
            label: 'API Authentication',
            detail: `Credential syntax invalid: ${joinedIssues}`,
            blocking: true,
            source: 'env',
          },
        }),
        message: `Sarvam credential syntax check failed: ${joinedIssues}`,
      };
    }

    let configuredPhone = '';
    try {
      configuredPhone = normalizeAndValidateE164(
        env.SARVAM_PHONE_NUMBER,
        'SARVAM_PHONE_NUMBER'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid E.164 SARVAM_PHONE_NUMBER';
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        authCategory: 'CONFIGURATION_ERROR',
        diagnosticHint: msg,
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: false,
        phoneVerified: false,
        checks: makeUnavailableBaselineChecks({
          apiAuthentication: {
            status: 'UNVERIFIED',
            label: 'API Authentication',
            detail: 'Skipped due to invalid SARVAM_PHONE_NUMBER E.164 format.',
            blocking: false,
          },
          callerNumberAvailability: {
            status: 'ERROR',
            label: 'Caller Number Availability',
            detail: msg,
            blocking: true,
            source: 'env',
          },
        }),
        message: msg,
      };
    }

    const url = `${this.getDeploymentsEndpointUrl()}?limit=100`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': env.SARVAM_API_KEY,
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      const msg = redactSecrets(err instanceof Error ? err.message : 'Network error');
      logger.warn('Sarvam deployment verification network error', { error: msg });
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        authCategory: 'NETWORK_ERROR',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: false,
        phoneVerified: false,
        checks: makeUnavailableBaselineChecks({
          apiAuthentication: {
            status: 'ERROR',
            label: 'API Authentication',
            detail: `Unable to reach Sarvam API: ${msg}`,
            blocking: true,
            source: 'deployments',
          },
        }),
        message: `Unable to reach Sarvam deployments API: ${msg}`,
      };
    }

    const parsedBody = await parseSarvamResponseBody(response);

    if (!response.ok) {
      const extracted = extractSarvamErrorDetails(parsedBody.rawText, parsedBody.json);
      const classification = classifySarvamHttpFailure(response.status, extracted.summary);

      logger.warn('Sarvam preflight verification rejected by upstream API', {
        upstreamStatus: response.status,
        authCategory: classification.authCategory,
        upstreamDetail: extracted.summary,
        authHeader: 'X-API-Key',
      });

      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        upstreamStatus: response.status,
        authCategory: classification.authCategory,
        upstreamDetail: extracted.summary,
        diagnosticHint: classification.diagnosticHint,
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: false,
        phoneVerified: false,
        checks: makeUnavailableBaselineChecks({
          apiAuthentication: {
            status: 'ERROR',
            label: 'API Authentication',
            detail: extracted.summary
              ? `HTTP ${response.status} via X-API-Key: ${extracted.summary}`
              : `HTTP ${response.status} rejected workspace API key or Org/Workspace ID.`,
            blocking: true,
            source: 'deployments',
          },
        }),
        message: extracted.summary
          ? `Sarvam API rejected preflight verification (HTTP ${response.status}): ${extracted.summary}`
          : `Sarvam API rejected preflight verification (HTTP ${response.status})`,
      };
    }

    const apiAuthCheck: SarvamPreflightCheckItem = {
      status: 'VERIFIED',
      label: 'API Authentication',
      detail: `Authenticated cleanly via X-API-Key for Org ${env.SARVAM_ORG_ID} / Workspace ${env.SARVAM_WORKSPACE_ID}.`,
      blocking: false,
      source: 'deployments',
    };

    const list = extractPagedItems<SarvamDeploymentRecord>(parsedBody.json, ['deployments']);
    const agentDeployments = list.filter((d) => d?.app_id === env.SARVAM_AGENT_ID);

    // Enrich active agent deployments that omit connection_configs in list summary
    const enrichedAgentDeployments = await Promise.all(
      agentDeployments.map(async (d) => {
        if (
          (d.status || '').toLowerCase() === 'active' &&
          d.deployment_id &&
          (!Array.isArray(d.connection_configs) || d.connection_configs.length === 0)
        ) {
          const det = await this.safeGetSarvamJson(
            this.getDeploymentDetailEndpointUrl(d.deployment_id)
          );
          if (det.ok && det.json && typeof det.json === 'object') {
            return { ...d, ...(det.json as SarvamDeploymentRecord) };
          }
        }
        return d;
      })
    );

    const activeDeployments = enrichedAgentDeployments.filter(
      (d) => (d.status || '').toLowerCase() === 'active'
    );

    let exactActiveDeployment: SarvamDeploymentRecord | undefined;
    if (activeDeployments.length > 0) {
      exactActiveDeployment = activeDeployments.find((d) => {
        const versionOk =
          d.app_version === undefined || Number(d.app_version) === env.SARVAM_AGENT_VERSION;
        const conns = Array.isArray(d.connection_configs) ? d.connection_configs : [];
        const topPhones = Array.isArray(d.phone_numbers) ? d.phone_numbers : [];

        let connMatch = true;
        if (conns.length > 0) {
          connMatch = conns.some((c) => {
            const idMatch = c.connection_id === env.SARVAM_CONNECTION_ID;
            const numbers = [
              ...(Array.isArray(c.phone_numbers) ? c.phone_numbers : []),
              ...(typeof c.agent_phone_number === 'string' ? [c.agent_phone_number] : []),
            ];
            const numMatch = numbers.includes(configuredPhone);
            return idMatch && (numbers.length === 0 || numMatch);
          });
        } else if (topPhones.length > 0 && (d.channel_direction || '').toLowerCase() !== 'inbound') {
          connMatch = topPhones.includes(configuredPhone);
        }

        return versionOk && connMatch;
      });
    }

    // Fast path when an active non-inbound-only deployment confirms agent, version, connection, and caller phone
    if (
      exactActiveDeployment &&
      (exactActiveDeployment.channel_direction || '').toLowerCase() !== 'inbound'
    ) {
      const matchedVersion = exactActiveDeployment.app_version ?? env.SARVAM_AGENT_VERSION;
      const checks: SarvamPreflightChecks = {
        apiAuthentication: apiAuthCheck,
        agentIdAndVersion: {
          status: 'VERIFIED',
          label: 'Agent ID & Committed Version',
          detail: `Agent "${env.SARVAM_AGENT_ID}" confirmed at v${matchedVersion} on active deployment ${exactActiveDeployment.deployment_id || ''}.`.trim(),
          blocking: false,
          source: 'deployment',
        },
        connectionIdValidity: {
          status: 'VERIFIED',
          label: 'Connection ID Validity',
          detail: `Sarvam Vobiz connection "${env.SARVAM_CONNECTION_ID}" confirmed on active deployment.`,
          blocking: false,
          source: 'deployment',
        },
        callerNumberAvailability: {
          status: 'VERIFIED',
          label: 'Caller Number Availability',
          detail: `Caller number ${maskPhoneSafe(configuredPhone)} verified on connection "${env.SARVAM_CONNECTION_ID}".`,
          blocking: false,
          source: 'deployment',
        },
        outboundCapability: {
          status: 'VERIFIED',
          label: 'Outbound Capability',
          detail: 'Deployment channel direction and connection configuration confirm outbound telephony capability.',
          blocking: false,
          source: 'deployment',
        },
        webhookReadiness,
        dynamicVariableCompatibility,
      };

      const localBlocked = webhookReadiness.blocking || dynamicVariableCompatibility.blocking;
      return {
        verified: !localBlocked,
        instantOutboundReady: !localBlocked,
        inboundDeploymentReady: true,
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: localBlocked ? 'error' : 'active',
        authCategory: localBlocked ? 'CONFIGURATION_ERROR' : 'VERIFIED',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        matchedDeploymentId: exactActiveDeployment.deployment_id,
        matchedAppVersion: matchedVersion,
        connectionVerified: true,
        phoneVerified: true,
        checks,
        diagnosticHint: localBlocked
          ? webhookReadiness.blocking
            ? webhookReadiness.detail
            : dynamicVariableCompatibility.detail
          : undefined,
        message: localBlocked
          ? `Sarvam deployment verified, but local preflight check failed: ${
              webhookReadiness.blocking
                ? webhookReadiness.detail
                : dynamicVariableCompatibility.detail
            }`
          : 'Sarvam Instant Outbound and active Deployment configuration are verified.',
      };
    }

    // Read-only cross-endpoint workspace discovery whenever an outbound-capable active deployment did not verify everything
    const { summary: workspaceDiscovery, enrichedCampaignDetails } =
      await this.discoverWorkspaceReadOnly(list, configuredPhone);

    const refinedLocalChecks = this.evaluateLocalPreflightChecks(
      workspaceDiscovery.observedAgentVariables
    );
    const refinedWebhook = refinedLocalChecks.webhookReadiness;
    const refinedVars = refinedLocalChecks.dynamicVariableCompatibility;

    // 1) Analytics 401/403 must still block auth cleanly
    if (
      workspaceDiscovery.analyticsAppCheckStatus === 401 ||
      workspaceDiscovery.analyticsAppCheckStatus === 403
    ) {
      const code = workspaceDiscovery.analyticsAppCheckStatus;
      const classification = classifySarvamHttpFailure(code, workspaceDiscovery.analyticsAppCheckDetail);
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: Boolean(exactActiveDeployment),
        campaignReady: false,
        connectionVerificationUnavailable: false,
        status: 'error',
        upstreamStatus: code,
        authCategory: classification.authCategory,
        upstreamDetail: workspaceDiscovery.analyticsAppCheckDetail,
        diagnosticHint: classification.diagnosticHint,
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: Boolean(exactActiveDeployment),
        phoneVerified: Boolean(exactActiveDeployment),
        workspaceDiscovery,
        checks: {
          apiAuthentication: {
            status: 'ERROR',
            label: 'API Authentication',
            detail: workspaceDiscovery.analyticsAppCheckDetail || `Analytics API rejected X-API-Key with HTTP ${code}.`,
            blocking: true,
            source: 'analytics',
          },
          agentIdAndVersion: {
            status: 'UNVERIFIED',
            label: 'Agent ID & Committed Version',
            detail: 'Could not verify agent ID due to Analytics authentication error.',
            blocking: true,
          },
          connectionIdValidity: {
            status: exactActiveDeployment ? 'VERIFIED' : 'CONNECTION_VERIFICATION_UNAVAILABLE',
            label: 'Connection ID Validity',
            detail: 'Connection verification blocked until authentication succeeds.',
            blocking: false,
          },
          callerNumberAvailability: {
            status: exactActiveDeployment ? 'VERIFIED' : 'CONNECTION_VERIFICATION_UNAVAILABLE',
            label: 'Caller Number Availability',
            detail: 'Caller number verification blocked until authentication succeeds.',
            blocking: false,
          },
          outboundCapability: {
            status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
            label: 'Outbound Capability',
            detail: 'Outbound verification blocked until authentication succeeds.',
            blocking: false,
          },
          webhookReadiness: refinedWebhook,
          dynamicVariableCompatibility: refinedVars,
        },
        message: `Sarvam Analytics API rejected request (HTTP ${code}): ${workspaceDiscovery.analyticsAppCheckDetail || 'Unauthorized'}`,
      };
    }

    // 2) Analytics 404 explicitly proves App ID or Org/Workspace ID does not exist
    const analyticsRejectedApp = workspaceDiscovery.analyticsAppCheckStatus === 404;
    if (analyticsRejectedApp) {
      const otherAppIds = workspaceDiscovery.discoveredApps
        .filter((a) => a.appId !== env.SARVAM_AGENT_ID)
        .map((a) => `${a.appId}${a.versions.length ? ` (v${a.versions.join(', v')})` : ''}`);
      const candidateText =
        otherAppIds.length > 0
          ? ` Discovered agent ID(s) in this workspace: ${otherAppIds.join('; ')}.`
          : ' Zero deployments, campaigns, experiments, or test suites matched any app_id under this SARVAM_ORG_ID + SARVAM_WORKSPACE_ID.';

      const connMatch = workspaceDiscovery.discoveredConnections.find(
        (c) => c.matchesConfiguredConnectionId
      );
      const phoneMatch = Boolean(connMatch?.matchesConfiguredPhone);

      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady: false,
        campaignReady: false,
        connectionVerificationUnavailable: !connMatch,
        status: 'not_found',
        authCategory: 'APP_NOT_FOUND_IN_WORKSPACE',
        upstreamStatus: 404,
        upstreamDetail: workspaceDiscovery.analyticsAppCheckDetail,
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified: Boolean(connMatch),
        phoneVerified: phoneMatch,
        workspaceDiscovery,
        checks: {
          apiAuthentication: apiAuthCheck,
          agentIdAndVersion: {
            status: 'NOT_FOUND',
            label: 'Agent ID & Committed Version',
            detail:
              workspaceDiscovery.analyticsAppCheckDetail ||
              `Sarvam returned HTTP 404: App "${env.SARVAM_AGENT_ID}" not found under Org "${env.SARVAM_ORG_ID}" / Workspace "${env.SARVAM_WORKSPACE_ID}".`,
            blocking: true,
            source: 'analytics',
          },
          connectionIdValidity: connMatch
            ? {
                status: 'VERIFIED',
                label: 'Connection ID Validity',
                detail: `Connection "${env.SARVAM_CONNECTION_ID}" found in workspace ${connMatch.source}.`,
                blocking: false,
                source: connMatch.source,
              }
            : {
                status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
                label: 'Connection ID Validity',
                detail:
                  'Sarvam exposes no read-only GET /connections endpoint; Rent-from-Sarvam connection was not in Deployments or Campaigns.',
                blocking: false,
              },
          callerNumberAvailability: connMatch
            ? {
                status: phoneMatch ? 'VERIFIED' : 'MISMATCH',
                label: 'Caller Number Availability',
                detail: phoneMatch
                  ? `Caller ${maskPhoneSafe(configuredPhone)} matches connection "${env.SARVAM_CONNECTION_ID}".`
                  : `Caller ${maskPhoneSafe(configuredPhone)} did not match phone numbers on connection "${env.SARVAM_CONNECTION_ID}".`,
                blocking: !phoneMatch,
                source: connMatch.source,
              }
            : {
                status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
                label: 'Caller Number Availability',
                detail:
                  'Sarvam exposes no read-only GET /phone-numbers endpoint for Rent-from-Sarvam numbers.',
                blocking: false,
              },
          outboundCapability: {
            status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
            label: 'Outbound Capability',
            detail:
              'Sarvam exposes no read-only GET outbound-capability endpoint; and configured app_id returned HTTP 404.',
            blocking: false,
          },
          webhookReadiness: refinedWebhook,
          dynamicVariableCompatibility: refinedVars,
        },
        diagnosticHint:
          `App "${env.SARVAM_AGENT_ID}" was rejected (HTTP 404) in Org "${env.SARVAM_ORG_ID}" / Workspace "${env.SARVAM_WORKSPACE_ID}". Do not copy the browser URL slug: open the agent in https://apps.sarvam.ai, click "···" -> "Copy agent ID", commit a non-Draft version, and verify Org & Workspace IDs match.${candidateText}`,
        message: `Sarvam Agent ID "${env.SARVAM_AGENT_ID}" was not found or verified in the configured workspace. Live calling remains locked until verified.`,
      };
    }

    // 3) Evaluate Bulk Campaign readiness separately
    const matchingCampaigns = enrichedCampaignDetails.filter(
      (c) => (c.app_config?.app_id || c.app_id) === env.SARVAM_AGENT_ID
    );
    const exactCampaign = matchingCampaigns.find((c) => {
      const ver = c.app_config?.app_version ?? c.app_version;
      const versionOk = ver !== undefined && Number(ver) === env.SARVAM_AGENT_VERSION;
      const conns = Array.isArray(c.app_config?.connection_configs)
        ? c.app_config!.connection_configs!
        : [];
      const connOk = conns.some((cfg) => {
        const idMatch = cfg.connection_id === env.SARVAM_CONNECTION_ID;
        const nums = [
          ...(Array.isArray(cfg.phone_numbers) ? cfg.phone_numbers : []),
          ...(typeof cfg.agent_phone_number === 'string' ? [cfg.agent_phone_number] : []),
        ];
        const phoneMatch = nums.includes(configuredPhone);
        return idMatch && (nums.length === 0 || phoneMatch);
      });
      return versionOk && connOk;
    });

    const inboundDeploymentReady = Boolean(exactActiveDeployment);
    const campaignReady = Boolean(exactCampaign);

    // 4) Evaluate Connection ID & Caller Number against discovered Deployment/Campaign connection_configs
    const configuredConnSummary = workspaceDiscovery.discoveredConnections.find(
      (c) => c.matchesConfiguredConnectionId
    );
    const configuredAppDiscovered = workspaceDiscovery.discoveredApps.find(
      (a) => a.appId === env.SARVAM_AGENT_ID
    );

    let connectionVerified = Boolean(configuredConnSummary);
    let phoneVerified = Boolean(configuredConnSummary?.matchesConfiguredPhone);
    let connectionIdValidity: SarvamPreflightCheckItem;
    let callerNumberAvailability: SarvamPreflightCheckItem;

    if (configuredConnSummary) {
      connectionIdValidity = {
        status: 'VERIFIED',
        label: 'Connection ID Validity',
        detail: `Sarvam connection "${env.SARVAM_CONNECTION_ID}" confirmed in workspace ${configuredConnSummary.source} config.`,
        blocking: false,
        source: configuredConnSummary.source,
      };
      if (configuredConnSummary.phoneNumbersMasked.length > 0) {
        if (configuredConnSummary.matchesConfiguredPhone) {
          callerNumberAvailability = {
            status: 'VERIFIED',
            label: 'Caller Number Availability',
            detail: `Caller number ${maskPhoneSafe(configuredPhone)} verified on connection "${env.SARVAM_CONNECTION_ID}".`,
            blocking: false,
            source: configuredConnSummary.source,
          };
        } else {
          callerNumberAvailability = {
            status: 'MISMATCH',
            label: 'Caller Number Availability',
            detail: `Connection "${env.SARVAM_CONNECTION_ID}" lists phone(s) [${configuredConnSummary.phoneNumbersMasked.join(', ')}], which does not match SARVAM_PHONE_NUMBER (${maskPhoneSafe(configuredPhone)}).`,
            blocking: true,
            source: configuredConnSummary.source,
          };
        }
      } else {
        callerNumberAvailability = {
          status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
          label: 'Caller Number Availability',
          detail: `Connection "${env.SARVAM_CONNECTION_ID}" had no phone list in ${configuredConnSummary.source}; Sarvam exposes no GET /phone-numbers API for Rent-from-Sarvam numbers.`,
          blocking: false,
        };
      }
    } else if (
      exactActiveDeployment &&
      Array.isArray(exactActiveDeployment.phone_numbers) &&
      exactActiveDeployment.phone_numbers.includes(configuredPhone)
    ) {
      connectionVerified = true;
      phoneVerified = true;
      connectionIdValidity = {
        status: 'VERIFIED',
        label: 'Connection ID Validity',
        detail: `Inbound deployment ${exactActiveDeployment.deployment_id || ''} linked without conflicting connection ID.`,
        blocking: false,
        source: 'deployment',
      };
      callerNumberAvailability = {
        status: 'VERIFIED',
        label: 'Caller Number Availability',
        detail: `Caller number ${maskPhoneSafe(configuredPhone)} verified on deployment ${exactActiveDeployment.deployment_id || ''}.`,
        blocking: false,
        source: 'deployment',
      };
    } else {
      const analyticsCallerNote =
        workspaceDiscovery.analyticsCallerPhonesMasked &&
        workspaceDiscovery.analyticsCallerPhonesMasked.includes(maskPhoneSafe(configuredPhone))
          ? ` Historical analytics calls also show caller ${maskPhoneSafe(configuredPhone)} (informational only; does not substitute for a telephony phone-catalog API).`
          : '';
      connectionIdValidity = {
        status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
        label: 'Connection ID Validity',
        detail: `Sarvam does not expose a read-only GET /connections endpoint. Rent-from-Sarvam connection "${env.SARVAM_CONNECTION_ID}" was not attached to an Inbound Deployment or Campaign (not required for Instant Outbound).`,
        blocking: false,
      };
      callerNumberAvailability = {
        status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
        label: 'Caller Number Availability',
        detail: `Sarvam does not expose a read-only GET /phone-numbers endpoint. Caller ${maskPhoneSafe(configuredPhone)} passed E.164 syntax validation; Rent-from-Sarvam assignment is evaluated by POST /outbounds.${analyticsCallerNote}`,
        blocking: false,
      };
    }

    // 5) Evaluate Outbound Capability (Campaigns or non-inbound Deployments ONLY — never Analytics HTTP 200)
    const outboundCapability: SarvamPreflightCheckItem = exactCampaign
      ? {
          status: 'VERIFIED',
          label: 'Outbound Capability',
          detail: `Connection "${env.SARVAM_CONNECTION_ID}" and caller ${maskPhoneSafe(configuredPhone)} confirmed for outbound calling via workspace campaign configuration.`,
          blocking: false,
          source: 'campaign',
        }
      : {
          status: 'CONNECTION_VERIFICATION_UNAVAILABLE',
          label: 'Outbound Capability',
          detail:
            'Sarvam exposes no read-only endpoint to test outbound capability of a Rent-from-Sarvam (Sarvam Vobiz) connection without placing a call. Instant Outbound (POST /api/outbounds) does not require a Campaign ID or Deployment ID, and requires no external Vobiz credentials.',
          blocking: false,
        };

    // 6) Evaluate Agent ID & Committed Version cleanly without false 404 or conflating Analytics 200 with telephony
    const analyticsOk =
      typeof workspaceDiscovery.analyticsAppCheckStatus === 'number' &&
      workspaceDiscovery.analyticsAppCheckStatus >= 200 &&
      workspaceDiscovery.analyticsAppCheckStatus < 300;
    const discoveredVersions = configuredAppDiscovered?.versions ?? [];
    const versionMatched = discoveredVersions.includes(env.SARVAM_AGENT_VERSION);
    const versionMismatched = discoveredVersions.length > 0 && !versionMatched;

    let agentIdAndVersion: SarvamPreflightCheckItem;
    if (versionMismatched) {
      agentIdAndVersion = {
        status: 'MISMATCH',
        label: 'Agent ID & Committed Version',
        detail: `Agent "${env.SARVAM_AGENT_ID}" was discovered at version(s) [v${discoveredVersions.join(', v')}], which does not match SARVAM_AGENT_VERSION=${env.SARVAM_AGENT_VERSION}.`,
        blocking: true,
        source: configuredAppDiscovered?.sources.join('/'),
      };
    } else if (versionMatched) {
      agentIdAndVersion = {
        status: 'VERIFIED',
        label: 'Agent ID & Committed Version',
        detail: `Agent "${env.SARVAM_AGENT_ID}" verified at committed v${env.SARVAM_AGENT_VERSION} via workspace ${configuredAppDiscovered?.sources.join('/') || 'metadata'}.`,
        blocking: false,
        source: configuredAppDiscovered?.sources.join('/'),
      };
    } else if (analyticsOk) {
      agentIdAndVersion = {
        status: 'UNVERIFIED',
        label: 'Agent ID & Committed Version',
        detail: `Sarvam Analytics recognized "${env.SARVAM_AGENT_ID}" (HTTP ${workspaceDiscovery.analyticsAppCheckStatus}, ${workspaceDiscovery.analyticsTotalInteractions ?? 0} recent interactions), confirming the app exists. Because Sarvam exposes no GET /apps version endpoint and no Deployment/Campaign/Experiment surfaced versions yet, committed v${env.SARVAM_AGENT_VERSION} cannot be pre-verified until the first call.`,
        blocking: false,
        source: 'analytics',
      };
    } else {
      agentIdAndVersion = {
        status: 'UNVERIFIED',
        label: 'Agent ID & Committed Version',
        detail: `Agent "${env.SARVAM_AGENT_ID}" was not found in Deployments/Campaigns/Experiments and Analytics returned HTTP ${workspaceDiscovery.analyticsAppCheckStatus ?? 0}.`,
        blocking: true,
        source: 'workspace-discovery',
      };
    }

    const checks: SarvamPreflightChecks = {
      apiAuthentication: apiAuthCheck,
      agentIdAndVersion,
      connectionIdValidity,
      callerNumberAvailability,
      outboundCapability,
      webhookReadiness: refinedWebhook,
      dynamicVariableCompatibility: refinedVars,
    };

    const anyBlocking = Object.values(checks).some((c) => c.blocking);
    const connectionVerificationUnavailable = [
      checks.connectionIdValidity,
      checks.callerNumberAvailability,
      checks.outboundCapability,
    ].some((c) => c.status === 'CONNECTION_VERIFICATION_UNAVAILABLE');

    const instantOutboundReady = !anyBlocking;
    const verified =
      instantOutboundReady &&
      !connectionVerificationUnavailable &&
      checks.agentIdAndVersion.status === 'VERIFIED';

    // Exact Campaign verification branch
    if (campaignReady && !anyBlocking && exactCampaign) {
      return {
        verified: true,
        instantOutboundReady: true,
        inboundDeploymentReady,
        campaignReady: true,
        connectionVerificationUnavailable: false,
        status: 'verified_campaign',
        authCategory: 'VERIFIED',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        matchedDeploymentId: exactActiveDeployment?.deployment_id,
        matchedAppVersion:
          exactCampaign.app_config?.app_version ??
          exactCampaign.app_version ??
          env.SARVAM_AGENT_VERSION,
        connectionVerified: true,
        phoneVerified: true,
        checks,
        workspaceDiscovery,
        message:
          'Sarvam agent ID, committed version, and Sarvam Vobiz connection verified via workspace campaign configuration.',
      };
    }

    if (agentIdAndVersion.status === 'MISMATCH' || callerNumberAvailability.status === 'MISMATCH') {
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady,
        campaignReady,
        connectionVerificationUnavailable,
        status: 'mismatch',
        authCategory: 'DEPLOYMENT_MISMATCH',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified,
        phoneVerified,
        checks,
        workspaceDiscovery,
        diagnosticHint:
          agentIdAndVersion.status === 'MISMATCH'
            ? `${agentIdAndVersion.detail} Commit v${env.SARVAM_AGENT_VERSION} in Sarvam Canvas or update SARVAM_AGENT_VERSION.`
            : `${callerNumberAvailability.detail} Verify connection ID and rented phone number in Sarvam Deploy -> Phone Numbers (Rent from Sarvam).`,
        message:
          agentIdAndVersion.status === 'MISMATCH'
            ? `Sarvam agent "${env.SARVAM_AGENT_ID}" version mismatch against SARVAM_AGENT_VERSION=${env.SARVAM_AGENT_VERSION}. Instant Outbound remains locked.`
            : 'Sarvam caller phone number conflicts with phone number(s) registered on the configured connection. Instant Outbound remains locked.',
      };
    }

    if (agentIdAndVersion.blocking) {
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady,
        campaignReady,
        connectionVerificationUnavailable,
        status: 'unverified',
        authCategory: 'AGENT_UNVERIFIED_IN_WORKSPACE',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified,
        phoneVerified,
        checks,
        workspaceDiscovery,
        diagnosticHint: agentIdAndVersion.detail,
        message: `Unable to verify Sarvam agent "${env.SARVAM_AGENT_ID}" in workspace. Live calling remains locked.`,
      };
    }

    if (refinedWebhook.blocking || refinedVars.blocking) {
      return {
        verified: false,
        instantOutboundReady: false,
        inboundDeploymentReady,
        campaignReady,
        connectionVerificationUnavailable,
        status: 'error',
        authCategory: 'CONFIGURATION_ERROR',
        authHeader: 'X-API-Key',
        credentialsSharedWithOutbound: true,
        connectionVerified,
        phoneVerified,
        checks,
        workspaceDiscovery,
        diagnosticHint: refinedWebhook.blocking ? refinedWebhook.detail : refinedVars.detail,
        message: refinedWebhook.blocking ? refinedWebhook.detail : refinedVars.detail,
      };
    }

    // All verifiable Instant Outbound checks pass! Neither Inbound Deployment nor Campaign is required.
    return {
      verified,
      instantOutboundReady: true,
      inboundDeploymentReady,
      campaignReady,
      connectionVerificationUnavailable,
      status: connectionVerificationUnavailable ? 'instant_outbound_ready' : 'active',
      authCategory: connectionVerificationUnavailable
        ? 'CONNECTION_VERIFICATION_UNAVAILABLE'
        : 'VERIFIED',
      authHeader: 'X-API-Key',
      credentialsSharedWithOutbound: true,
      matchedDeploymentId: exactActiveDeployment?.deployment_id,
      matchedAppVersion:
        versionMatched ? env.SARVAM_AGENT_VERSION : undefined,
      connectionVerified,
      phoneVerified,
      checks,
      workspaceDiscovery,
      diagnosticHint:
        'Instant Outbound (POST /api/outbounds) does not require a Campaign ID or active Inbound Deployment. Because Rent from Sarvam manages Sarvam Vobiz natively in Deploy -> Phone Numbers (with no external Vobiz credentials and no GET /connections endpoint), connection outbound capability is evaluated by Sarvam when initiating a supervised test call.',
      message: connectionVerificationUnavailable
        ? 'Instant Outbound prerequisites verified; Sarvam exposes no read-only endpoint to pre-verify Rent-from-Sarvam connection outbound capability (CONNECTION_VERIFICATION_UNAVAILABLE). Ready for supervised Instant Outbound test.'
        : 'Sarvam Instant Outbound configuration verified.',
    };
  }

  public buildOutboundPayload(context: VoiceCallContextPayload): SarvamOutboundRequestPayload {
    if (
      !env.SARVAM_ORG_ID ||
      !env.SARVAM_WORKSPACE_ID ||
      !env.SARVAM_AGENT_ID ||
      !env.SARVAM_CONNECTION_ID
    ) {
      throw new AppError(
        'Sarvam workspace, agent, or connection IDs are incomplete',
        503,
        'TELEPHONY_DISABLED',
        { errorCategory: 'CONFIGURATION_ERROR' }
      );
    }

    const agentPhoneNumber = normalizeAndValidateE164(
      env.SARVAM_PHONE_NUMBER,
      'SARVAM_PHONE_NUMBER'
    );
    const userPhoneNumber = normalizeAndValidateE164(
      context.phoneNumber,
      'user_config.user_phone_number'
    );

    const appVersion = env.SARVAM_AGENT_VERSION;
    if (!Number.isInteger(appVersion) || appVersion < 1) {
      throw new AppError(
        'SARVAM_AGENT_VERSION must resolve to a positive integer app_version',
        500,
        'INVALID_SARVAM_AGENT_VERSION',
        { errorCategory: 'CONFIGURATION_ERROR' }
      );
    }

    const langCheck = checkSarvamLanguageSupport(
      context.languageCode,
      env.SARVAM_ALLOWED_LANGUAGES
    );
    if (!langCheck.supported || !langCheck.language) {
      throw new AppError(
        langCheck.reason || `Language "${context.languageCode}" is not supported`,
        422,
        'LANGUAGE_FALLBACK_REQUIRED',
        {
          errorCategory: 'LANGUAGE_UNAVAILABLE',
          requestedLanguage: context.languageCode,
          availableFallbackLanguages: langCheck.availableFallbackLanguages,
          requiresFallbackPermission: true,
        }
      );
    }

    const langMeta = langCheck.language;
    const initialLanguageName = langMeta.sarvamInitialLanguageName || langMeta.name;
    const initialBotMessage = buildLocalizedInitialGreeting({
      languageCode: langMeta.code,
      patientName: context.patientName,
      medicineName: context.medicineName,
      dosage: context.dosage,
      callType: context.callType,
      associatedMeal: context.associatedMeal,
    });
    const transcriptConsent =
      context.transcriptConsentGranted ?? context.recordingConsentGranted;

    const canonicalVariables: Record<CareVoiceCanonicalVariableKey, string> = {
      call_purpose: context.callPurpose || context.callType,
      doctor_instructions:
        context.prescribedInstructions ||
        `${context.foodInstruction} (${context.associatedMeal})`.replace(/_/g, ' '),
      dosage: context.dosage,
      dose_number: String(context.doseNumber ?? 1),
      food_instruction: context.foodInstruction,
      meal: context.associatedMeal,
      medicine_name: context.medicineName,
      user_name: context.patientName,
      language_name: initialLanguageName,
      language_code: langMeta.code,
      language_directive: `Conduct the entire call politely and strictly in ${initialLanguageName} (${langMeta.bcp47}). Do NOT switch to Hindi or any other language unless the patient explicitly asks.`,
      associated_meal: context.associatedMeal,
      slot_label: context.slotLabel || '',
    };

    const resolvedAgentVariables = resolveSarvamAgentVariables(canonicalVariables, {
      extraAgentVariables: context.extraAgentVariables,
    });

    const requestBody: SarvamOutboundRequestPayload = {
      app_config: {
        app_id: env.SARVAM_AGENT_ID,
        app_version: appVersion,
        connection_config: {
          connection_id: env.SARVAM_CONNECTION_ID,
          agent_phone_number: agentPhoneNumber,
        },
        ...(resolvedAgentVariables && Object.keys(resolvedAgentVariables).length > 0
          ? { agent_variables: resolvedAgentVariables }
          : {}),
        app_overrides: {
          initial_language_name: initialLanguageName,
          initial_bot_message: initialBotMessage,
        },
      },
      user_config: {
        user_phone_number: userPhoneNumber,
      },
    };

    if (env.PUBLIC_WEBHOOK_BASE_URL) {
      const webhookBase = env.PUBLIC_WEBHOOK_BASE_URL.replace(/\/$/, '');
      let webhookUrl: string;

      if (env.SARVAM_WEBHOOK_TOKEN) {
        webhookUrl = `${webhookBase}/api/voice-agent/webhook/sarvam/${encodeURIComponent(
          env.SARVAM_WEBHOOK_TOKEN
        )}`;
      } else if (env.SARVAM_WEBHOOK_SECRET) {
        webhookUrl = `${webhookBase}/api/voice-agent/webhook/sarvam`;
      } else {
        throw new AppError(
          'Refusing to configure Sarvam webhook without SARVAM_WEBHOOK_TOKEN (or SARVAM_WEBHOOK_SECRET)',
          503,
          'WEBHOOK_AUTH_NOT_CONFIGURED'
        );
      }

      requestBody.webhook_config = {
        url: webhookUrl,
        metadata: {
          patient_id: context.familyMemberId,
          dose_id: context.doseInstanceId,
          call_log_id: context.callLogId,
          family_id: context.familyId,
          call_type: context.callType,
          language: langMeta.bcp47,
          preferred_language_name: initialLanguageName,
          patient_name: context.patientName,
          medicine_name: context.medicineName,
          dosage: context.dosage,
          food_instruction: context.foodInstruction,
          associated_meal: context.associatedMeal,
          recording_consent_granted: String(context.recordingConsentGranted),
          transcript_consent_granted: String(transcriptConsent),
          ...(context.callPurpose ? { call_purpose: context.callPurpose } : {}),
          ...(context.isTestCall !== undefined ? { is_test_call: String(context.isTestCall) } : {}),
        },
      };
    }

    return requestBody;
  }

  async initiateLiveCall(context: VoiceCallContextPayload): Promise<{
    accepted: boolean;
    attemptId: string;
    providerCallId: string;
    rawStatus: string;
    httpStatus: number;
  }> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new AppError(
        `Sarvam live telephony is disabled or missing configuration: ${status.missingFields.join(', ')}`,
        503,
        'TELEPHONY_DISABLED',
        { errorCategory: 'CONFIGURATION_ERROR' }
      );
    }

    const credDiag = getSarvamCredentialDiagnostics();
    if (!credDiag.validSyntax) {
      throw new AppError(
        `Sarvam API credential format invalid: ${credDiag.issues.join(' ')}`,
        503,
        'SARVAM_CREDENTIAL_SYNTAX_ERROR',
        { errorCategory: 'AUTHENTICATION_ERROR' }
      );
    }

    const url = this.getOutboundEndpointUrl();
    const requestBody = this.buildOutboundPayload(context);

    logger.info('Dispatching outbound call via official Sarvam Instant Outbound API', {
      callLogId: context.callLogId,
      patientId: context.familyMemberId,
      doseId: context.doseInstanceId,
      languageCode: context.languageCode,
      languageBcp47: context.languageBcp47,
      initialLanguageName: requestBody.app_config.app_overrides?.initial_language_name,
      agentVariableKeys: Object.keys(requestBody.app_config.agent_variables || {}),
      callType: context.callType,
      appVersion: requestBody.app_config.app_version,
      hasWebhookConfig: Boolean(requestBody.webhook_config),
      isTestCall: Boolean(context.isTestCall),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.SARVAM_API_KEY,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      const msg = redactSecrets(
        err instanceof Error ? err.message : 'Network error calling Sarvam outbound API'
      );
      logger.error('Sarvam outbound HTTP transport failure', {
        callLogId: context.callLogId,
        error: msg,
      });
      throw new AppError(
        `Unable to connect to Sarvam outbound telephony API: ${msg}`,
        502,
        'SARVAM_NETWORK_ERROR',
        { errorCategory: 'PROVIDER_ERROR' }
      );
    }

    const parsedBody = await parseSarvamResponseBody(response);
    const payload =
      parsedBody.json && typeof parsedBody.json === 'object' && !Array.isArray(parsedBody.json)
        ? (parsedBody.json as Record<string, unknown>)
        : {};

    if (!response.ok) {
      const extracted = extractSarvamErrorDetails(parsedBody.rawText, parsedBody.json);
      const classification = classifySarvamHttpFailure(response.status, extracted.summary);

      logger.warn('Sarvam outbound API returned non-2xx status', {
        statusCode: response.status,
        authCategory: classification.authCategory,
        errorCategory: classification.errorCategory,
        callLogId: context.callLogId,
        patientId: context.familyMemberId,
        doseId: context.doseInstanceId,
        detail: extracted.summary,
      });

      if (classification.authCategory === 'LANGUAGE_UNSUPPORTED') {
        const langCheck = checkSarvamLanguageSupport(
          context.languageCode,
          env.SARVAM_ALLOWED_LANGUAGES
        );
        throw new AppError(
          extracted.summary ||
            `Requested language "${context.languageCode}" is not enabled on the Sarvam agent.`,
          422,
          'LANGUAGE_FALLBACK_REQUIRED',
          {
            upstreamStatus: response.status,
            authCategory: classification.authCategory,
            errorCategory: 'LANGUAGE_UNAVAILABLE',
            detail: extracted.summary,
            diagnosticHint: classification.diagnosticHint,
            requestedLanguage: context.languageCode,
            availableFallbackLanguages: langCheck.availableFallbackLanguages.filter(
              (l) => l.code !== langCheck.language?.code
            ),
            requiresFallbackPermission: true,
          }
        );
      }

      throw new AppError(
        extracted.summary
          ? `Sarvam telephony call request failed (HTTP ${response.status}): ${extracted.summary}`
          : `Sarvam telephony call request failed (HTTP ${response.status})`,
        502,
        'SARVAM_PROVIDER_ERROR',
        {
          upstreamStatus: response.status,
          authCategory: classification.authCategory,
          errorCategory: classification.errorCategory,
          detail: extracted.summary,
          diagnosticHint: classification.diagnosticHint,
        }
      );
    }

    const attemptId =
      typeof payload.attempt_id === 'string' ? payload.attempt_id.trim() : '';

    if (!attemptId) {
      throw new AppError(
        'Sarvam Instant Outbound API response did not include attempt_id',
        502,
        'SARVAM_INVALID_RESPONSE'
      );
    }

    return {
      accepted: true,
      attemptId,
      providerCallId: attemptId,
      rawStatus: typeof payload.status === 'string' && payload.status ? payload.status : 'INITIATED',
      httpStatus: response.status,
    };
  }

  /**
   * Read-only reconciliation query to Sarvam Analytics `GET /attempts` using `attempt_id`.
   */
  async fetchAttemptByAttemptId(
    attemptId: string,
    referenceDate?: Date
  ): Promise<{
    found: boolean;
    attempt?: SarvamAnalyticsAttemptRecord;
    httpStatus: number;
    error?: string;
  }> {
    if (
      !env.SARVAM_API_KEY ||
      !env.SARVAM_ORG_ID ||
      !env.SARVAM_WORKSPACE_ID ||
      !env.SARVAM_AGENT_ID
    ) {
      return { found: false, httpStatus: 0, error: 'Sarvam credentials incomplete' };
    }

    const baseDate = referenceDate ?? new Date();
    const startIso = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Math.max(Date.now(), baseDate.getTime()) + 5 * 60 * 1000).toISOString();
    const filter = JSON.stringify([
      { field: 'attempt_id', operator: 'equals', value: attemptId },
    ]);

    const res = await this.safeGetSarvamJson(
      this.getAnalyticsAttemptsEndpointUrl(env.SARVAM_AGENT_ID, startIso, endIso, filter, 5),
      8000
    );

    if (!res.ok) {
      return {
        found: false,
        httpStatus: res.status,
        error: res.errorSummary,
      };
    }

    const items = extractPagedItems<SarvamAnalyticsAttemptRecord>(res.json, ['attempts']);
    const matched = items.find((item) => item?.attempt_id === attemptId) ?? items[0];
    return {
      found: Boolean(matched),
      attempt: matched,
      httpStatus: res.status,
    };
  }

  /**
   * Read-only query to Sarvam Analytics `GET /interactions?include_transcript=true`
   * matching either `interaction_id` or `job_id === attemptId`.
   */
  async fetchInteractionByAttemptOrId(params: {
    attemptId?: string;
    interactionId?: string;
    referenceDate?: Date;
  }): Promise<{
    found: boolean;
    interaction?: SarvamAnalyticsInteractionRecord;
    httpStatus: number;
    error?: string;
  }> {
    if (
      !env.SARVAM_API_KEY ||
      !env.SARVAM_ORG_ID ||
      !env.SARVAM_WORKSPACE_ID ||
      !env.SARVAM_AGENT_ID
    ) {
      return { found: false, httpStatus: 0, error: 'Sarvam credentials incomplete' };
    }

    const baseDate = params.referenceDate ?? new Date();
    const startIso = new Date(baseDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(Math.max(Date.now(), baseDate.getTime()) + 5 * 60 * 1000).toISOString();
    const filter = params.attemptId
      ? JSON.stringify([{ field: 'job_id', operator: 'equals', value: params.attemptId }])
      : undefined;

    const url = this.getAnalyticsInteractionsEndpointUrl(env.SARVAM_AGENT_ID, startIso, endIso, {
      includeTranscript: true,
      filterConditions: filter,
      limit: 20,
    });

    let res = await this.safeGetSarvamJson(url, 8000);
    // Fallback without job_id filter in case workspace Analytics filter_conditions rejects job_id (HTTP 422)
    if (!res.ok && res.status === 422 && filter) {
      const fallbackUrl = this.getAnalyticsInteractionsEndpointUrl(
        env.SARVAM_AGENT_ID,
        startIso,
        endIso,
        { includeTranscript: true, limit: 25 }
      );
      res = await this.safeGetSarvamJson(fallbackUrl, 8000);
    }

    if (!res.ok) {
      return { found: false, httpStatus: res.status, error: res.errorSummary };
    }

    const items = extractPagedItems<SarvamAnalyticsInteractionRecord & { job_id?: string }>(
      res.json,
      ['interactions']
    );
    const matched = items.find(
      (item) =>
        (params.interactionId && item?.interaction_id === params.interactionId) ||
        (params.attemptId && item?.job_id === params.attemptId)
    );
    return {
      found: Boolean(matched),
      interaction: matched,
      httpStatus: res.status,
    };
  }

  /**
   * Read-only fetch of verbatim turns from Sarvam Analytics `GET /transcripts/{interaction_id}`.
   */
  async fetchInteractionTranscript(interactionId: string): Promise<{
    found: boolean;
    messages: SarvamAnalyticsTranscriptMessage[];
    httpStatus: number;
    error?: string;
  }> {
    if (
      !env.SARVAM_API_KEY ||
      !env.SARVAM_ORG_ID ||
      !env.SARVAM_WORKSPACE_ID ||
      !env.SARVAM_AGENT_ID
    ) {
      return { found: false, messages: [], httpStatus: 0, error: 'Sarvam credentials incomplete' };
    }

    const url = this.getTranscriptEndpointUrl(interactionId);
    const res = await this.safeGetSarvamJson(url, 8000);
    if (!res.ok) {
      return { found: false, messages: [], httpStatus: res.status, error: res.errorSummary };
    }

    const rec =
      res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : {};
    const messages = Array.isArray(rec.messages)
      ? (rec.messages as SarvamAnalyticsTranscriptMessage[])
      : extractPagedItems<SarvamAnalyticsTranscriptMessage>(res.json, ['messages']);

    return {
      found: messages.length > 0,
      messages,
      httpStatus: res.status,
    };
  }

  /**
   * Fetches call audio recording from Sarvam Analytics API on behalf of an authorized family user
   * ONLY after verifying recording consent in CareVoice backend.
   */
  async fetchInteractionRecording(interactionId: string): Promise<{
    buffer: Buffer;
    mimeType: string;
  }> {
    if (!env.SARVAM_API_KEY || !env.SARVAM_ORG_ID || !env.SARVAM_WORKSPACE_ID || !env.SARVAM_AGENT_ID) {
      throw new AppError(
        'Sarvam credentials are required to retrieve call recordings',
        503,
        'SARVAM_CREDENTIALS_MISSING'
      );
    }

    const url = this.getRecordingEndpointUrl(interactionId);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': env.SARVAM_API_KEY,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) {
      throw new AppError(
        'Recording audio is not available yet on Sarvam for this interaction',
        404,
        'RECORDING_NOT_READY'
      );
    }

    if (!response.ok) {
      const parsedBody = await parseSarvamResponseBody(response);
      const extracted = extractSarvamErrorDetails(parsedBody.rawText, parsedBody.json);
      throw new AppError(
        extracted.summary
          ? `Failed to fetch recording from Sarvam (HTTP ${response.status}): ${extracted.summary}`
          : `Failed to fetch recording from Sarvam (HTTP ${response.status})`,
        502,
        'SARVAM_RECORDING_ERROR',
        { upstreamStatus: response.status, detail: extracted.summary }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get('content-type') || 'audio/wav',
    };
  }

  /**
   * Probes Sarvam Analytics `/recordings/{interaction_id}` without throwing to report honest
   * availability (`AVAILABLE`, `NOT_READY` on 404, or `ERROR`) without ever fabricating audio.
   */
  async probeInteractionRecording(interactionId: string): Promise<{
    status: 'AVAILABLE' | 'NOT_READY' | 'ERROR';
    mimeType?: string;
    httpStatus: number;
    error?: string;
  }> {
    if (
      !env.SARVAM_API_KEY ||
      !env.SARVAM_ORG_ID ||
      !env.SARVAM_WORKSPACE_ID ||
      !env.SARVAM_AGENT_ID
    ) {
      return {
        status: 'ERROR',
        httpStatus: 0,
        error: 'Sarvam credentials are incomplete',
      };
    }

    try {
      const url = this.getRecordingEndpointUrl(interactionId);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': env.SARVAM_API_KEY,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 404) {
        return {
          status: 'NOT_READY',
          httpStatus: 404,
          error: 'Sarvam Analytics returned HTTP 404 for this interaction recording',
        };
      }

      if (!response.ok) {
        const parsedBody = await parseSarvamResponseBody(response);
        const extracted = extractSarvamErrorDetails(parsedBody.rawText, parsedBody.json);
        return {
          status: 'ERROR',
          httpStatus: response.status,
          error: extracted.summary || `HTTP ${response.status}`,
        };
      }

      return {
        status: 'AVAILABLE',
        mimeType: response.headers.get('content-type') || 'audio/wav',
        httpStatus: response.status,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        httpStatus: 0,
        error: redactSecrets(err instanceof Error ? err.message : 'Network error probing recording'),
      };
    }
  }

  async simulateCall(
    _context: VoiceCallContextPayload,
    _scenario: MockCallScenario
  ): Promise<VoiceCallExecutionResult> {
    throw new AppError(
      'Simulation is only available on MockVoiceProvider',
      400,
      'SIMULATION_NOT_SUPPORTED_ON_LIVE'
    );
  }
}
