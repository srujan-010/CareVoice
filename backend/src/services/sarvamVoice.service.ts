import { MockVoiceProvider } from '../adapters/voice/mockVoice.provider';
import {
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
import {
  CallLifecycleStatus,
  CallOutcome,
  MedicineConfirmationValue,
} from '../constants/statuses';
import { SarvamCallConnectivityStatus } from '../models/CallLog';
import { normalizeAndValidateE164 } from '../utils/phone';

const mockProvider = new MockVoiceProvider();
const sarvamProvider = new SarvamVoiceProvider();

export interface SarvamTranscriptTurnInput {
  role?: string;
  speaker?: string;
  en_text?: string;
  indic_text?: string;
  text?: string;
  content?: string;
  translatedText?: string;
  intent?: string;
}

export interface SarvamOutboundWebhookPayload {
  attempt_id: string;
  status: SarvamCallConnectivityStatus;
  event_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  recording_url?: string | null;
  channel_info?: Record<string, unknown> | null;
  duration?: number | null;
  interaction_id?: string | null;
  failure_reason?: string | null;
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
  if (normalized === 'ringing' || normalized === 'ring') return 'RINGING';
  if (normalized === 'in_progress' || normalized === 'answered' || normalized === 'ongoing') {
    return 'IN_PROGRESS';
  }
  if (normalized === 'completed' || normalized === 'connected') return 'COMPLETED';
  if (normalized === 'no_answer') return 'NO_ANSWER';
  if (normalized === 'busy') return 'BUSY';
  if (normalized === 'rejected' || normalized === 'declined') return 'REJECTED';
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
  rawTranscript?: SarvamTranscriptTurnInput[] | null
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
          : '';

    const primaryText = indicText || directText || enText;
    if (!primaryText) continue;

    const translatedText =
      typeof item.translatedText === 'string' && item.translatedText.trim()
        ? item.translatedText.trim()
        : indicText && enText && indicText !== enText
          ? enText
          : undefined;

    turns.push({
      speaker,
      text: primaryText,
      translatedText,
      intent: typeof item.intent === 'string' && item.intent.trim() ? item.intent.trim() : undefined,
    });
  }

  return turns;
}

/**
 * Interprets official Sarvam outbound webhook status + final_agent_variables.
 * Strict medical & privacy safety rules:
 * - Only terminal `connected`/`completed` calls may inspect patient intake variables.
 * - `no_answer`, `busy`, `rejected`, `cancelled`, and `failed` ALWAYS stay UNCONFIRMED.
 * - Meal confirmation (`meal_finished`) NEVER implies medicine intake.
 * - Medicine intake is marked `TAKEN` ONLY when explicit confirmation variables support it.
 * - Verbatim transcript turns are stored/exposed ONLY when recording/transcription consent is GRANTED.
 */
export function evaluateSarvamAgentOutcome(
  payload: SarvamOutboundWebhookPayload,
  patientName: string,
  medicineName: string,
  options: { recordingConsentGranted?: boolean } = {}
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
} {
  const recordingConsentGranted = options.recordingConsentGranted ?? true;
  const durationSeconds =
    typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration > 0
      ? Math.round(payload.duration)
      : 0;

  if (
    payload.status === 'queued' ||
    payload.status === 'initiating' ||
    payload.status === 'ringing' ||
    payload.status === 'in_progress'
  ) {
    const lifecycle = mapProviderRawStatusToLifecycle(payload.status);
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
    };
  }

  if (payload.status === 'no_answer') {
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
    };
  }

  if (payload.status === 'busy') {
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
    };
  }

  if (payload.status === 'rejected') {
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
    };
  }

  if (payload.status === 'cancelled' || payload.status === 'canceled') {
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
    };
  }

  if (payload.status === 'failed') {
    const reasonText = payload.failure_reason ? ` (${payload.failure_reason})` : '';
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
    };
  }

  // status === 'connected' | 'completed'
  const vars = payload.final_agent_variables ?? null;
  const turns = recordingConsentGranted
    ? mapSarvamTranscript(payload.interaction_transcript)
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

  if (!recordingConsentGranted) {
    safetyFlags.push('RECORDING_AND_TRANSCRIPT_WITHHELD_NO_CONSENT');
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
    recordingConsentGranted && vars && typeof vars.summary === 'string' && vars.summary.trim()
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
  };
}
