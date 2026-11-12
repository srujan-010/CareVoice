import { MockVoiceProvider } from '../adapters/voice/mockVoice.provider';
import {
  parseSarvamUtcTimestamp,
  SarvamDeploymentVerificationResult,
  SarvamVoiceProvider,
} from '../adapters/voice/sarvamVoice.provider';
import {
  IVoiceProvider,
  MockCallScenario,
  SimulatedTurn,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from '../adapters/voice/voiceProvider.interface';
import {
  env,
  getSarvamWebhookReadiness,
  isMockSimulationAllowed,
  isTelephonyReady,
} from '../config/env';
import { tryGetSupportedLanguage } from '../constants/languages';
import {
  CallErrorCategory,
  CallLifecycleStatus,
  CallOutcome,
  MedicineConfirmationValue,
} from '../constants/statuses';
import { SarvamCallConnectivityStatus } from '../models/CallLog';
import { AppError } from '../utils/errors';
import { normalizeAndValidateE164 } from '../utils/phone';

export { parseSarvamUtcTimestamp };

const mockProvider = new MockVoiceProvider();
const sarvamProvider = new SarvamVoiceProvider();

const SARVAM_SENTINEL_EMPTY_VALUES = new Set([
  'no_failure_reason',
  'no_end_reason',
  'unknown',
  'none',
  'null',
  'n/a',
]);

export function cleanSarvamSentinel(raw?: string | null): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (SARVAM_SENTINEL_EMPTY_VALUES.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

export function resolveSarvamLanguageCode(raw?: string | null): string | undefined {
  const cleaned = cleanSarvamSentinel(raw);
  if (!cleaned) return undefined;
  const matched = tryGetSupportedLanguage(cleaned);
  return matched ? matched.code : cleaned;
}

export interface SarvamTranscriptTurnInput {
  role?: string;
  speaker?: string;
  en_text?: string;
  indic_text?: string;
  text?: string;
  content?: string;
  message?: string;
  translatedText?: string;
  intent?: string;
  timestamp?: string;
  language?: string;
  language_name?: string;
  turn_id?: number | string;
}

export interface SarvamOutboundWebhookPayload {
  attempt_id: string;
  status?: SarvamCallConnectivityStatus;
  connectivity_status?: SarvamCallConnectivityStatus;
  event_type?: string | null;
  event_id?: string | null;
  started_at?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  ended_by?: string | null;
  recording_url?: string | null;
  channel_info?: Record<string, unknown> | null;
  duration?: number | null;
  interaction_id?: string | null;
  failure_reason?: string | null;
  language_name?: string | null;
  final_agent_variables?: Record<string, unknown> | null;
  webhook_config?: {
    url?: string;
    metadata?: Record<string, unknown> | null;
  } | null;
  interaction_transcript?: SarvamTranscriptTurnInput[] | null;
}

function readBooleanVar(vars: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    if (!(key in vars)) continue;
    const raw = vars[key];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (['true', 'yes', '1'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
  }
  return null;
}

function readExplicitMedicineConfirmation(
  vars: Record<string, unknown> | null | undefined
): MedicineConfirmationValue {
  if (!vars) return 'UNCONFIRMED';

  // Negative flags always prevent marking a dose as TAKEN
  const negativeBool = readBooleanVar(vars, [
    'medicine_not_taken',
    'medicineNotTaken',
    'patient_forgot',
    'patientForgot',
    'dose_skipped',
  ]);
  if (negativeBool === true) {
    return 'NOT_TAKEN';
  }

  const candidateKeys = [
    'medicine_taken',
    'medicineTaken',
    'medicine_confirmed',
    'medicineConfirmed',
    'dose_taken',
    'doseTaken',
    'explicit_medicine_confirmation',
  ];

  for (const key of candidateKeys) {
    if (!(key in vars)) continue;
    const val = vars[key];
    if (val === false) return 'NOT_TAKEN';
    if (val === true) return 'TAKEN';
    if (typeof val === 'string') {
      const upper = val.trim().toUpperCase();
      if (['NOT_TAKEN', 'PATIENT_REPORTED_NOT_TAKEN', 'NO', 'FALSE', 'FORGOT'].includes(upper)) {
        return 'NOT_TAKEN';
      }
      if (['TAKEN', 'PATIENT_REPORTED_TAKEN', 'YES', 'TRUE', 'CONFIRMED_TAKEN'].includes(upper)) {
        return 'TAKEN';
      }
    }
  }

  return 'UNCONFIRMED';
}

export function mapProviderRawStatusToLifecycle(rawStatus?: string): CallLifecycleStatus {
  const normalized = (rawStatus || '').trim().toLowerCase();
  if (normalized === 'queued') return 'QUEUED';
  if (normalized === 'initiating' || normalized === 'initiated' || normalized === 'dialing') {
    return 'INITIATING';
  }
  if (normalized === 'ringing' || normalized === 'ring') return 'RINGING';
  if (normalized === 'answered') return 'ANSWERED';
  if (normalized === 'in_progress' || normalized === 'ongoing') return 'IN_PROGRESS';
  if (normalized === 'completed' || normalized === 'connected' || normalized === 'succeeded') {
    return 'COMPLETED';
  }
  if (normalized === 'no_answer' || normalized === 'no-answer' || normalized === 'unanswered') {
    return 'NO_ANSWER';
  }
  if (normalized === 'busy') return 'BUSY';
  if (normalized === 'rejected' || normalized === 'declined') return 'REJECTED';
  if (
    normalized === 'not_connected' ||
    normalized === 'not-connected' ||
    normalized === 'unreachable'
  ) {
    return 'NOT_CONNECTED';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') return 'CANCELLED';
  if (normalized === 'failed' || normalized === 'error') return 'FAILED';
  return 'INITIATING';
}

export function getActiveVoiceProvider(): IVoiceProvider {
  const readiness = isTelephonyReady();
  if (readiness.ready && env.VOICE_PROVIDER_MODE === 'sarvam') {
    return sarvamProvider;
  }
  return mockProvider;
}

export function maskPhoneNumber(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 6) return trimmed ? '***' : '';
  return `${trimmed.slice(0, 3)}******${trimmed.slice(-4)}`;
}

export function getVoiceAgentStatus() {
  const readiness = isTelephonyReady();
  const webhookReadiness = getSarvamWebhookReadiness();

  return {
    activeProvider: getActiveVoiceProvider().providerName,
    configuredMode: env.VOICE_PROVIDER_MODE,
    telephonyEnabled: env.TELEPHONY_ENABLED,
    telephonyReady: readiness.ready,
    missingTelephonyFields: readiness.missingFields,
    webhookReady: webhookReadiness.ready,
    missingWebhookFields: webhookReadiness.missingFields,
    webhookHttps: webhookReadiness.isHttps,
    mockSimulationAllowed: isMockSimulationAllowed(),
    agentVersion: env.SARVAM_AGENT_VERSION,
    callerIdMasked: env.SARVAM_PHONE_NUMBER ? maskPhoneNumber(env.SARVAM_PHONE_NUMBER) : null,
    providers: {
      mock: mockProvider.getStatus(),
      sarvam: sarvamProvider.getStatus(),
    },
  };
}

export async function verifySarvamAgentDeployment(): Promise<SarvamDeploymentVerificationResult> {
  return sarvamProvider.verifyAgentDeployment();
}

export async function fetchSarvamRecordingAudio(interactionId: string) {
  return sarvamProvider.fetchInteractionRecording(interactionId);
}

export async function probeSarvamRecording(interactionId: string) {
  return sarvamProvider.probeInteractionRecording(interactionId);
}

export async function fetchSarvamAttemptById(attemptId: string, referenceDate?: Date) {
  return sarvamProvider.fetchAttemptByAttemptId(attemptId, referenceDate);
}

export async function fetchSarvamInteraction(params: {
  attemptId?: string;
  interactionId?: string;
  referenceDate?: Date;
}) {
  return sarvamProvider.fetchInteractionByAttemptOrId(params);
}

export async function fetchSarvamTranscript(interactionId: string) {
  return sarvamProvider.fetchInteractionTranscript(interactionId);
}

export async function dispatchLiveVoiceCall(context: VoiceCallContextPayload) {
  const validatedUserPhone = normalizeAndValidateE164(
    context.phoneNumber,
    'user_config.user_phone_number'
  );
  return sarvamProvider.initiateLiveCall({
    ...context,
    phoneNumber: validatedUserPhone,
  });
}

export async function simulateMockVoiceCall(
  context: VoiceCallContextPayload,
  scenario: MockCallScenario,
  options?: { delayMinutes?: number }
): Promise<VoiceCallExecutionResult> {
  return mockProvider.simulateCall(context, scenario, options);
}

/**
 * Normalizes official Sarvam `interaction_transcript` items ({ role, en_text, indic_text })
 * or generic turn objects into CareVoice Conversation turns.
 */
export function mapSarvamTranscript(
  rawTranscript?: SarvamTranscriptTurnInput[] | null,
  defaultLanguage?: string
): SimulatedTurn[] {
  if (!Array.isArray(rawTranscript)) return [];

  const turns: SimulatedTurn[] = [];
  for (const item of rawTranscript) {
    if (!item || typeof item !== 'object') continue;
    const rawRole = (item.role || item.speaker || '').toString().trim().toLowerCase();
    const speaker: 'AI' | 'PATIENT' =
      rawRole === 'agent' || rawRole === 'assistant' || rawRole === 'ai' ? 'AI' : 'PATIENT';

    const indicText = typeof item.indic_text === 'string' ? item.indic_text.trim() : '';
    const enText = typeof item.en_text === 'string' ? item.en_text.trim() : '';
    const directText =
      typeof item.text === 'string'
        ? item.text.trim()
        : typeof item.content === 'string'
          ? item.content.trim()
          : typeof item.message === 'string'
            ? item.message.trim()
            : '';

    const primaryText = indicText || directText || enText;
    if (!primaryText) continue;

    const translatedText =
      typeof item.translatedText === 'string' && item.translatedText.trim()
        ? item.translatedText.trim()
        : indicText && enText && indicText !== enText
          ? enText
          : directText && enText && directText !== enText
            ? enText
            : undefined;

    const parsedTimestamp =
      typeof item.timestamp === 'string' ? parseSarvamUtcTimestamp(item.timestamp) : undefined;
    const resolvedLanguage =
      resolveSarvamLanguageCode(item.language || item.language_name) ||
      (indicText ? resolveSarvamLanguageCode(defaultLanguage) : undefined);

    const turn: SimulatedTurn = {
      speaker,
      text: primaryText,
      translatedText,
    };
    if (typeof item.intent === 'string' && item.intent.trim()) {
      turn.intent = item.intent.trim();
    }
    if (parsedTimestamp) {
      turn.timestamp = parsedTimestamp;
    }
    if (resolvedLanguage) {
      turn.language = resolvedLanguage;
    }
    if (item.turn_id !== undefined && item.turn_id !== null && `${item.turn_id}`.trim()) {
      turn.turnId = String(item.turn_id).trim();
    }

    turns.push(turn);
  }

  return turns;
}

function parseAnalyticsTurnItem(raw: unknown): {
  speaker: 'AI' | 'PATIENT';
  text: string;
  language?: string;
  turnId?: string;
  timestamp?: Date;
} | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(assistant|agent|ai|user|patient)\s*[:\-]\s*(.+)$/i);
    if (match) {
      const role = match[1].toLowerCase();
      return {
        speaker: role === 'assistant' || role === 'agent' || role === 'ai' ? 'AI' : 'PATIENT',
        text: match[2].trim(),
      };
    }
    return { speaker: 'AI', text: trimmed };
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawRole = String(obj.role || obj.speaker || obj.sender || '')
    .trim()
    .toLowerCase();
  const speaker: 'AI' | 'PATIENT' =
    rawRole === 'agent' || rawRole === 'assistant' || rawRole === 'ai' ? 'AI' : 'PATIENT';
  const text = String(
    obj.content || obj.text || obj.message || obj.utterance || obj.indic_text || obj.en_text || ''
  ).trim();
  if (!text) return null;

  const lang = resolveSarvamLanguageCode(
    typeof obj.language_name === 'string'
      ? obj.language_name
      : typeof obj.language === 'string'
        ? obj.language
        : undefined
  );
  const ts =
    typeof obj.timestamp === 'string' ? parseSarvamUtcTimestamp(obj.timestamp) : undefined;
  const turnId =
    obj.turn_id !== undefined && obj.turn_id !== null ? String(obj.turn_id).trim() : undefined;

  return { speaker, text, language: lang, turnId, timestamp: ts };
}

/**
 * Merges Sarvam Analytics transcript sources (`GET /transcripts/{interaction_id}` messages
 * and/or `GET /interactions?include_transcript=true` aligned original + English translations).
 */
export function mapSarvamAnalyticsTranscripts(input: {
  originalTranscript?: unknown;
  translateTranscript?: unknown;
  messages?: Array<{
    turn_id?: number | string;
    role?: string;
    content?: string;
    language_name?: string;
  }>;
  defaultLanguage?: string;
}): SimulatedTurn[] {
  const originalArr = Array.isArray(input.originalTranscript) ? input.originalTranscript : [];
  const translateArr = Array.isArray(input.translateTranscript) ? input.translateTranscript : [];
  const messagesArr = Array.isArray(input.messages) ? input.messages : [];

  const parsedOriginal = originalArr
    .map(parseAnalyticsTurnItem)
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const parsedTranslate = translateArr
    .map(parseAnalyticsTurnItem)
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  const parsedMessages = messagesArr
    .map(parseAnalyticsTurnItem)
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  // Prefer originalTranscript paired 1:1 with translateTranscript when present (preserves Indic + EN translation)
  const baseTurns = parsedOriginal.length > 0 ? parsedOriginal : parsedMessages;
  if (baseTurns.length === 0) return [];

  return baseTurns.map((turn, idx) => {
    const transCandidate = parsedTranslate[idx];
    const translatedText =
      transCandidate &&
      transCandidate.text &&
      transCandidate.text.trim() !== turn.text.trim()
        ? transCandidate.text.trim()
        : undefined;
    const msgFallback = parsedMessages[idx];
    const resolvedLanguage =
      turn.language || msgFallback?.language || resolveSarvamLanguageCode(input.defaultLanguage);
    const turnId = turn.turnId || msgFallback?.turnId || String(idx + 1);

    const out: SimulatedTurn = {
      speaker: turn.speaker,
      text: turn.text,
      translatedText,
      turnId,
    };
    if (resolvedLanguage) out.language = resolvedLanguage;
    if (turn.timestamp) out.timestamp = turn.timestamp;
    return out;
  });
}

/**
 * Interprets official Sarvam outbound status + final_agent_variables (from webhook or Analytics).
 * Strict medical & privacy safety rules:
 * - Only terminal `connected`/`completed` calls may inspect patient intake variables.
 * - `no_answer`, `busy`, `rejected`, `not_connected`, `cancelled`, and `failed` ALWAYS stay UNCONFIRMED.
 * - Meal confirmation (`meal_finished`) NEVER implies medicine intake.
 * - Medicine intake is marked `TAKEN` ONLY when explicit confirmation variables support it.
 * - Verbatim transcript turns & summary notes are stored/exposed ONLY when `CALL_TRANSCRIPT` consent is GRANTED.
 */
export function evaluateSarvamAgentOutcome(
  payload: SarvamOutboundWebhookPayload,
  patientName: string,
  medicineName: string,
  options: { recordingConsentGranted?: boolean; transcriptConsentGranted?: boolean } = {}
): {
  isIntermediateEvent: boolean;
  callStatus: CallLifecycleStatus;
  outcome: CallOutcome;
  durationSeconds: number;
  mealConfirmed: boolean | null;
  medicineConfirmed: MedicineConfirmationValue;
  requestedCallbackDelayMinutes?: number;
  feelingUnwell: boolean;
  requestedHelp: boolean;
  turns: SimulatedTurn[];
  aiSummary: string;
  safetyFlags: string[];
  actualLanguageUsed?: string;
} {
  const audioRecordingConsentGranted = options.recordingConsentGranted ?? true;
  const transcriptConsentGranted =
    options.transcriptConsentGranted ?? options.recordingConsentGranted ?? true;

  const rawStatus = (payload.status || payload.connectivity_status || '')
    .toString()
    .trim()
    .toLowerCase();

  const durationSeconds =
    typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration > 0
      ? Math.round(payload.duration)
      : 0;

  const vars = payload.final_agent_variables ?? null;
  const actualLanguageUsed =
    resolveSarvamLanguageCode(
      payload.language_name ||
        (vars && typeof vars.language_name === 'string' ? vars.language_name : undefined) ||
        (vars && typeof vars.detected_language === 'string' ? vars.detected_language : undefined)
    );

  if (
    rawStatus === 'queued' ||
    rawStatus === 'initiating' ||
    rawStatus === 'initiated' ||
    rawStatus === 'dialing' ||
    rawStatus === 'ringing' ||
    rawStatus === 'ring' ||
    rawStatus === 'answered' ||
    rawStatus === 'in_progress' ||
    rawStatus === 'ongoing'
  ) {
    const lifecycle = mapProviderRawStatusToLifecycle(rawStatus);
    return {
      isIntermediateEvent: true,
      callStatus: lifecycle,
      outcome: 'PENDING',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} is currently ${lifecycle}. Awaiting completion.`,
      safetyFlags: [`SARVAM_${lifecycle}`],
      actualLanguageUsed,
    };
  }

  if (rawStatus === 'no_answer' || rawStatus === 'no-answer' || rawStatus === 'unanswered') {
    return {
      isIntermediateEvent: false,
      callStatus: 'NO_ANSWER',
      outcome: 'NO_ANSWER',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} had no answer. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_NO_ANSWER', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (rawStatus === 'busy') {
    return {
      isIntermediateEvent: false,
      callStatus: 'BUSY',
      outcome: 'BUSY',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} encountered a busy line. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_BUSY', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (rawStatus === 'rejected' || rawStatus === 'declined') {
    return {
      isIntermediateEvent: false,
      callStatus: 'REJECTED',
      outcome: 'REJECTED',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} was rejected. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_REJECTED', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (
    rawStatus === 'not_connected' ||
    rawStatus === 'not-connected' ||
    rawStatus === 'unreachable'
  ) {
    const cleanReason = cleanSarvamSentinel(payload.failure_reason);
    const reasonText = cleanReason ? ` (${cleanReason})` : '';
    return {
      isIntermediateEvent: false,
      callStatus: 'NOT_CONNECTED',
      outcome: 'NOT_CONNECTED',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} did not connect${reasonText}. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_NOT_CONNECTED', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (rawStatus === 'cancelled' || rawStatus === 'canceled') {
    return {
      isIntermediateEvent: false,
      callStatus: 'CANCELLED',
      outcome: 'CANCELLED',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} was cancelled before completion. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_CANCELLED', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (rawStatus === 'failed' || rawStatus === 'error') {
    const cleanReason = cleanSarvamSentinel(payload.failure_reason);
    const reasonText = cleanReason ? ` (${cleanReason})` : '';
    return {
      isIntermediateEvent: false,
      callStatus: 'FAILED',
      outcome: 'FAILED',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam outbound call to ${patientName} for ${medicineName} failed${reasonText}. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_CALL_FAILED', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  if (rawStatus !== 'connected' && rawStatus !== 'completed' && rawStatus !== 'succeeded') {
    return {
      isIntermediateEvent: false,
      callStatus: 'FAILED',
      outcome: 'FAILED',
      durationSeconds,
      mealConfirmed: null,
      medicineConfirmed: 'UNCONFIRMED',
      feelingUnwell: false,
      requestedHelp: false,
      turns: [],
      aiSummary: `Sarvam returned unrecognized status "${rawStatus || 'UNKNOWN'}" for ${patientName}. Dose remains UNCONFIRMED.`,
      safetyFlags: ['SARVAM_UNRECOGNIZED_STATUS', 'DOSE_UNCONFIRMED'],
      actualLanguageUsed,
    };
  }

  // status === 'connected' | 'completed'
  const turns = transcriptConsentGranted
    ? mapSarvamTranscript(payload.interaction_transcript, actualLanguageUsed)
    : [];

  const feelingUnwell =
    vars !== null &&
    readBooleanVar(vars, [
      'feeling_unwell',
      'feelingUnwell',
      'patient_feeling_unwell',
      'is_unwell',
    ]) === true;
  const requestedHelp =
    vars !== null &&
    readBooleanVar(vars, [
      'requested_help',
      'requestedHelp',
      'needs_help',
      'emergency_help',
    ]) === true;

  const mealConfirmed =
    vars !== null
      ? readBooleanVar(vars, [
          'meal_finished',
          'mealFinished',
          'meal_confirmed',
          'mealConfirmed',
          'has_finished_meal',
        ])
      : null;

  const callbackRequested =
    vars !== null &&
    readBooleanVar(vars, ['callback_requested', 'callbackRequested']) === true;

  const rawDelay = vars
    ? (vars.callback_delay_minutes ?? vars.delay_minutes ?? vars.delayMinutes)
    : undefined;
  const parsedDelay = typeof rawDelay === 'number' ? rawDelay : Number(rawDelay);
  const requestedCallbackDelayMinutes = callbackRequested
    ? Number.isInteger(parsedDelay) && parsedDelay >= 1 && parsedDelay <= 120
      ? parsedDelay
      : 10
    : undefined;

  let medicineConfirmed = readExplicitMedicineConfirmation(vars);

  // Callback request or unwell escalation never upgrades an unconfirmed dose to taken,
  // and callback delay overrides taken if callback was specifically requested instead of intake.
  if (callbackRequested && medicineConfirmed !== 'NOT_TAKEN') {
    medicineConfirmed = 'UNCONFIRMED';
  }

  let outcome: CallOutcome;
  const safetyFlags: string[] = [];

  if (!transcriptConsentGranted && !audioRecordingConsentGranted) {
    safetyFlags.push('RECORDING_AND_TRANSCRIPT_WITHHELD_NO_CONSENT');
  } else if (!transcriptConsentGranted) {
    safetyFlags.push('TRANSCRIPT_WITHHELD_NO_CONSENT');
  } else if (!audioRecordingConsentGranted) {
    safetyFlags.push('RECORDING_WITHHELD_NO_CONSENT');
  }

  if (feelingUnwell || requestedHelp) {
    outcome = 'ESCALATED';
    safetyFlags.push(feelingUnwell ? 'PATIENT_FEELING_UNWELL' : 'PATIENT_REQUESTED_HELP');
  } else if (callbackRequested) {
    outcome = 'CALLBACK_REQUESTED';
    safetyFlags.push('CALLBACK_REQUESTED', 'DOSE_UNCONFIRMED');
  } else if (medicineConfirmed === 'TAKEN') {
    outcome = 'COMPLETED';
    safetyFlags.push('EXPLICIT_DOSE_CONFIRMATION');
  } else if (medicineConfirmed === 'NOT_TAKEN') {
    outcome = 'COMPLETED';
    safetyFlags.push('PATIENT_REPORTED_NOT_TAKEN');
  } else {
    outcome = 'ANSWERED';
    if (mealConfirmed === true) {
      safetyFlags.push('MEAL_CONFIRMED_ONLY');
    }
    safetyFlags.push('NO_ASSUMED_TAKE', 'DOSE_UNCONFIRMED');
  }

  const summaryVar =
    transcriptConsentGranted && vars && typeof vars.summary === 'string' && vars.summary.trim()
      ? vars.summary.trim()
      : undefined;

  const aiSummary =
    summaryVar ||
    (medicineConfirmed === 'TAKEN'
      ? `Sarvam call completed (${durationSeconds}s): ${patientName} explicitly confirmed taking ${medicineName}.`
      : medicineConfirmed === 'NOT_TAKEN'
        ? `Sarvam call completed (${durationSeconds}s): ${patientName} reported NOT taking ${medicineName}.`
        : outcome === 'CALLBACK_REQUESTED'
          ? `Sarvam call completed (${durationSeconds}s): ${patientName} requested a callback in ${requestedCallbackDelayMinutes} minutes. Dose stays UNCONFIRMED.`
          : outcome === 'ESCALATED'
            ? `Sarvam call escalated (${durationSeconds}s): ${patientName} reported feeling unwell or asked for caregiver help.`
            : `Sarvam call completed (${durationSeconds}s) for ${patientName} regarding ${medicineName}, but explicit medicine intake was not confirmed. Dose remains UNCONFIRMED.`);

  return {
    isIntermediateEvent: false,
    callStatus: 'COMPLETED',
    outcome,
    durationSeconds,
    mealConfirmed,
    medicineConfirmed,
    requestedCallbackDelayMinutes,
    feelingUnwell,
    requestedHelp,
    turns,
    aiSummary,
    safetyFlags,
    actualLanguageUsed,
  };
}

export function classifySarvamSchedulerError(err: unknown): {
  category: CallErrorCategory;
  nonRetryable: boolean;
  detail: string;
} {
  const detail = err instanceof Error ? err.message : String(err || 'Sarvam outbound dispatch failed');

  if (err instanceof AppError) {
    const details =
      err.details && typeof err.details === 'object' && !Array.isArray(err.details)
        ? (err.details as Record<string, unknown>)
        : {};
    const explicitCategory = details.errorCategory;
    if (
      explicitCategory === 'CONFIGURATION_ERROR' ||
      explicitCategory === 'LANGUAGE_UNAVAILABLE' ||
      explicitCategory === 'AUTHENTICATION_ERROR' ||
      explicitCategory === 'PROVIDER_ERROR'
    ) {
      return {
        category: explicitCategory,
        nonRetryable: explicitCategory !== 'PROVIDER_ERROR',
        detail,
      };
    }

    const authCat = typeof details.authCategory === 'string' ? details.authCategory : '';
    const upstreamStatus = typeof details.upstreamStatus === 'number' ? details.upstreamStatus : 0;

    if (err.code === 'LANGUAGE_FALLBACK_REQUIRED' || authCat === 'LANGUAGE_UNSUPPORTED') {
      return {
        category: 'LANGUAGE_UNAVAILABLE',
        nonRetryable: true,
        detail,
      };
    }

    if (
      err.code === 'SARVAM_CREDENTIAL_SYNTAX_ERROR' ||
      upstreamStatus === 401 ||
      upstreamStatus === 403 ||
      [
        'KEY_SYNTAX_ERROR',
        'INVALID_API_KEY_FORMAT',
        'UNAUTHORIZED_INVALID_OR_REVOKED_KEY',
        'INSUFFICIENT_PERMISSIONS',
      ].includes(authCat)
    ) {
      return {
        category: 'AUTHENTICATION_ERROR',
        nonRetryable: true,
        detail,
      };
    }

    if (
      err.code === 'CONFIGURATION_ERROR' ||
      err.code === 'SARVAM_CONFIGURATION_ERROR' ||
      err.code === 'INVALID_SARVAM_AGENT_VERSION' ||
      err.code === 'WEBHOOK_AUTH_NOT_CONFIGURED' ||
      err.code === 'TELEPHONY_DISABLED' ||
      err.code === 'VALIDATION_ERROR' ||
      upstreamStatus === 400 ||
      upstreamStatus === 404 ||
      upstreamStatus === 422 ||
      [
        'CONFIGURATION_ERROR',
        'CONFIG_MISSING',
        'WORKSPACE_OR_ORG_NOT_FOUND',
        'APP_NOT_FOUND_IN_WORKSPACE',
        'AGENT_UNVERIFIED_IN_WORKSPACE',
        'DEPLOYMENT_INACTIVE',
        'DEPLOYMENT_MISMATCH',
      ].includes(authCat)
    ) {
      return {
        category: 'CONFIGURATION_ERROR',
        nonRetryable: true,
        detail,
      };
    }

    if (
      err.code === 'SARVAM_NETWORK_ERROR' ||
      err.code === 'SARVAM_INVALID_RESPONSE' ||
      upstreamStatus >= 500 ||
      upstreamStatus === 429
    ) {
      return {
        category: 'PROVIDER_ERROR',
        nonRetryable: false,
        detail,
      };
    }
  }

  return {
    category: 'PROVIDER_ERROR',
    nonRetryable: false,
    detail,
  };
}
