/**
 * Centralized provider-neutral sanitization layer for user-facing CareVoice strings.
 * Internal backend logs (`logger.*`), database `AuditLog` entries, and internal provider
 * diagnostic fields retain real upstream metadata for engineering/debugging, while any
 * customer-facing summaries, notes, and UI messages are translated to CareVoice copy.
 */
const PROVIDER_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https?:\/\/apps\.sarvam\.ai[^\s"')]+/gi, 'CareVoice Voice Gateway'],
  [/apps\.sarvam\.ai/gi, 'CareVoice Voice Gateway'],
  [/\bRent from Sarvam\b/gi, 'CareVoice Telephony'],
  [/\bSarvam\s+Vobiz\b/gi, 'CareVoice Telephony'],
  [/\bSarvam\s+Instant\s+Outbound\s+API\b/gi, 'CareVoice Outbound Voice Service'],
  [/\bSarvam\s+Instant\s+Outbound\b/gi, 'CareVoice Live Voice Calling'],
  [/\bSarvam\s+Live\s+Telephony\b/gi, 'CareVoice Voice Service'],
  [/\bSarvam\s+Analytics\b/gi, 'CareVoice Call Service'],
  [/\bSarvam\s+Canvas\b/gi, 'CareVoice Voice Configuration'],
  [/\bSarvam\s+Deploy\b/gi, 'CareVoice Voice Configuration'],
  [/\bSarvam\s+outbound\s+API\b/gi, 'CareVoice Outbound Voice Service'],
  [/\bSarvam\s+telephony\b/gi, 'CareVoice Voice Service'],
  [/\bSarvam\s+outbound\b/gi, 'outbound voice'],
  [/\bSarvam\b/gi, 'CareVoice Voice Service'],
  [/\bVobiz\b/gi, 'CareVoice Calling Number'],
  [/\bMock\s+Voice\s+Sandbox\b/gi, 'Test Environment'],
  [/\bMock\s+Sandbox\b/gi, 'Test Environment'],
  [/\bDev\s+Sandbox\b/gi, 'Test Environment'],
  [/\bSANDBOX\b/g, 'TEST ENVIRONMENT'],
  [/\bsandbox\b/gi, 'test environment'],
  [/\bSARVAM_PROVIDER_ERROR\b/g, 'Voice Service Error'],
  [/\bSARVAM_DEPLOYMENT_NOT_READY\b/g, 'Voice Service Not Ready'],
  [/\bSARVAM_ALLOWED_LANGUAGES\b/g, 'configured voice languages'],
  [/\bSARVAM_AGENT_VERSION\b/g, 'configured assistant version'],
  [/\bSARVAM_AGENT_ID\b/g, 'configured voice assistant'],
  [/\bSARVAM_CONNECTION_ID\b/g, 'configured calling connection'],
  [/\bSARVAM_PHONE_NUMBER\b/g, 'configured calling number'],
  [/\bSARVAM_API_KEY\b/g, 'voice service credential'],
  [/\bSARVAM_ORG_ID\b/g, 'organization configuration'],
  [/\bSARVAM_WORKSPACE_ID\b/g, 'workspace configuration'],
  [/\bSARVAM_WEBHOOK_TOKEN\b/g, 'call event verification token'],
  [/\bSARVAM_WEBHOOK_SECRET\b/g, 'call event signing secret'],
  [/\bPUBLIC_WEBHOOK_BASE_URL\b/g, 'public call event URL'],
  [/\bVOICE_PROVIDER_MODE\b/g, 'voice service mode'],
  [/\bTELEPHONY_ENABLED\b/g, 'live calling toggle'],
];

export function sanitizePublicVoiceText(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  let out = input.trim();
  for (const [pattern, replacement] of PROVIDER_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

