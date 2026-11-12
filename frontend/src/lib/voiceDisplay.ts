import type { CallLifecycleStatus } from '@/types';

export type CareVoiceBadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'indigo';

const TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/https?:\/\/apps\.sarvam\.ai[^\s"')]+/gi, 'CareVoice Voice Gateway'],
  [/apps\.sarvam\.ai/gi, 'CareVoice Voice Gateway'],
  [/\bRent from Sarvam\b/gi, 'CareVoice Telephony'],
  [/\bSarvam\s+Vobiz\b/gi, 'CareVoice Telephony'],
  [/\bSarvam\s+Instant\s+Outbound\s+API\b/gi, 'CareVoice Outbound Voice Service'],
  [/\bSarvam\s+Instant\s+Outbound\b/gi, 'Live Voice Calling'],
  [/\bSarvam\s+Live\s+Telephony\b/gi, 'CareVoice Voice Service'],
  [/\bSarvam\s+Analytics\s+API\b/gi, 'CareVoice Call Service'],
  [/\bSarvam\s+Analytics\b/gi, 'CareVoice Call Service'],
  [/\bSarvam\s+Voice\s+Agents?\b/gi, 'CareVoice Voice Service'],
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
  [/\bMOCK\s+SANDBOX\b/g, 'TEST ENVIRONMENT'],
  [/\bsandbox\b/gi, 'test environment'],
  [/\bInstant\s+Outbound\b/gi, 'Live Voice Calling'],
  [/\bInbound\s+Deployment\b/gi, 'Inbound Channel'],
  [/\bBulk\s+Campaign\b/gi, 'Batch Calling'],
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
  [/\bX-API-Key\b/gi, 'service authentication header'],
  [/\bAnalytics Interactions Probe\b/gi, 'Voice History Check'],
  [/\bAnalytics API\b/gi, 'CareVoice Call Service'],
];

/**
 * Strips third-party infrastructure names, internal API URLs, and raw provider jargon
 * so customer-facing UI text remains 100% CareVoice white-labeled.
 */
export function sanitizeVoiceText(input?: string | null): string {
  if (!input || typeof input !== 'string') return '';
  let out = input.trim();
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function translateVoiceError(
  err: unknown,
  fallback = 'Something went wrong while communicating with CareVoice Voice Service.'
): string {
  if (err instanceof Error && err.message) {
    return sanitizeVoiceText(err.message) || fallback;
  }
  if (typeof err === 'string' && err.trim()) {
    return sanitizeVoiceText(err) || fallback;
  }
  return fallback;
}

export const CALL_LIFECYCLE_META: Record<
  CallLifecycleStatus,
  { label: string; description: string; badgeVariant: CareVoiceBadgeVariant; terminal: boolean }
> = {
  QUEUED: {
    label: 'Queued',
    description: 'Scheduled and waiting in CareVoice call queue',
    badgeVariant: 'neutral',
    terminal: false,
  },
  INITIATING: {
    label: 'Initiating',
    description: 'Connecting request to voice network',
    badgeVariant: 'default',
    terminal: false,
  },
  RINGING: {
    label: 'Ringing',
    description: 'Patient phone is ringing (provider verified)',
    badgeVariant: 'default',
    terminal: false,
  },
  ANSWERED: {
    label: 'Answered',
    description: 'Call answered; starting reminder conversation',
    badgeVariant: 'indigo',
    terminal: false,
  },
  IN_PROGRESS: {
    label: 'In Progress',
    description: 'Patient is actively speaking with CareVoice assistant',
    badgeVariant: 'indigo',
    terminal: false,
  },
  COMPLETED: {
    label: 'Completed',
    description: 'Call finished',
    badgeVariant: 'success',
    terminal: true,
  },
  NO_ANSWER: {
    label: 'No Answer',
    description: 'Phone rang but was not answered',
    badgeVariant: 'warning',
    terminal: true,
  },
  BUSY: {
    label: 'Busy',
    description: 'Recipient line was busy',
    badgeVariant: 'warning',
    terminal: true,
  },
  REJECTED: {
    label: 'Rejected',
    description: 'Call was declined by the recipient',
    badgeVariant: 'neutral',
    terminal: true,
  },
  NOT_CONNECTED: {
    label: 'Not Connected',
    description: 'Call did not connect to recipient',
    badgeVariant: 'warning',
    terminal: true,
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'Call was cancelled before completion',
    badgeVariant: 'neutral',
    terminal: true,
  },
  PROVIDER_UNAVAILABLE: {
    label: 'Service Unavailable',
    description: 'Voice calling service could not be reached',
    badgeVariant: 'danger',
    terminal: true,
  },
  LANGUAGE_UNAVAILABLE: {
    label: 'Language Unavailable',
    description: 'Preferred call language is unavailable for live calling',
    badgeVariant: 'danger',
    terminal: true,
  },
  LANGUAGE_FALLBACK_REQUIRED: {
    label: 'Fallback Required',
    description: 'Explicit Admin language fallback permission required',
    badgeVariant: 'warning',
    terminal: true,
  },
  FAILED: {
    label: 'Failed',
    description: 'Call failed before completion',
    badgeVariant: 'danger',
    terminal: true,
  },
};

export function getCallLifecycleDisplay(status?: string | null): {
  status: string;
  label: string;
  description: string;
  badgeVariant: CareVoiceBadgeVariant;
  terminal: boolean;
} {
  if (!status || typeof status !== 'string') {
    return {
      status: 'UNKNOWN',
      label: 'Status unavailable',
      description: 'Verified call lifecycle status is currently unavailable',
      badgeVariant: 'neutral',
      terminal: false,
    };
  }
  const key = status.trim().toUpperCase() as CallLifecycleStatus;
  const meta = CALL_LIFECYCLE_META[key];
  if (!meta) {
    return {
      status: key,
      label: 'Status unavailable',
      description: 'Verified call lifecycle status is currently unavailable',
      badgeVariant: 'neutral',
      terminal: false,
    };
  }
  return { status: key, ...meta };
}

const OUTCOME_LABELS: Record<string, { label: string; badgeVariant: CareVoiceBadgeVariant }> = {
  PENDING: { label: 'Awaiting Completion', badgeVariant: 'neutral' },
  COMPLETED: { label: 'Completed', badgeVariant: 'success' },
  ANSWERED: { label: 'Answered (Unconfirmed)', badgeVariant: 'default' },
  CALLBACK_REQUESTED: { label: 'Callback Requested', badgeVariant: 'indigo' },
  NO_ANSWER: { label: 'No Answer', badgeVariant: 'warning' },
  BUSY: { label: 'Busy', badgeVariant: 'warning' },
  REJECTED: { label: 'Rejected', badgeVariant: 'neutral' },
  NOT_CONNECTED: { label: 'Not Connected', badgeVariant: 'warning' },
  CANCELLED: { label: 'Cancelled', badgeVariant: 'neutral' },
  FAILED: { label: 'Failed', badgeVariant: 'danger' },
  ESCALATED: { label: 'Escalated', badgeVariant: 'danger' },
};

export function getCallOutcomeDisplay(outcome?: string | null): {
  label: string;
  badgeVariant: CareVoiceBadgeVariant;
} {
  if (!outcome || typeof outcome !== 'string') {
    return { label: 'Status unavailable', badgeVariant: 'neutral' };
  }
  const key = outcome.trim().toUpperCase();
  return OUTCOME_LABELS[key] ?? { label: 'Status unavailable', badgeVariant: 'neutral' };
}

export function getCallTypeDisplay(callType?: string | null, isTestCall?: boolean): string {
  if (isTestCall || callType === 'ADMIN_TEST_CALL') {
    return 'Admin Test Call';
  }
  switch (callType) {
    case 'MEAL_REMINDER':
      return 'Meal Reminder';
    case 'MEDICINE_REMINDER':
      return 'Medicine Reminder';
    case 'CONFIRMATION_CALL':
      return 'Dose Confirmation';
    case 'CALLBACK':
      return 'Scheduled Callback';
    default:
      return callType ? callType.replace(/_/g, ' ') : 'Voice Call';
  }
}

export function getBaseCallTypeLabel(callType?: string | null): string {
  return getCallTypeDisplay(callType, false);
}

export function getCallModeDisplay(isMock: boolean): {
  label: string;
  shortLabel: string;
  badgeVariant: CareVoiceBadgeVariant;
} {
  if (isMock) {
    return {
      label: 'Test Environment',
      shortLabel: 'Test Environment',
      badgeVariant: 'warning',
    };
  }
  return {
    label: 'Live Voice Calling',
    shortLabel: 'Live',
    badgeVariant: 'success',
  };
}

export function getVoiceModeHeaderLabel(voiceMode?: 'mock' | 'sarvam' | string): string {
  return voiceMode === 'sarvam' ? 'CareVoice Voice Service' : 'Test Environment';
}

export function getTranscriptStatusDisplay(status?: string | null): {
  label: string;
  badgeVariant: CareVoiceBadgeVariant;
} {
  switch (status) {
    case 'AVAILABLE':
      return { label: 'Transcript Available', badgeVariant: 'success' };
    case 'CONSENT_DENIED':
      return { label: 'Transcript Withheld (No Consent)', badgeVariant: 'warning' };
    case 'PENDING':
      return { label: 'Transcript Processing', badgeVariant: 'default' };
    case 'UNAVAILABLE':
      return { label: 'Transcript Unavailable', badgeVariant: 'neutral' };
    default:
      return { label: 'Status unavailable', badgeVariant: 'neutral' };
  }
}

export function getRecordingStatusDisplay(status?: string | null): {
  label: string;
  badgeVariant: CareVoiceBadgeVariant;
} {
  switch (status) {
    case 'AVAILABLE':
      return { label: 'Recording Available', badgeVariant: 'success' };
    case 'CONSENT_DENIED':
      return { label: 'Recording Withheld (No Consent)', badgeVariant: 'warning' };
    case 'PROCESSING':
      return { label: 'Recording Processing', badgeVariant: 'default' };
    case 'UNAVAILABLE':
      return { label: 'Recording Unavailable', badgeVariant: 'neutral' };
    default:
      return { label: 'Status unavailable', badgeVariant: 'neutral' };
  }
}

export function getTranscriptSourceDisplay(source?: string | null): string {
  switch (source) {
    case 'WEBHOOK':
      return 'Live Call Stream';
    case 'ANALYTICS_API':
      return 'Call Service Archive';
    case 'MOCK':
      return 'Test Environment';
    default:
      return 'Not Available';
  }
}

export function getWebhookEventSourceDisplay(source?: string | null): string {
  switch (source) {
    case 'WEBHOOK':
      return 'Live Event';
    case 'ANALYTICS_API':
      return 'Status Sync';
    case 'RECONCILIATION':
      return 'Status Sync';
    case 'PROVIDER_API':
      return 'Voice Service';
    case 'ADMIN':
      return 'Admin Action';
    case 'SYSTEM':
      return 'CareVoice System';
    default:
      return source ? sanitizeVoiceText(source.replace(/_/g, ' ')) : 'System';
  }
}

export function getLanguageStatusDisplay(status?: string | null): {
  label: string;
  badgeVariant: CareVoiceBadgeVariant;
} {
  switch (status) {
    case 'MATCHED':
      return { label: 'Matched', badgeVariant: 'success' };
    case 'FALLBACK_AUTHORIZED':
      return { label: 'Fallback Authorized', badgeVariant: 'warning' };
    case 'LANGUAGE_FALLBACK_REQUIRED':
      return { label: 'Fallback Required', badgeVariant: 'warning' };
    case 'LANGUAGE_UNAVAILABLE':
      return { label: 'Language Unavailable', badgeVariant: 'danger' };
    case 'LANGUAGE_MISMATCH':
      return { label: 'Language Mismatch', badgeVariant: 'danger' };
    default:
      return { label: 'Status unavailable', badgeVariant: 'neutral' };
  }
}

export function formatSafetyFlagLabel(flag: string): string {
  const cleaned = flag
    .replace(/^SARVAM_/i, '')
    .replace(/^VOICE_SERVICE_/i, '')
    .replace(/^CALL_/i, '')
    .replace(/_/g, ' ');
  return sanitizeVoiceText(cleaned);
}

export function formatConfigFieldLabel(field: string): string {
  const map: Record<string, string> = {
    VOICE_PROVIDER_MODE: 'Live Calling Mode',
    TELEPHONY_ENABLED: 'Outbound Calling Toggle',
    SARVAM_API_KEY: 'Voice Service Credentials',
    SARVAM_ORG_ID: 'Organization Configuration',
    SARVAM_WORKSPACE_ID: 'Workspace Configuration',
    SARVAM_AGENT_ID: 'Voice Assistant Profile',
    SARVAM_CONNECTION_ID: 'Calling Line Connection',
    SARVAM_PHONE_NUMBER: 'CareVoice Calling Number',
    PUBLIC_WEBHOOK_BASE_URL: 'Public Call Event URL',
    SARVAM_WEBHOOK_TOKEN: 'Call Event Verification Token',
    SARVAM_WEBHOOK_SECRET: 'Call Event Signing Secret',
    WEBHOOK_AUTH: 'Call Event Security Token',
  };
  return map[field] || sanitizeVoiceText(field.replace(/_/g, ' '));
}

export function getPreflightCheckDisplayLabel(label?: string): string {
  if (!label) return 'System Check';
  return sanitizeVoiceText(label);
}

export function getRawServiceStatusDisplay(rawStatus?: string | null): string {
  if (!rawStatus) return 'Status unavailable';
  const cleaned = sanitizeVoiceText(rawStatus);
  return cleaned.replace(/_/g, ' ');
}

