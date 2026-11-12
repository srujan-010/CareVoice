import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  MockCallScenario,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from '../adapters/voice/voiceProvider.interface';
import { withOptionalTransaction } from '../config/database';
import {
  env,
  getSarvamWebhookReadiness,
  isMockSimulationAllowed,
  isTelephonyReady,
} from '../config/env';
import {
  checkSarvamLanguageSupport,
  getLanguageMeta,
  tryGetSupportedLanguage,
} from '../constants/languages';
import {
  CallLifecycleStatus,
  CallOutcome,
  CallType,
  LanguageStatus,
  MedicineConfirmationValue,
  TERMINAL_CALL_LIFECYCLE_STATUSES,
} from '../constants/statuses';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { Callback } from '../models/Callback';
import { Conversation } from '../models/Conversation';
import { DoseInstance } from '../models/DoseInstance';
import { Escalation } from '../models/Escalation';
import { FamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { MedicineSchedule } from '../models/MedicineSchedule';
import { Recording } from '../models/Recording';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { normalizeAndValidateE164 } from '../utils/phone';
import { isWithinQuietHours } from '../utils/timezone';
import { recordAudit } from './audit.service';
import { requestSmartCallback, verifyCallbackBeforeCall } from './callback.service';
import { createEscalation } from './escalation.service';
import { dispatchFamilyAlert } from './notification.service';
import {
  SarvamOutboundWebhookPayload,
  classifySarvamSchedulerError,
  cleanSarvamSentinel,
  dispatchLiveVoiceCall,
  evaluateSarvamAgentOutcome,
  fetchSarvamAttemptById,
  fetchSarvamInteraction,
  fetchSarvamRecordingAudio,
  fetchSarvamTranscript,
  getVoiceAgentStatus,
  mapProviderRawStatusToLifecycle,
  mapSarvamAnalyticsTranscripts,
  parseSarvamUtcTimestamp,
  probeSarvamRecording,
  resolveSarvamLanguageCode,
  simulateMockVoiceCall,
  verifySarvamAgentDeployment,
} from './sarvamVoice.service';
import { MEDICAL_SAFETY_DIRECTIVES } from './voiceContext.service';
import { enqueueCallJob } from '../queues/queueManager';
import { logger } from '../utils/logger';

const ACTIVE_CALL_STATUSES: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'ANSWERED',
  'IN_PROGRESS',
];

const ACTIVE_STAGE_RANK: Record<string, number> = {
  QUEUED: 0,
  INITIATING: 1,
  RINGING: 2,
  ANSWERED: 3,
  IN_PROGRESS: 4,
};

export interface SimulateCallInput {
  familyId: string;
  actorUserId: string;
  doseInstanceId: string;
  callType?: CallType;
  scenario: MockCallScenario;
  delayMinutes?: number;
}

export interface RealTestCallInput {
  familyId: string;
  actorUserId: string;
  familyMemberId: string;
  doseInstanceId: string;
  callType?: CallType;
  purpose?: string;
  overrideQuietHours?: boolean;
  requestedLanguage?: string;
  fallbackLanguage?: string;
  allowLanguageFallback?: boolean;
  ipAddress?: string;
}

export interface ProcessCallEventInput {
  familyId?: string;
  callLogId: string;
  outcome: CallOutcome;
  durationSeconds?: number;
  mealConfirmed?: boolean | null;
  medicineConfirmed?: MedicineConfirmationValue;
  feelingUnwell?: boolean;
  requestedHelp?: boolean;
  turns?: Array<{
    speaker: 'AI' | 'PATIENT';
    text: string;
    translatedText?: string;
    intent?: string;
  }>;
  aiSummary?: string;
}

function isCallPermissionAllowedForType(
  callingPreferences: {
    allowMealReminders?: boolean;
    allowMedicineReminders?: boolean;
    allowConfirmationCalls?: boolean;
  } | undefined,
  callType: CallType
): boolean {
  if (!callingPreferences) return true;
  if (callType === 'MEAL_REMINDER') {
    return callingPreferences.allowMealReminders !== false;
  }
  if (callType === 'CONFIRMATION_CALL') {
    return callingPreferences.allowConfirmationCalls !== false;
  }
  if (callType === 'MEDICINE_REMINDER') {
    return callingPreferences.allowMedicineReminders !== false;
  }
  return true;
}

function mapOutcomeToLifecycleStatus(outcome: CallOutcome): CallLifecycleStatus {
  if (outcome === 'NO_ANSWER') return 'NO_ANSWER';
  if (outcome === 'BUSY') return 'BUSY';
  if (outcome === 'REJECTED') return 'REJECTED';
  if (outcome === 'NOT_CONNECTED') return 'NOT_CONNECTED';
  if (outcome === 'FAILED') return 'FAILED';
  if (outcome === 'CANCELLED') return 'CANCELLED';
  return 'COMPLETED';
}

function computeLanguageVerificationStatus(params: {
  requestedLanguage?: string;
  actualLanguageUsed?: string;
  existingStatus?: LanguageStatus;
  fallbackAuthorized?: boolean;
}): LanguageStatus {
  if (params.fallbackAuthorized || params.existingStatus === 'FALLBACK_AUTHORIZED') {
    return 'FALLBACK_AUTHORIZED';
  }
  if (!params.actualLanguageUsed) {
    return params.existingStatus || 'MATCHED';
  }
  const reqMeta = tryGetSupportedLanguage(params.requestedLanguage);
  const actMeta = tryGetSupportedLanguage(params.actualLanguageUsed);
  if (reqMeta && actMeta) {
    return reqMeta.code === actMeta.code ? 'MATCHED' : 'LANGUAGE_MISMATCH';
  }
  if (
    params.requestedLanguage &&
    params.actualLanguageUsed.trim().toLowerCase() === params.requestedLanguage.trim().toLowerCase()
  ) {
    return 'MATCHED';
  }
  return 'LANGUAGE_MISMATCH';
}

async function applyCallResultToEntities(params: {
  callLogId: Types.ObjectId;
  doseId: Types.ObjectId;
  familyId: Types.ObjectId;
  memberId: Types.ObjectId;
  medicineId: Types.ObjectId;
  medicineName: string;
  dosage: string;
  memberName: string;
  languageCode: string;
  recordingConsentGranted: boolean;
  transcriptConsentGranted?: boolean;
  result: VoiceCallExecutionResult;
  statusSource?: 'SYSTEM' | 'PROVIDER_API' | 'WEBHOOK' | 'RECONCILIATION' | 'ADMIN';
  callbackId?: Types.ObjectId;
  startedAtOverride?: Date;
  answeredAtOverride?: Date;
  endedAtOverride?: Date;
}) {
  const { result } = params;
  const audioRecordingConsent =
    result.audioRecordingConsentGranted ?? params.recordingConsentGranted;
  const transcriptConsent =
    params.transcriptConsentGranted ??
    result.transcriptConsentGranted ??
    params.recordingConsentGranted;

  let transitionedToTerminal = false;

  await withOptionalTransaction(async (session) => {
    const callLog = await CallLog.findById(params.callLogId, null, session ? { session } : undefined);
    if (!callLog) throw new NotFoundError('Call log');

    const now = new Date();
    const eventTime = params.endedAtOverride ?? now;
    const resolvedCallStatus: CallLifecycleStatus =
      result.callStatus ?? mapOutcomeToLifecycleStatus(result.outcome);
    const alreadyTerminal = TERMINAL_CALL_LIFECYCLE_STATUSES.includes(callLog.callStatus);
    const source = params.statusSource ?? (result.provider === 'sarvam' ? 'WEBHOOK' : 'SYSTEM');

    callLog.lastStatusUpdateAt = now;
    if (params.endedAtOverride) callLog.providerUpdatedAt = params.endedAtOverride;

    if (!alreadyTerminal) {
      transitionedToTerminal = true;
      callLog.callStatus = resolvedCallStatus;
      callLog.outcome = result.outcome;
      if (params.startedAtOverride && !callLog.startedAt) {
        callLog.startedAt = params.startedAtOverride;
      }
      if (params.answeredAtOverride && !callLog.answeredAt) {
        callLog.answeredAt = params.answeredAtOverride;
      } else if (
        resolvedCallStatus === 'COMPLETED' &&
        !callLog.answeredAt &&
        params.startedAtOverride
      ) {
        callLog.answeredAt = params.startedAtOverride;
      }
      callLog.endedAt = eventTime;
      callLog.durationSeconds = result.durationSeconds;
      callLog.mealConfirmed = result.mealConfirmed;
      callLog.medicineConfirmed = result.medicineConfirmed;
      callLog.aiSummary = result.aiSummary;
      if (result.failureReason !== undefined) {
        callLog.failureReason = cleanSarvamSentinel(result.failureReason) ?? undefined;
      }
      callLog.statusHistory.push({
        status: resolvedCallStatus,
        timestamp: now,
        source,
        note: cleanSarvamSentinel(result.failureReason) || result.aiSummary?.slice(0, 200),
      });
    }

    callLog.recordingConsentGranted = audioRecordingConsent;
    callLog.audioRecordingConsentGranted = audioRecordingConsent;
    callLog.transcriptConsentGranted = transcriptConsent;

    if (result.attemptId) callLog.attemptId = result.attemptId;
    if (result.interactionId) callLog.interactionId = result.interactionId;
    if (result.sarvamStatus) callLog.sarvamStatus = result.sarvamStatus;
    if (result.providerStatusRaw || result.sarvamStatus) {
      callLog.providerStatusRaw = result.providerStatusRaw || result.sarvamStatus;
    }
    if (result.channelInfo) callLog.channelInfo = result.channelInfo;
    if (result.finalAgentVariables !== undefined && transcriptConsent) {
      callLog.finalAgentVariables = result.finalAgentVariables;
    }

    if (result.actualLanguageUsed) {
      callLog.actualLanguageUsed = result.actualLanguageUsed;
      callLog.languageStatus = computeLanguageVerificationStatus({
        requestedLanguage: callLog.requestedLanguage || callLog.language,
        actualLanguageUsed: result.actualLanguageUsed,
        existingStatus: callLog.languageStatus,
      });
    }

    const safeTurns = transcriptConsent ? result.turns : [];
    const effectiveCallStatus = callLog.callStatus;
    if (!transcriptConsent) {
      callLog.transcriptAvailable = false;
      callLog.transcriptStatus = 'CONSENT_DENIED';
    } else if (safeTurns.length > 0) {
      callLog.transcriptAvailable = true;
      callLog.transcriptStatus = 'AVAILABLE';
      callLog.transcriptSource =
        result.transcriptSource ?? (result.provider === 'mock' ? 'MOCK' : 'WEBHOOK');
    } else if (!callLog.transcriptAvailable) {
      callLog.transcriptStatus =
        effectiveCallStatus === 'COMPLETED' && result.provider === 'sarvam'
          ? 'PENDING'
          : 'UNAVAILABLE';
    }

    const hasSarvamAudioRef = Boolean(
      result.provider === 'sarvam' &&
        (result.recordingUrl || result.interactionId) &&
        effectiveCallStatus === 'COMPLETED'
    );
    if (!audioRecordingConsent) {
      callLog.recordingStatus = 'CONSENT_DENIED';
      callLog.recordingNote = 'Audio recording access denied per patient CALL_RECORDING consent.';
    } else if (result.recordingWavBase64 || hasSarvamAudioRef) {
      callLog.recordingStatus = 'AVAILABLE';
    } else if (callLog.recordingStatus !== 'AVAILABLE') {
      callLog.recordingStatus = 'UNAVAILABLE';
    }

    await callLog.save(session ? { session } : undefined);

    if (safeTurns.length > 0 || result.aiSummary || (transcriptConsent && result.finalAgentVariables)) {
      await Conversation.findOneAndUpdate(
        { callLogId: callLog._id },
        {
          callLogId: callLog._id,
          familyId: params.familyId,
          familyMemberId: params.memberId,
          doseInstanceId: params.doseId,
          ...(result.interactionId ? { interactionId: result.interactionId } : {}),
          language: params.languageCode,
          ...(result.actualLanguageUsed ? { actualLanguageUsed: result.actualLanguageUsed } : {}),
          ...(callLog.transcriptSource ? { transcriptSource: callLog.transcriptSource } : {}),
          turns: safeTurns.map((t) => ({
            ...t,
            timestamp: t.timestamp ?? new Date(),
            language: t.language || result.actualLanguageUsed || params.languageCode,
          })),
          patientResponses: {
            mealFinished: result.mealConfirmed,
            delayMinutes: result.requestedCallbackDelayMinutes,
            medicineTaken:
              result.medicineConfirmed === 'TAKEN'
                ? true
                : result.medicineConfirmed === 'NOT_TAKEN'
                  ? false
                  : null,
            feelingUnwell: Boolean(result.feelingUnwell),
            requestedHelp: Boolean(result.requestedHelp),
          },
          ...(transcriptConsent && result.finalAgentVariables
            ? { finalAgentVariables: result.finalAgentVariables }
            : {}),
          aiSummary: result.aiSummary,
          safetyFlags: result.safetyFlags,
        },
        { upsert: true, new: true, session }
      );
    }

    if (audioRecordingConsent && result.recordingWavBase64) {
      await Recording.findOneAndUpdate(
        { callLogId: callLog._id },
        {
          callLogId: callLog._id,
          familyId: params.familyId,
          familyMemberId: params.memberId,
          provider: result.provider,
          storageKey: `mock-recording-${String(callLog._id)}.wav`,
          mimeType: 'audio/wav',
          durationSeconds: result.durationSeconds,
          consentVerified: true,
          audioDataBase64: result.recordingWavBase64,
        },
        { upsert: true, new: true, session }
      );
    } else if (audioRecordingConsent && hasSarvamAudioRef) {
      await Recording.findOneAndUpdate(
        { callLogId: callLog._id },
        {
          callLogId: callLog._id,
          familyId: params.familyId,
          familyMemberId: params.memberId,
          provider: 'sarvam',
          storageKey: result.interactionId
            ? `sarvam:${result.interactionId}`
            : `sarvam-attempt:${result.attemptId || String(callLog._id)}`,
          mimeType: 'audio/wav',
          durationSeconds: result.durationSeconds,
          consentVerified: true,
          ...(result.recordingUrl ? { externalUrl: result.recordingUrl } : {}),
        },
        { upsert: true, new: true, session }
      );
    }

    if (!alreadyTerminal) {
      const dose = await DoseInstance.findById(params.doseId, null, session ? { session } : undefined);
      if (dose) {
        // Meal update is strictly isolated from medicine taken confirmation!
        if (result.mealConfirmed === true) {
          dose.mealStatus = 'FINISHED';
        } else if (result.mealConfirmed === false) {
          dose.mealStatus = 'NOT_FINISHED';
        }

        // Never assume medicine taken from answered call or meal confirmation alone
        if (result.medicineConfirmed === 'TAKEN') {
          dose.status = 'PATIENT_REPORTED_TAKEN';
          dose.confirmedAt = new Date();
          dose.confirmedByCallId = callLog._id as Types.ObjectId;
        } else if (result.medicineConfirmed === 'NOT_TAKEN') {
          dose.status = 'PATIENT_REPORTED_NOT_TAKEN';
          dose.confirmedAt = new Date();
          dose.confirmedByCallId = callLog._id as Types.ObjectId;
        } else if (
          dose.status === 'PENDING' &&
          result.outcome !== 'CALLBACK_REQUESTED'
        ) {
          dose.status = 'UNCONFIRMED';
        }
        await dose.save(session ? { session } : undefined);
      }

      if (params.callbackId) {
        await Callback.findByIdAndUpdate(
          params.callbackId,
          {
            status:
              result.outcome === 'COMPLETED' || result.outcome === 'ANSWERED'
                ? 'COMPLETED'
                : result.outcome === 'NO_ANSWER' ||
                    result.outcome === 'BUSY' ||
                    result.outcome === 'FAILED' ||
                    result.outcome === 'REJECTED' ||
                    result.outcome === 'NOT_CONNECTED' ||
                    result.outcome === 'CANCELLED'
                  ? 'FAILED'
                  : 'COMPLETED',
            resultingCallLogId: callLog._id,
          },
          session ? { session } : undefined
        );
      }
    }
  });

  if (!transitionedToTerminal) {
    return;
  }

  // Trigger escalations & notifications outside or after primary persistence
  if (result.feelingUnwell || result.requestedHelp || result.outcome === 'ESCALATED') {
    await createEscalation({
      familyId: params.familyId,
      familyMemberId: params.memberId,
      doseInstanceId: params.doseId,
      callLogId: params.callLogId,
      reason: result.feelingUnwell ? 'PATIENT_FEELING_UNWELL' : 'PATIENT_REQUESTED_HELP',
      severity: result.feelingUnwell ? 'CRITICAL' : 'HIGH',
      description: `${params.memberName} reported feeling unwell or asked for caregiver help during ${params.medicineName} (${params.dosage}) call.`,
    });
  } else if (result.medicineConfirmed === 'NOT_TAKEN') {
    await createEscalation({
      familyId: params.familyId,
      familyMemberId: params.memberId,
      doseInstanceId: params.doseId,
      callLogId: params.callLogId,
      reason: 'PATIENT_FORGOT',
      severity: 'MEDIUM',
      description: `${params.memberName} reported not taking ${params.medicineName} (${params.dosage}).`,
    });
  } else if (
    result.outcome === 'NO_ANSWER' ||
    result.outcome === 'BUSY' ||
    result.outcome === 'REJECTED' ||
    result.outcome === 'NOT_CONNECTED' ||
    result.outcome === 'FAILED'
  ) {
    const missedCount = await CallLog.countDocuments({
      doseInstanceId: params.doseId,
      outcome: { $in: ['NO_ANSWER', 'BUSY', 'REJECTED', 'NOT_CONNECTED', 'FAILED'] },
    });
    if (missedCount >= 2) {
      await createEscalation({
        familyId: params.familyId,
        familyMemberId: params.memberId,
        doseInstanceId: params.doseId,
        callLogId: params.callLogId,
        reason: 'REPEATED_NO_ANSWER',
        severity: 'HIGH',
        description: `${params.memberName} did not answer ${missedCount} reminder call attempts for ${params.medicineName} (${params.dosage}).`,
      });
    } else {
      await dispatchFamilyAlert({
        familyId: params.familyId,
        familyMemberId: params.memberId,
        doseInstanceId: params.doseId,
        callLogId: params.callLogId,
        triggerType: 'UNCONFIRMED_MEDICINE',
        title: `${params.memberName} missed a reminder call`,
        message: `Call attempt ended with ${result.outcome} for ${params.medicineName} (${params.dosage}).`,
      });
    }
  }

  // Schedule smart callback if patient confirmed delay during call (ignore duplicate if agent already booked mid-call)
  if (
    result.outcome === 'CALLBACK_REQUESTED' &&
    result.requestedCallbackDelayMinutes
  ) {
    try {
      await requestSmartCallback({
        familyId: String(params.familyId),
        familyMemberId: String(params.memberId),
        doseInstanceId: String(params.doseId),
        sourceCallLogId: String(params.callLogId),
        delayMinutes: result.requestedCallbackDelayMinutes,
        reason: 'Patient requested meal-delay callback during AI call',
        patientConfirmed: true,
        actorType: 'VOICE_AGENT',
        actorId: String(params.memberId),
      });
    } catch (err) {
      if (!(err instanceof ConflictError)) {
        throw err;
      }
    }
  }
}

export async function getCallPreflight(options: { verifyDeployment?: boolean } = {}) {
  const baseStatus = getVoiceAgentStatus();
  let deploymentCheck: Awaited<ReturnType<typeof verifySarvamAgentDeployment>> | null = null;

  if (options.verifyDeployment) {
    deploymentCheck = await verifySarvamAgentDeployment();
  }

  return {
    ...baseStatus,
    liveCallingAllowed:
      baseStatus.telephonyReady &&
      baseStatus.webhookReady &&
      (!deploymentCheck || deploymentCheck.verified),
    deploymentCheck,
  };
}

export async function simulateCallForDose(input: SimulateCallInput) {
  if (!isMockSimulationAllowed()) {
    throw new ForbiddenError(
      'Mock voice call simulation is disabled in production. Use real telephony or enable ALLOW_DEV_DEMO_MODE in staging.'
    );
  }

  const dose = await DoseInstance.findOne({
    _id: new Types.ObjectId(input.doseInstanceId),
    familyId: new Types.ObjectId(input.familyId),
  });
  if (!dose) throw new NotFoundError('Dose instance');

  const [member, medicine] = await Promise.all([
    FamilyMember.findOne({ _id: dose.familyMemberId, familyId: dose.familyId }),
    Medicine.findOne({ _id: dose.medicineId, familyId: dose.familyId }),
  ]);

  if (!member) throw new NotFoundError('Family member');
  if (!medicine) throw new NotFoundError('Medicine');

  if (member.voiceCallingConsentStatus !== 'GRANTED') {
    throw new ForbiddenError('Voice calling consent is not granted for this family member');
  }

  const langMeta = getLanguageMeta(member.preferredLanguage);
  const callType: CallType = input.callType ?? 'MEDICINE_REMINDER';
  const now = new Date();
  const recordingConsentGranted = member.recordingConsentStatus === 'GRANTED';
  const transcriptConsentGranted = (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';

  const callLog = await CallLog.create({
    familyId: dose.familyId,
    familyMemberId: member._id,
    medicineId: medicine._id,
    doseInstanceId: dose._id,
    initiatedByUserId: Types.ObjectId.isValid(input.actorUserId)
      ? new Types.ObjectId(input.actorUserId)
      : undefined,
    provider: 'mock',
    providerCallId: `mock-pending-${crypto.randomUUID().slice(0, 8)}`,
    mode: 'mock',
    isMock: true,
    isTestCall: false,
    callPurpose: `Simulated mock call (${input.scenario})`,
    callStatus: 'INITIATING',
    statusHistory: [
      {
        status: 'QUEUED',
        timestamp: now,
        source: 'SYSTEM',
        note: 'Mock sandbox simulation queued',
      },
      {
        status: 'INITIATING',
        timestamp: now,
        source: 'SYSTEM',
        note: 'Generating simulated mock dialogue (no real phone dialed)',
      },
    ],
    recordingConsentGranted,
    audioRecordingConsentGranted: recordingConsentGranted,
    transcriptConsentGranted,
    lastStatusUpdateAt: now,
    queuedAt: now,
    initiatingAt: now,
    callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    requestedLanguage: langMeta.code,
    actualLanguageUsed: langMeta.code,
    languageStatus: 'MATCHED',
    scheduledAt: dose.scheduledAt,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
    transcriptStatus: transcriptConsentGranted ? 'PENDING' : 'CONSENT_DENIED',
    transcriptAvailable: false,
    mealConfirmed: null,
    medicineConfirmed: 'UNCONFIRMED',
  });

  const context: VoiceCallContextPayload = {
    callLogId: String(callLog._id),
    familyId: String(dose.familyId),
    familyMemberId: String(member._id),
    patientName: member.fullName,
    phoneNumber: member.phoneNumber,
    languageCode: langMeta.code,
    languageBcp47: langMeta.bcp47,
    languageName: langMeta.name,
    voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
    recordingConsentGranted,
    transcriptConsentGranted,
    medicineId: String(medicine._id),
    medicineName: medicine.name,
    dosage: medicine.dosage,
    foodInstruction: dose.foodInstruction,
    associatedMeal: dose.associatedMeal,
    slotLabel: dose.slotLabel,
    prescribedInstructions: medicine.prescribedInstructions,
    doseInstanceId: String(dose._id),
    callType,
    isTestCall: false,
    callPurpose: `Mock sandbox (${input.scenario})`,
    scheduledAtIso: dose.scheduledAt.toISOString(),
    safetyDirectives: MEDICAL_SAFETY_DIRECTIVES,
  };

  const simResult = await simulateMockVoiceCall(context, input.scenario, {
    delayMinutes: input.delayMinutes,
  });
  callLog.providerCallId = simResult.providerCallId;
  await callLog.save();

  await applyCallResultToEntities({
    callLogId: callLog._id as Types.ObjectId,
    doseId: dose._id as Types.ObjectId,
    familyId: dose.familyId,
    memberId: member._id as Types.ObjectId,
    medicineId: medicine._id as Types.ObjectId,
    medicineName: medicine.name,
    dosage: medicine.dosage,
    memberName: member.fullName,
    languageCode: langMeta.code,
    recordingConsentGranted,
    transcriptConsentGranted,
    result: {
      ...simResult,
      actualLanguageUsed: langMeta.code,
      transcriptSource: 'MOCK',
    },
  });

  await recordAudit({
    familyId: input.familyId,
    actorType: 'USER',
    actorId: input.actorUserId,
    action: 'MOCK_VOICE_CALL_SIMULATED',
    resourceType: 'CallLog',
    resourceId: String(callLog._id),
    metadata: { scenario: input.scenario, language: langMeta.code, isMock: true },
  });

  return getCallDetail(input.familyId, String(callLog._id));
}

/**
 * Initiates a genuine Sarvam Vobiz outbound phone call from an authorized ADMIN.
 * Never fabricates success: fails cleanly when credentials, consent, phone format,
 * deployment readiness, duplicate guards, or Sarvam upstream API reject the call.
 */
export async function initiateRealTestCall(input: RealTestCallInput) {
  if (!Types.ObjectId.isValid(input.familyMemberId) || !Types.ObjectId.isValid(input.doseInstanceId)) {
    throw new ValidationError('Invalid familyMemberId or doseInstanceId');
  }

  const callType: CallType = input.callType ?? 'MEDICINE_REMINDER';

  const [member, dose] = await Promise.all([
    FamilyMember.findOne({
      _id: new Types.ObjectId(input.familyMemberId),
      familyId: new Types.ObjectId(input.familyId),
    }),
    DoseInstance.findOne({
      _id: new Types.ObjectId(input.doseInstanceId),
      familyId: new Types.ObjectId(input.familyId),
      familyMemberId: new Types.ObjectId(input.familyMemberId),
    }),
  ]);

  if (!member) throw new NotFoundError('Family member');
  if (!dose) {
    throw new NotFoundError('Dose instance for the selected family member');
  }

  if (!member.isActive) {
    throw new ForbiddenError(`Family member ${member.fullName} is currently inactive`);
  }

  const [medicine, schedule] = await Promise.all([
    Medicine.findOne({
      _id: dose.medicineId,
      familyId: dose.familyId,
    }).lean(),
    MedicineSchedule.findOne({
      _id: dose.medicineScheduleId,
      familyId: dose.familyId,
    }).lean(),
  ]);

  if (!medicine || !medicine.isActive) {
    throw new ForbiddenError('Associated medicine record is missing or inactive');
  }
  if (!schedule || !schedule.isActive) {
    throw new ForbiddenError('Associated medicine schedule is missing or inactive');
  }
  if (medicine.endDate && medicine.endDate < new Date()) {
    throw new ForbiddenError('Associated medicine course has already ended');
  }

  // Strict E.164 validation
  const validatedPhone = normalizeAndValidateE164(
    member.phoneNumber,
    'Family member phone number'
  );

  // Explicit automated calling consent check (strictly separate from recording consent)
  if (member.voiceCallingConsentStatus !== 'GRANTED') {
    throw new ForbiddenError(
      `Automated calling blocked: ${member.fullName}'s voice calling consent is ${member.voiceCallingConsentStatus}. Grant VOICE_CALLING consent before dialing.`
    );
  }

  // Check patient calling permissions for the requested purpose
  if (!isCallPermissionAllowedForType(member.callingPreferences, callType)) {
    throw new ForbiddenError(
      `Patient calling preferences disable ${callType.replace(/_/g, ' ').toLowerCase()} calls for ${member.fullName}.`
    );
  }

  const now = new Date();
  if (
    callType !== 'CALLBACK' &&
    !input.overrideQuietHours &&
    isWithinQuietHours(
      now,
      member.timezone,
      member.callingPreferences?.quietHoursStart ?? '22:00',
      member.callingPreferences?.quietHoursEnd ?? '06:30'
    )
  ) {
    throw new AppError(
      `Call blocked because ${member.fullName} is currently inside quiet hours (${member.callingPreferences?.quietHoursStart ?? '22:00'}–${member.callingPreferences?.quietHoursEnd ?? '06:30'} ${member.timezone}).`,
      403,
      'QUIET_HOURS_ACTIVE'
    );
  }

  // Never dial again if patient already confirmed taking this dose
  if (dose.status === 'PATIENT_REPORTED_TAKEN') {
    throw new ConflictError(
      `Dose ${dose.slotLabel} is already confirmed PATIENT_REPORTED_TAKEN.`
    );
  }

  // Duplicate prevention: refuse concurrent or already in-flight live call for same dose + callType
  const existingActiveCall = await CallLog.findOne({
    familyId: dose.familyId,
    familyMemberId: member._id,
    doseInstanceId: dose._id,
    callType,
    mode: 'live',
    isMock: false,
    callStatus: { $in: ACTIVE_CALL_STATUSES },
  }).lean();

  if (existingActiveCall) {
    throw new ConflictError(
      `Duplicate call prevented: a live outbound call (${existingActiveCall.callStatus}) is already active for this dose and reminder type.`
    );
  }

  // Verify backend Sarvam configuration & HTTPS webhook readiness
  const telephony = isTelephonyReady();
  const webhook = getSarvamWebhookReadiness();
  if (!telephony.ready || !webhook.ready) {
    const missing = [...telephony.missingFields, ...webhook.missingFields];
    throw new AppError(
      `Live Sarvam telephony is not ready: missing ${missing.join(', ')}`,
      503,
      'TELEPHONY_NOT_READY',
      {
        missingTelephonyFields: telephony.missingFields,
        missingWebhookFields: webhook.missingFields,
      }
    );
  }

  // Verify Sarvam agent deployment & phone connection via official Sarvam API
  const deploymentCheck = await verifySarvamAgentDeployment();
  if (!deploymentCheck.verified) {
    throw new AppError(
      deploymentCheck.message,
      deploymentCheck.upstreamStatus ? 502 : 503,
      'SARVAM_DEPLOYMENT_NOT_READY',
      { deploymentCheck }
    );
  }

  const requestedCode = input.requestedLanguage?.trim() || member.preferredLanguage;
  const primaryLangCheck = checkSarvamLanguageSupport(
    requestedCode,
    env.SARVAM_ALLOWED_LANGUAGES
  );
  let effectiveLangMeta = primaryLangCheck.language ?? getLanguageMeta(requestedCode);
  let languageStatus: LanguageStatus = 'MATCHED';
  let fallbackLanguageUsed: string | undefined;

  if (!primaryLangCheck.supported || !primaryLangCheck.language) {
    if (input.allowLanguageFallback && input.fallbackLanguage) {
      const fbCheck = checkSarvamLanguageSupport(
        input.fallbackLanguage,
        env.SARVAM_ALLOWED_LANGUAGES
      );
      if (!fbCheck.supported || !fbCheck.language) {
        throw new AppError(
          fbCheck.reason || `Fallback language "${input.fallbackLanguage}" is not supported`,
          422,
          'LANGUAGE_FALLBACK_REQUIRED',
          {
            requestedLanguage: requestedCode,
            availableFallbackLanguages: fbCheck.availableFallbackLanguages,
            requiresFallbackPermission: true,
          }
        );
      }
      effectiveLangMeta = fbCheck.language;
      fallbackLanguageUsed = fbCheck.language.code;
      languageStatus = 'FALLBACK_AUTHORIZED';
    } else {
      const blockedReason =
        primaryLangCheck.reason ||
        `Preferred language "${requestedCode}" is unavailable on Sarvam; explicit fallback permission is required before calling.`;
      const blockedLog = await CallLog.create({
        familyId: dose.familyId,
        familyMemberId: member._id,
        medicineId: medicine._id,
        doseInstanceId: dose._id,
        initiatedByUserId: new Types.ObjectId(input.actorUserId),
        provider: 'sarvam',
        mode: 'live',
        isMock: false,
        isTestCall: true,
        callPurpose:
          input.purpose?.trim() ||
          `Language fallback check for ${medicine.name} (${medicine.dosage})`,
        callStatus: 'LANGUAGE_FALLBACK_REQUIRED',
        outcome: 'FAILED',
        failureReason: blockedReason,
        lastStatusUpdateAt: now,
        statusHistory: [
          {
            status: 'LANGUAGE_FALLBACK_REQUIRED',
            timestamp: now,
            source: 'SYSTEM',
            note: blockedReason,
          },
        ],
        recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
        audioRecordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
        transcriptConsentGranted: (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED',
        callType,
        phoneNumber: validatedPhone,
        language: requestedCode,
        requestedLanguage: requestedCode,
        languageStatus: 'LANGUAGE_FALLBACK_REQUIRED',
        scheduledAt: dose.scheduledAt,
        startedAt: now,
        endedAt: now,
        durationSeconds: 0,
        recordingStatus:
          member.recordingConsentStatus === 'GRANTED' ? 'UNAVAILABLE' : 'CONSENT_DENIED',
        transcriptStatus:
          (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED'
            ? 'UNAVAILABLE'
            : 'CONSENT_DENIED',
        transcriptAvailable: false,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        aiSummary: blockedReason,
      });

      await recordAudit({
        familyId: input.familyId,
        actorType: 'USER',
        actorId: input.actorUserId,
        action: 'REAL_TEST_CALL_LANGUAGE_FALLBACK_REQUIRED',
        resourceType: 'CallLog',
        resourceId: String(blockedLog._id),
        ipAddress: input.ipAddress,
        metadata: { requestedLanguage: requestedCode },
      });

      throw new AppError(blockedReason, 422, 'LANGUAGE_FALLBACK_REQUIRED', {
        callLogId: String(blockedLog._id),
        requestedLanguage: requestedCode,
        availableFallbackLanguages: primaryLangCheck.availableFallbackLanguages,
        requiresFallbackPermission: true,
      });
    }
  }

  const recordingConsentGranted = member.recordingConsentStatus === 'GRANTED';
  const transcriptConsentGranted = (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';
  const callPurpose =
    input.purpose?.trim() ||
    `Admin-authorized real test call (${callType.replace(/_/g, ' ')}) for ${medicine.name} (${medicine.dosage})`;

  // Re-check right after deployment HTTP call to minimize concurrent initiation races
  const racingActiveCall = await CallLog.findOne({
    familyId: dose.familyId,
    familyMemberId: member._id,
    doseInstanceId: dose._id,
    callType,
    mode: 'live',
    isMock: false,
    callStatus: { $in: ACTIVE_CALL_STATUSES },
  }).lean();

  if (racingActiveCall) {
    throw new ConflictError(
      `Duplicate call prevented: a live outbound call (${racingActiveCall.callStatus}) is already active for this dose and reminder type.`
    );
  }

  const callLog = await CallLog.create({
    familyId: dose.familyId,
    familyMemberId: member._id,
    medicineId: medicine._id,
    doseInstanceId: dose._id,
    initiatedByUserId: new Types.ObjectId(input.actorUserId),
    provider: 'sarvam',
    mode: 'live',
    isMock: false,
    isTestCall: true,
    callPurpose,
    callStatus: 'INITIATING',
    statusHistory: [
      {
        status: 'QUEUED',
        timestamp: now,
        source: 'ADMIN',
        note: 'Admin authorized real Sarvam outbound test call',
      },
      {
        status: 'INITIATING',
        timestamp: now,
        source: 'SYSTEM',
        note: `Safety, consent, E.164, language (${effectiveLangMeta.name}), and deployment checks passed; calling Sarvam Outbound API`,
      },
    ],
    recordingConsentGranted,
    audioRecordingConsentGranted: recordingConsentGranted,
    transcriptConsentGranted,
    lastStatusUpdateAt: now,
    queuedAt: now,
    initiatingAt: now,
    callType,
    phoneNumber: validatedPhone,
    language: effectiveLangMeta.code,
    requestedLanguage: requestedCode,
    fallbackLanguage: fallbackLanguageUsed,
    fallbackAuthorizedByUserId: fallbackLanguageUsed
      ? new Types.ObjectId(input.actorUserId)
      : undefined,
    languageStatus,
    scheduledAt: dose.scheduledAt,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
    transcriptStatus: transcriptConsentGranted ? 'PENDING' : 'CONSENT_DENIED',
    transcriptAvailable: false,
    mealConfirmed: null,
    medicineConfirmed: 'UNCONFIRMED',
    contextSnapshot: {
      patientName: member.fullName,
      requestedLanguage: requestedCode,
      effectiveLanguage: effectiveLangMeta.code,
      languageBcp47: effectiveLangMeta.bcp47,
      languageName: effectiveLangMeta.sarvamInitialLanguageName || effectiveLangMeta.name,
      medicineName: medicine.name,
      dosage: medicine.dosage,
      slotLabel: dose.slotLabel,
      associatedMeal: dose.associatedMeal,
      foodInstruction: dose.foodInstruction,
      prescribedInstructions: medicine.prescribedInstructions,
      recordingConsentStatus: member.recordingConsentStatus,
      transcriptConsentStatus: member.transcriptConsentStatus ?? 'PENDING',
      voiceCallingConsentStatus: member.voiceCallingConsentStatus,
      deploymentStatus: deploymentCheck.status,
    },
    aiSummary: `Initiating live Sarvam outbound call in ${effectiveLangMeta.name} to ${member.fullName}...`,
  });

  const context: VoiceCallContextPayload = {
    callLogId: String(callLog._id),
    familyId: String(dose.familyId),
    familyMemberId: String(member._id),
    patientName: member.fullName,
    phoneNumber: validatedPhone,
    languageCode: effectiveLangMeta.code,
    languageBcp47: effectiveLangMeta.bcp47,
    languageName: effectiveLangMeta.sarvamInitialLanguageName || effectiveLangMeta.name,
    voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
    recordingConsentGranted,
    transcriptConsentGranted,
    medicineId: String(medicine._id),
    medicineName: medicine.name,
    dosage: medicine.dosage,
    doseNumber: typeof dose.slotIndex === 'number' ? dose.slotIndex + 1 : 1,
    foodInstruction: dose.foodInstruction,
    associatedMeal: dose.associatedMeal,
    slotLabel: dose.slotLabel,
    prescribedInstructions: medicine.prescribedInstructions,
    doseInstanceId: String(dose._id),
    callType,
    callPurpose,
    isTestCall: true,
    scheduledAtIso: dose.scheduledAt.toISOString(),
    safetyDirectives: MEDICAL_SAFETY_DIRECTIVES,
  };

  try {
    const liveRes = await dispatchLiveVoiceCall(context);
    const providerLifecycle = mapProviderRawStatusToLifecycle(liveRes.rawStatus);
    const safeLifecycle: CallLifecycleStatus =
      providerLifecycle === 'COMPLETED' ? 'INITIATING' : providerLifecycle;
    const acceptedAt = new Date();

    callLog.attemptId = liveRes.attemptId;
    callLog.providerCallId = liveRes.providerCallId;
    callLog.callStatus = safeLifecycle;
    callLog.sarvamStatus = liveRes.rawStatus.trim().toLowerCase();
    callLog.providerStatusRaw = liveRes.rawStatus;
    callLog.lastStatusUpdateAt = acceptedAt;
    if (safeLifecycle === 'RINGING') callLog.ringingAt = acceptedAt;
    if (safeLifecycle === 'ANSWERED' || safeLifecycle === 'IN_PROGRESS') {
      callLog.answeredAt = acceptedAt;
    }
    callLog.providerResponseMeta = {
      accepted: liveRes.accepted,
      attemptId: liveRes.attemptId,
      rawStatus: liveRes.rawStatus,
      httpStatus: liveRes.httpStatus,
      deploymentStatus: deploymentCheck.status,
      requestedLanguage: requestedCode,
      effectiveLanguage: effectiveLangMeta.code,
    };
    callLog.statusHistory.push({
      status: safeLifecycle,
      timestamp: acceptedAt,
      source: 'PROVIDER_API',
      note: `Sarvam accepted outbound call (attempt_id: ${liveRes.attemptId}, status: ${liveRes.rawStatus}, language: ${effectiveLangMeta.name})`,
    });
    callLog.aiSummary = `Sarvam outbound call accepted (attempt_id: ${liveRes.attemptId}). Dialing ${member.fullName} in ${effectiveLangMeta.name}; awaiting live webhook/reconciliation status. Dose remains ${dose.status}.`;
    await callLog.save();

    await recordAudit({
      familyId: input.familyId,
      actorType: 'USER',
      actorId: input.actorUserId,
      action: 'REAL_TEST_CALL_INITIATED',
      resourceType: 'CallLog',
      resourceId: String(callLog._id),
      ipAddress: input.ipAddress,
      metadata: {
        attemptId: liveRes.attemptId,
        rawStatus: liveRes.rawStatus,
        callType,
        requestedLanguage: requestedCode,
        effectiveLanguage: effectiveLangMeta.code,
        recordingConsentGranted,
        transcriptConsentGranted,
        isTestCall: true,
      },
    });

    const detail = await getCallDetail(input.familyId, String(callLog._id));
    return {
      ...detail,
      providerResponse: {
        accepted: liveRes.accepted,
        attemptId: liveRes.attemptId,
        rawStatus: liveRes.rawStatus,
        httpStatus: liveRes.httpStatus,
      },
      deploymentCheck,
    };
  } catch (err) {
    const classified = classifySarvamSchedulerError(err);
    const msg = classified.detail;
    const failedAt = new Date();
    const isLangFallbackRequired =
      (err instanceof AppError && err.code === 'LANGUAGE_FALLBACK_REQUIRED') ||
      classified.category === 'LANGUAGE_UNAVAILABLE';

    callLog.callStatus = isLangFallbackRequired ? 'LANGUAGE_FALLBACK_REQUIRED' : 'FAILED';
    callLog.outcome = 'FAILED';
    callLog.sarvamStatus = isLangFallbackRequired ? 'language_unavailable' : 'failed';
    callLog.providerStatusRaw = isLangFallbackRequired
      ? 'LANGUAGE_UNAVAILABLE'
      : classified.category;
    callLog.errorCategory = classified.category;
    if (isLangFallbackRequired) {
      callLog.languageStatus = 'LANGUAGE_UNAVAILABLE';
    }
    callLog.endedAt = failedAt;
    callLog.lastStatusUpdateAt = failedAt;
    callLog.failureReason = msg.slice(0, 1000);
    callLog.providerResponseMeta = {
      error: msg.slice(0, 500),
      code: err instanceof AppError ? err.code : 'SARVAM_PROVIDER_ERROR',
      errorCategory: classified.category,
      nonRetryable: classified.nonRetryable,
      details: err instanceof AppError ? err.details : undefined,
    };
    callLog.statusHistory.push({
      status: callLog.callStatus,
      timestamp: failedAt,
      source: 'PROVIDER_API',
      note: msg.slice(0, 400),
    });
    callLog.aiSummary = isLangFallbackRequired
      ? `Language "${effectiveLangMeta.name}" rejected by Sarvam: ${msg}`
      : `Live Sarvam outbound call failed before connecting: ${msg}`;
    await callLog.save();

    await recordAudit({
      familyId: input.familyId,
      actorType: 'USER',
      actorId: input.actorUserId,
      action: isLangFallbackRequired
        ? 'REAL_TEST_CALL_LANGUAGE_FALLBACK_REQUIRED'
        : 'REAL_TEST_CALL_FAILED',
      resourceType: 'CallLog',
      resourceId: String(callLog._id),
      ipAddress: input.ipAddress,
      metadata: {
        error: msg.slice(0, 300),
        callType,
        requestedLanguage: requestedCode,
      },
    });

    if (err instanceof AppError) {
      throw new AppError(err.message, err.statusCode, err.code, {
        ...(typeof err.details === 'object' && err.details !== null ? err.details : {}),
        callLogId: String(callLog._id),
      });
    }
    throw err;
  }
}

export async function recordExternalCallEvent(input: ProcessCallEventInput) {
  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(input.callLogId),
    ...(input.familyId ? { familyId: new Types.ObjectId(input.familyId) } : {}),
  });
  if (!callLog) throw new NotFoundError('Call log');

  if (!callLog.doseInstanceId || !callLog.medicineId) {
    throw new ValidationError('Call log is not bound to a dose instance and medicine');
  }

  const [member, medicine] = await Promise.all([
    FamilyMember.findById(callLog.familyMemberId).lean(),
    Medicine.findById(callLog.medicineId).lean(),
  ]);
  if (!member || !medicine) throw new NotFoundError('Patient or medicine');

  const recordingConsentGranted = member.recordingConsentStatus === 'GRANTED';
  const transcriptConsentGranted = (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';

  const execResult: VoiceCallExecutionResult = {
    provider: callLog.provider,
    mode: callLog.mode,
    callStatus: mapOutcomeToLifecycleStatus(input.outcome),
    providerCallId: callLog.providerCallId || String(callLog._id),
    outcome: input.outcome,
    durationSeconds: input.durationSeconds ?? 0,
    mealConfirmed: input.mealConfirmed ?? null,
    medicineConfirmed: input.medicineConfirmed ?? 'UNCONFIRMED',
    feelingUnwell: input.feelingUnwell,
    requestedHelp: input.requestedHelp,
    audioRecordingConsentGranted: recordingConsentGranted,
    transcriptConsentGranted,
    turns: transcriptConsentGranted ? input.turns ?? [] : [],
    aiSummary:
      input.aiSummary ||
      `Call ${input.outcome} for ${member.fullName} regarding ${medicine.name}.`,
    safetyFlags:
      input.medicineConfirmed === 'TAKEN'
        ? ['EXPLICIT_DOSE_CONFIRMATION']
        : ['NO_ASSUMED_TAKE'],
  };

  await applyCallResultToEntities({
    callLogId: callLog._id as Types.ObjectId,
    doseId: callLog.doseInstanceId,
    familyId: callLog.familyId,
    memberId: callLog.familyMemberId,
    medicineId: callLog.medicineId,
    medicineName: medicine.name,
    dosage: medicine.dosage,
    memberName: member.fullName,
    languageCode: callLog.language,
    recordingConsentGranted,
    transcriptConsentGranted,
    result: execResult,
    callbackId: callLog.callbackId,
  });

  return getCallDetail(String(callLog.familyId), String(callLog._id));
}

/**
 * Processes an official Sarvam Voice Agents Instant Outbound Webhook event:
 * - Correlates attempt_id with CallLog and verifies patient_id + dose_id metadata
 * - Supports intermediate lifecycle transitions (queued/initiating/ringing/in_progress) AND terminal outcomes
 * - Guarantees atomic idempotency across retries using processedWebhookIds
 * - Persists interaction_transcript and recording references ONLY when recording consent is GRANTED
 * - Maps connected/completed/no_answer/busy/rejected/cancelled/failed without ever assuming unconfirmed intake
 */
export async function processSarvamOutboundWebhook(
  payload: SarvamOutboundWebhookPayload,
  auditMeta?: { ipAddress?: string }
) {
  const attemptId = payload.attempt_id?.trim();
  if (!attemptId) {
    throw new ValidationError('Sarvam webhook payload requires attempt_id');
  }

  const webhookMetadata = payload.webhook_config?.metadata ?? {};
  const metaCallLogId =
    typeof webhookMetadata.call_log_id === 'string'
      ? webhookMetadata.call_log_id
      : typeof webhookMetadata.callLogId === 'string'
        ? webhookMetadata.callLogId
        : undefined;
  const metaPatientId =
    typeof webhookMetadata.patient_id === 'string'
      ? webhookMetadata.patient_id
      : typeof webhookMetadata.familyMemberId === 'string'
        ? webhookMetadata.familyMemberId
        : undefined;
  const metaDoseId =
    typeof webhookMetadata.dose_id === 'string'
      ? webhookMetadata.dose_id
      : typeof webhookMetadata.doseInstanceId === 'string'
        ? webhookMetadata.doseInstanceId
        : undefined;

  let callLog = await CallLog.findOne({
    $or: [{ attemptId }, { providerCallId: attemptId }],
  });

  if (!callLog && metaCallLogId && Types.ObjectId.isValid(metaCallLogId)) {
    callLog = await CallLog.findById(metaCallLogId);
  }

  if (!callLog) {
    throw new NotFoundError('Associated call log for Sarvam attempt_id');
  }

  if (metaCallLogId && String(callLog._id) !== metaCallLogId) {
    throw new ForbiddenError('Webhook call_log_id metadata does not match attempt_id record');
  }
  if (metaPatientId && String(callLog.familyMemberId) !== metaPatientId) {
    throw new ForbiddenError('Webhook patient_id metadata does not match CallLog patient');
  }
  if (metaDoseId && String(callLog.doseInstanceId) !== metaDoseId) {
    throw new ForbiddenError('Webhook dose_id metadata does not match CallLog dose');
  }
  if (!callLog.doseInstanceId || !callLog.medicineId) {
    throw new ValidationError('Correlated CallLog is missing doseInstanceId or medicineId');
  }

  const [member, medicine, dose] = await Promise.all([
    FamilyMember.findOne({ _id: callLog.familyMemberId, familyId: callLog.familyId }).lean(),
    Medicine.findOne({ _id: callLog.medicineId, familyId: callLog.familyId }).lean(),
    DoseInstance.findOne({
      _id: callLog.doseInstanceId,
      familyId: callLog.familyId,
      familyMemberId: callLog.familyMemberId,
    }).lean(),
  ]);

  if (!member || !medicine || !dose) {
    throw new NotFoundError('Correlated patient, medicine, or dose instance');
  }

  const rawStatus = (payload.status || payload.connectivity_status || '')
    .toString()
    .trim()
    .toLowerCase();
  const eventSuffix =
    typeof payload.event_id === 'string' && payload.event_id.trim()
      ? payload.event_id.trim()
      : payload.interaction_id || 'none';
  const idempotencyKey = `sarvam:${attemptId}:${rawStatus}:${eventSuffix}`;

  const claimed = await CallLog.findOneAndUpdate(
    {
      _id: callLog._id,
      processedWebhookIds: { $ne: idempotencyKey },
    },
    {
      $addToSet: { processedWebhookIds: idempotencyKey },
      $set: { lastWebhookAt: new Date() },
    },
    { new: true }
  );

  if (!claimed) {
    const existingDetail = await getCallDetail(String(callLog.familyId), String(callLog._id));
    return {
      idempotent: true,
      correlated: {
        attemptId,
        callLogId: String(callLog._id),
        patientId: String(member._id),
        doseId: String(dose._id),
      },
      detail: existingDetail,
    };
  }

  try {
    const recordingConsentGranted =
      callLog.audioRecordingConsentGranted !== false &&
      callLog.recordingConsentGranted !== false &&
      member.recordingConsentStatus === 'GRANTED';
    const transcriptConsentGranted =
      callLog.transcriptConsentGranted !== false &&
      (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';

    const evaluated = evaluateSarvamAgentOutcome(payload, member.fullName, medicine.name, {
      recordingConsentGranted,
      transcriptConsentGranted,
    });

    const parsedStartedAt = parseSarvamUtcTimestamp(payload.started_at);
    const parsedAnsweredAt = parseSarvamUtcTimestamp(payload.answered_at);
    const parsedEndedAt = parseSarvamUtcTimestamp(payload.ended_at);
    const receivedAt = new Date();
    const cleanReason = cleanSarvamSentinel(payload.failure_reason);

    const sanitizedWebhookEntry = {
      eventId:
        typeof payload.event_id === 'string' && payload.event_id.trim()
          ? payload.event_id.trim()
          : `${rawStatus || 'unknown'}:${receivedAt.getTime()}`,
      receivedAt,
      source: 'WEBHOOK' as const,
      rawStatus: rawStatus || 'unknown',
      mappedStatus: evaluated.callStatus,
      sanitizedPayload: {
        eventType: typeof payload.event_type === 'string' ? payload.event_type : undefined,
        interactionId: payload.interaction_id || undefined,
        durationSeconds:
          typeof payload.duration === 'number' && Number.isFinite(payload.duration)
            ? Math.round(payload.duration)
            : undefined,
        failureReason: cleanReason,
        endedBy: cleanSarvamSentinel(payload.ended_by),
        languageName: cleanSarvamSentinel(payload.language_name),
      },
    };

    claimed.webhookEvents = claimed.webhookEvents || [];
    claimed.webhookEvents.push(sanitizedWebhookEntry);
    claimed.lastStatusUpdateAt = receivedAt;
    if (parsedEndedAt) claimed.providerUpdatedAt = parsedEndedAt;

    if (evaluated.isIntermediateEvent) {
      const isStillActive = ACTIVE_CALL_STATUSES.includes(claimed.callStatus);
      const currentRank = ACTIVE_STAGE_RANK[claimed.callStatus] ?? -1;
      const incomingRank = ACTIVE_STAGE_RANK[evaluated.callStatus] ?? 0;

      if (isStillActive && incomingRank >= currentRank) {
        claimed.callStatus = evaluated.callStatus;
        claimed.sarvamStatus = rawStatus;
        claimed.providerStatusRaw = rawStatus;
        if (parsedStartedAt) claimed.startedAt = parsedStartedAt;
        if (evaluated.callStatus === 'RINGING') claimed.ringingAt = receivedAt;
        if (evaluated.callStatus === 'ANSWERED' || evaluated.callStatus === 'IN_PROGRESS') {
          claimed.answeredAt = parsedAnsweredAt || claimed.answeredAt || receivedAt;
        }
        if (payload.interaction_id) claimed.interactionId = payload.interaction_id;
        if (payload.channel_info) claimed.channelInfo = payload.channel_info;
        if (evaluated.actualLanguageUsed) {
          claimed.actualLanguageUsed = evaluated.actualLanguageUsed;
          claimed.languageStatus = computeLanguageVerificationStatus({
            requestedLanguage: claimed.requestedLanguage || claimed.language,
            actualLanguageUsed: evaluated.actualLanguageUsed,
            existingStatus: claimed.languageStatus,
          });
        }
        claimed.aiSummary = evaluated.aiSummary;
        claimed.statusHistory.push({
          status: evaluated.callStatus,
          timestamp: receivedAt,
          source: 'WEBHOOK',
          note: `Sarvam webhook lifecycle transition: ${rawStatus}`,
        });
        await claimed.save();
      } else {
        claimed.statusHistory.push({
          status: claimed.callStatus,
          timestamp: receivedAt,
          source: 'WEBHOOK',
          note: `Ignored out-of-order Sarvam stage (${rawStatus}) while call in ${claimed.callStatus}`,
        });
        await claimed.save();
      }

      await recordAudit({
        familyId: callLog.familyId,
        actorType: 'WEBHOOK',
        actorId: attemptId,
        action: 'SARVAM_WEBHOOK_STAGE_UPDATED',
        resourceType: 'CallLog',
        resourceId: String(callLog._id),
        ipAddress: auditMeta?.ipAddress,
        metadata: {
          attemptId,
          sarvamStatus: rawStatus,
          callStatus: evaluated.callStatus,
        },
      });

      const stageDetail = await getCallDetail(String(callLog.familyId), String(callLog._id));
      return {
        idempotent: false,
        correlated: {
          attemptId,
          callLogId: String(callLog._id),
          patientId: String(member._id),
          doseId: String(dose._id),
        },
        detail: stageDetail,
      };
    }

    await claimed.save();

    const execResult: VoiceCallExecutionResult = {
      provider: 'sarvam',
      mode: 'live',
      callStatus: evaluated.callStatus,
      providerCallId: attemptId,
      attemptId,
      interactionId: payload.interaction_id ?? undefined,
      sarvamStatus: rawStatus,
      providerStatusRaw: rawStatus,
      failureReason: cleanReason,
      channelInfo: payload.channel_info ?? undefined,
      finalAgentVariables: transcriptConsentGranted
        ? (payload.final_agent_variables ?? undefined)
        : undefined,
      recordingUrl:
        recordingConsentGranted && typeof payload.recording_url === 'string'
          ? payload.recording_url
          : undefined,
      audioRecordingConsentGranted: recordingConsentGranted,
      transcriptConsentGranted,
      transcriptSource: 'WEBHOOK',
      actualLanguageUsed: evaluated.actualLanguageUsed,
      outcome: evaluated.outcome,
      durationSeconds: evaluated.durationSeconds,
      mealConfirmed: evaluated.mealConfirmed,
      medicineConfirmed: evaluated.medicineConfirmed,
      requestedCallbackDelayMinutes: evaluated.requestedCallbackDelayMinutes,
      feelingUnwell: evaluated.feelingUnwell,
      requestedHelp: evaluated.requestedHelp,
      turns: evaluated.turns,
      aiSummary: evaluated.aiSummary,
      safetyFlags: evaluated.safetyFlags,
    };

    await applyCallResultToEntities({
      callLogId: callLog._id as Types.ObjectId,
      doseId: dose._id as Types.ObjectId,
      familyId: callLog.familyId,
      memberId: member._id as Types.ObjectId,
      medicineId: medicine._id as Types.ObjectId,
      medicineName: medicine.name,
      dosage: medicine.dosage,
      memberName: member.fullName,
      languageCode: callLog.language,
      recordingConsentGranted,
      transcriptConsentGranted,
      result: execResult,
      statusSource: 'WEBHOOK',
      callbackId: callLog.callbackId,
      startedAtOverride: parsedStartedAt,
      answeredAtOverride: parsedAnsweredAt,
      endedAtOverride: parsedEndedAt,
    });

    await recordAudit({
      familyId: callLog.familyId,
      actorType: 'WEBHOOK',
      actorId: attemptId,
      action: 'SARVAM_WEBHOOK_PROCESSED',
      resourceType: 'CallLog',
      resourceId: String(callLog._id),
      ipAddress: auditMeta?.ipAddress,
      metadata: {
        attemptId,
        interactionId: payload.interaction_id ?? null,
        sarvamStatus: rawStatus,
        callStatus: evaluated.callStatus,
        mappedOutcome: evaluated.outcome,
        medicineConfirmed: evaluated.medicineConfirmed,
        recordingConsentGranted,
        transcriptConsentGranted,
        actualLanguageUsed: evaluated.actualLanguageUsed ?? null,
        patientId: String(member._id),
        doseId: String(dose._id),
      },
    });

    const detail = await getCallDetail(String(callLog.familyId), String(callLog._id));
    return {
      idempotent: false,
      correlated: {
        attemptId,
        callLogId: String(callLog._id),
        patientId: String(member._id),
        doseId: String(dose._id),
      },
      detail,
    };
  } catch (err) {
    await CallLog.updateOne(
      { _id: callLog._id },
      { $pull: { processedWebhookIds: idempotencyKey } }
    ).catch(() => undefined);
    throw err;
  }
}

/**
 * Invoked by BullMQ / MongoDB fallback worker when a scheduled call time arrives.
 */
export async function executeScheduledCallJob(callScheduleId: string): Promise<void> {
  if (!Types.ObjectId.isValid(callScheduleId)) return;

  // Atomically claim the job so overlapping workers or fallback polls cannot dispatch twice
  const job = await CallSchedule.findOneAndUpdate(
    { _id: new Types.ObjectId(callScheduleId), status: 'QUEUED' },
    { $set: { status: 'DISPATCHED', dispatchedAt: new Date() } },
    { new: true }
  );
  if (!job) return;

  const skipClaimedJob = async (
    reason: string,
    callbackTerminalStatus: 'CANCELLED' | 'FAILED' = 'FAILED'
  ) => {
    job.status = 'SKIPPED';
    job.failureReason = reason;
    await job.save();

    if (job.callbackId) {
      await Callback.findOneAndUpdate(
        {
          _id: job.callbackId,
          status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
        },
        {
          $set: {
            status: callbackTerminalStatus,
            validationNotes: reason,
          },
        }
      );
    }
  };

  if (job.callbackId) {
    const check = await verifyCallbackBeforeCall(job.callbackId);
    if (!check.valid) {
      const terminalStatus =
        check.reason === 'Dose already confirmed taken' ? 'CANCELLED' : 'FAILED';
      await skipClaimedJob(check.reason ?? 'Callback validation failed', terminalStatus);
      return;
    }
  }

  const [member, medicine, dose] = await Promise.all([
    FamilyMember.findById(job.familyMemberId).lean(),
    Medicine.findById(job.medicineId).lean(),
    DoseInstance.findById(job.doseInstanceId).lean(),
  ]);

  if (
    !member ||
    !member.isActive ||
    !medicine ||
    !medicine.isActive ||
    (medicine.endDate && medicine.endDate < new Date()) ||
    !dose
  ) {
    await skipClaimedJob('Inactive member, expired/inactive medicine, or missing dose', 'FAILED');
    return;
  }

  if (member.voiceCallingConsentStatus !== 'GRANTED') {
    await skipClaimedJob('Voice calling consent not granted', 'FAILED');
    return;
  }

  if (!isCallPermissionAllowedForType(member.callingPreferences, job.callType)) {
    await skipClaimedJob(
      `Patient preferences disable ${job.callType.toLowerCase()} reminders`,
      'CANCELLED'
    );
    return;
  }

  if (dose.status === 'PATIENT_REPORTED_TAKEN') {
    await skipClaimedJob('Dose already reported taken', 'CANCELLED');
    return;
  }

  if (
    job.callType !== 'CALLBACK' &&
    isWithinQuietHours(
      new Date(),
      member.timezone,
      member.callingPreferences?.quietHoursStart ?? '22:00',
      member.callingPreferences?.quietHoursEnd ?? '06:30'
    )
  ) {
    await skipClaimedJob('Within patient quiet hours');
    return;
  }

  const langMeta = getLanguageMeta(member.preferredLanguage);
  const telephony = isTelephonyReady();
  const webhook = getSarvamWebhookReadiness();
  const recordingConsentGranted = member.recordingConsentStatus === 'GRANTED';
  const transcriptConsentGranted = (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';
  const now = new Date();

  if (telephony.ready) {
    const langSupport = checkSarvamLanguageSupport(
      member.preferredLanguage,
      env.SARVAM_ALLOWED_LANGUAGES
    );
    if (!langSupport.supported || !langSupport.language) {
      const reason =
        langSupport.reason ||
        `Preferred language "${member.preferredLanguage}" is not supported on Sarvam; scheduled call skipped to avoid wrong-language Hindi fallback.`;
      await CallLog.create({
        familyId: job.familyId,
        familyMemberId: job.familyMemberId,
        medicineId: job.medicineId,
        doseInstanceId: job.doseInstanceId,
        callScheduleId: job._id,
        callbackId: job.callbackId,
        provider: 'sarvam',
        mode: 'live',
        isMock: false,
        isTestCall: false,
        callPurpose: `Scheduled ${job.callType.replace(/_/g, ' ').toLowerCase()}`,
        callStatus: 'LANGUAGE_UNAVAILABLE',
        outcome: 'FAILED',
        errorCategory: 'LANGUAGE_UNAVAILABLE',
        failureReason: reason,
        lastStatusUpdateAt: now,
        voiceCallingConsentGranted: true,
        recordingConsentGranted,
        audioRecordingConsentGranted: recordingConsentGranted,
        transcriptConsentGranted,
        callType: job.callType,
        phoneNumber: member.phoneNumber,
        language: member.preferredLanguage,
        requestedLanguage: member.preferredLanguage,
        languageStatus: 'LANGUAGE_UNAVAILABLE',
        scheduledAt: job.scheduledFor,
        startedAt: now,
        endedAt: now,
        durationSeconds: 0,
        recordingStatus: recordingConsentGranted ? 'UNAVAILABLE' : 'CONSENT_DENIED',
        transcriptStatus: transcriptConsentGranted ? 'UNAVAILABLE' : 'CONSENT_DENIED',
        transcriptAvailable: false,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        aiSummary: reason,
      });
      job.errorCategory = 'LANGUAGE_UNAVAILABLE';
      job.nonRetryable = true;
      await skipClaimedJob(reason, 'FAILED');
      return;
    }
  }

  if (telephony.ready && webhook.ready) {
    const existingActiveCall = await CallLog.findOne({
      familyId: job.familyId,
      familyMemberId: job.familyMemberId,
      doseInstanceId: job.doseInstanceId,
      callType: job.callType,
      mode: 'live',
      isMock: false,
      callStatus: { $in: ACTIVE_CALL_STATUSES },
    }).lean();

    if (existingActiveCall) {
      await skipClaimedJob('Duplicate active call already in progress for dose', 'CANCELLED');
      return;
    }
  }

  const callLog = await CallLog.create({
    familyId: job.familyId,
    familyMemberId: job.familyMemberId,
    medicineId: job.medicineId,
    doseInstanceId: job.doseInstanceId,
    callScheduleId: job._id,
    callbackId: job.callbackId,
    provider: telephony.mode,
    mode: telephony.ready ? 'live' : 'mock',
    isMock: !telephony.ready,
    isTestCall: false,
    callPurpose: `Scheduled ${job.callType.replace(/_/g, ' ').toLowerCase()}`,
    callStatus: 'INITIATING',
    statusHistory: [
      {
        status: 'QUEUED',
        timestamp: job.scheduledFor,
        source: 'SYSTEM',
        note: `Scheduled attempt #${job.attemptNumber}`,
      },
      {
        status: 'INITIATING',
        timestamp: now,
        source: 'SYSTEM',
      },
    ],
    recordingConsentGranted,
    audioRecordingConsentGranted: recordingConsentGranted,
    transcriptConsentGranted,
    lastStatusUpdateAt: now,
    queuedAt: job.scheduledFor,
    initiatingAt: now,
    callType: job.callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    requestedLanguage: langMeta.code,
    languageStatus: 'MATCHED',
    scheduledAt: job.scheduledFor,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
    transcriptStatus: transcriptConsentGranted ? 'PENDING' : 'CONSENT_DENIED',
    transcriptAvailable: false,
    mealConfirmed: null,
    medicineConfirmed: 'UNCONFIRMED',
  });

  if (telephony.ready) {
    try {
      const validatedPhone = normalizeAndValidateE164(
        member.phoneNumber,
        'FamilyMember.phoneNumber'
      );
      const context: VoiceCallContextPayload = {
        callLogId: String(callLog._id),
        familyId: String(job.familyId),
        familyMemberId: String(member._id),
        patientName: member.fullName,
        phoneNumber: validatedPhone,
        languageCode: langMeta.code,
        languageBcp47: langMeta.bcp47,
        languageName: langMeta.sarvamInitialLanguageName || langMeta.name,
        voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
        recordingConsentGranted,
        transcriptConsentGranted,
        medicineId: String(medicine._id),
        medicineName: medicine.name,
        dosage: medicine.dosage,
        doseNumber: typeof dose.slotIndex === 'number' ? dose.slotIndex + 1 : 1,
        foodInstruction: dose.foodInstruction,
        associatedMeal: dose.associatedMeal,
        slotLabel: dose.slotLabel,
        prescribedInstructions: medicine.prescribedInstructions,
        doseInstanceId: String(dose._id),
        callType: job.callType,
        callPurpose: `Scheduled ${job.callType.replace(/_/g, ' ').toLowerCase()}`,
        isTestCall: false,
        scheduledAtIso: job.scheduledFor.toISOString(),
        safetyDirectives: MEDICAL_SAFETY_DIRECTIVES,
      };

      const liveRes = await dispatchLiveVoiceCall(context);
      const attemptId = liveRes.attemptId || liveRes.providerCallId;
      const mappedLifecycle = mapProviderRawStatusToLifecycle(liveRes.rawStatus);
      const safeLifecycle: CallLifecycleStatus =
        mappedLifecycle === 'COMPLETED' ? 'INITIATING' : mappedLifecycle;

      callLog.attemptId = attemptId;
      callLog.providerCallId = attemptId;
      callLog.callStatus = safeLifecycle;
      callLog.outcome = 'PENDING';
      callLog.providerResponseMeta = {
        accepted: liveRes.accepted,
        attemptId,
        rawStatus: liveRes.rawStatus,
        httpStatus: liveRes.httpStatus,
      };
      callLog.statusHistory.push({
        status: safeLifecycle,
        timestamp: new Date(),
        source: 'PROVIDER_API',
        note: `Sarvam accepted outbound call (${liveRes.rawStatus})`,
      });
      callLog.aiSummary = `Live Sarvam outbound call accepted (${liveRes.rawStatus}). Awaiting webhook outcome.`;
      await callLog.save();
      job.status = 'COMPLETED';
      job.completedAt = new Date();
      await job.save();
      return;
    } catch (err) {
      const classified = classifySarvamSchedulerError(err);
      const msg = classified.detail;
      const failedAt = new Date();
      const isLangUnavailable = classified.category === 'LANGUAGE_UNAVAILABLE';

      callLog.callStatus = isLangUnavailable ? 'LANGUAGE_UNAVAILABLE' : 'FAILED';
      callLog.outcome = 'FAILED';
      callLog.sarvamStatus = isLangUnavailable ? 'language_unavailable' : 'failed';
      callLog.providerStatusRaw = isLangUnavailable ? 'LANGUAGE_UNAVAILABLE' : classified.category;
      callLog.errorCategory = classified.category;
      if (isLangUnavailable) {
        callLog.languageStatus = 'LANGUAGE_UNAVAILABLE';
      }
      callLog.endedAt = failedAt;
      callLog.lastStatusUpdateAt = failedAt;
      callLog.failureReason = msg.slice(0, 1000);
      callLog.providerResponseMeta = {
        error: msg.slice(0, 500),
        code: err instanceof AppError ? err.code : 'SARVAM_PROVIDER_ERROR',
        errorCategory: classified.category,
        nonRetryable: classified.nonRetryable,
        details: err instanceof AppError ? err.details : undefined,
      };
      callLog.statusHistory.push({
        status: callLog.callStatus,
        timestamp: failedAt,
        source: 'PROVIDER_API',
        note: `[${classified.category}] ${msg.slice(0, 350)}`,
      });
      callLog.aiSummary = isLangUnavailable
        ? `Scheduled call aborted: requested language unavailable (${msg})`
        : `Scheduled Sarvam outbound call failed (${classified.category}): ${msg}`;
      await callLog.save();

      // Always keep DoseInstance as UNCONFIRMED (never assume taken on failure)
      await DoseInstance.findOneAndUpdate(
        { _id: dose._id, status: { $in: ['PENDING', 'CALLBACK_REQUESTED'] } },
        { status: 'UNCONFIRMED' }
      );

      logger.error('Scheduled Sarvam outbound call failed', {
        callScheduleId: String(job._id),
        callLogId: String(callLog._id),
        errorCategory: classified.category,
        nonRetryable: classified.nonRetryable,
        attemptNumber: job.attemptNumber,
        maxAttempts: job.maxAttempts,
        reason: msg.slice(0, 300),
      });

      // Transient PROVIDER_ERROR only: allow bounded retry if attempts remain; never retry config/lang/auth failures
      if (!classified.nonRetryable && job.attemptNumber < job.maxAttempts) {
        const retryAt = new Date(Date.now() + 60 * 1000);
        job.attemptNumber += 1;
        job.status = 'QUEUED';
        job.errorCategory = classified.category;
        job.nonRetryable = false;
        job.scheduledFor = retryAt;
        job.dispatchedAt = undefined;
        job.failureReason = `[${classified.category}] Retry #${job.attemptNumber} scheduled: ${msg.slice(
          0,
          300
        )}`;
        await job.save();
        await enqueueCallJob(
          {
            callScheduleId: String(job._id),
            jobKey: `${job.jobKey}_retry_${job.attemptNumber}`,
            familyId: String(job.familyId),
            callType: job.callType,
          },
          retryAt
        ).catch(() => undefined);
        return;
      }

      if (job.callbackId) {
        await Callback.findByIdAndUpdate(job.callbackId, {
          status: 'FAILED',
          resultingCallLogId: callLog._id,
          validationNotes: `[${classified.category}] Outbound dispatch failed: ${msg.slice(0, 300)}`,
        });
      }

      job.status = 'FAILED';
      job.errorCategory = classified.category;
      job.nonRetryable = classified.nonRetryable;
      job.failureReason = `[${classified.category}] ${msg}`;
      await job.save();
      return;
    }
  }

  // In mock mode: NEVER create fake successful medicine confirmations automatically!
  const endedAt = new Date();
  callLog.providerCallId = `mock-queued-${String(callLog._id)}`;
  callLog.callStatus = 'NO_ANSWER';
  callLog.outcome = 'NO_ANSWER';
  callLog.endedAt = endedAt;
  callLog.recordingStatus = recordingConsentGranted ? 'UNAVAILABLE' : 'CONSENT_DENIED';
  callLog.medicineConfirmed = 'UNCONFIRMED';
  callLog.statusHistory.push({
    status: 'NO_ANSWER',
    timestamp: endedAt,
    source: 'SYSTEM',
    note: '[MOCK MODE] Real telephony disabled; no call placed',
  });
  callLog.aiSummary =
    '[MOCK MODE] Scheduled call reached trigger time while real telephony is disabled. Marked UNCONFIRMED without fabricating a patient response.';
  await callLog.save();

  await DoseInstance.findOneAndUpdate(
    { _id: dose._id, status: { $in: ['PENDING', 'CALLBACK_REQUESTED'] } },
    { status: 'UNCONFIRMED' }
  );

  if (job.callbackId) {
    await Callback.findByIdAndUpdate(job.callbackId, {
      status: 'FAILED',
      resultingCallLogId: callLog._id,
      validationNotes: '[MOCK MODE] Callback trigger reached while real telephony is disabled',
    });
  }

  job.status = 'COMPLETED';
  job.completedAt = new Date();
  await job.save();
}

export async function listCalls(
  familyId: string,
  filters?: {
    familyMemberId?: string;
    outcome?: CallOutcome;
    callStatus?: CallLifecycleStatus;
    callType?: CallType;
    mode?: 'mock' | 'live';
  }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.familyMemberId) {
    query.familyMemberId = new Types.ObjectId(filters.familyMemberId);
  }
  if (filters?.outcome) query.outcome = filters.outcome;
  if (filters?.callStatus) query.callStatus = filters.callStatus;
  if (filters?.callType) query.callType = filters.callType;
  if (filters?.mode) query.mode = filters.mode;

  return CallLog.find(query)
    .populate('familyMemberId', 'fullName phoneNumber preferredLanguage timezone')
    .populate('medicineId', 'name dosage')
    .populate('doseInstanceId', 'slotLabel scheduledAt status mealStatus')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

/**
 * Reconciles a live Sarvam CallLog with Sarvam Analytics APIs (`GET /attempts`,
 * `GET /interactions?include_transcript=true`, `GET /transcripts/{interaction_id}`,
 * and `GET /recordings/{interaction_id}` probe).
 * Safe to invoke periodically during polling or manually; stops querying once
 * call reaches terminal state and available transcript/language/recording resolve.
 */
async function reconcileSarvamCallInternal(params: {
  familyId: string;
  callLogId: string;
  force?: boolean;
}): Promise<{ reconciled: boolean; updated: boolean }> {
  if (!Types.ObjectId.isValid(params.callLogId)) return { reconciled: false, updated: false };

  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(params.callLogId),
    familyId: new Types.ObjectId(params.familyId),
  });
  if (!callLog) return { reconciled: false, updated: false };
  if (callLog.provider !== 'sarvam' || callLog.mode !== 'live' || !callLog.attemptId) {
    return { reconciled: false, updated: false };
  }

  const [member, medicine, existingConv] = await Promise.all([
    FamilyMember.findOne({ _id: callLog.familyMemberId, familyId: callLog.familyId }).lean(),
    callLog.medicineId
      ? Medicine.findOne({ _id: callLog.medicineId, familyId: callLog.familyId }).lean()
      : Promise.resolve(null),
    Conversation.findOne({ callLogId: callLog._id, familyId: callLog.familyId }),
  ]);
  if (!member || !medicine) return { reconciled: false, updated: false };

  const recordingConsentGranted =
    callLog.audioRecordingConsentGranted !== false &&
    callLog.recordingConsentGranted !== false &&
    member.recordingConsentStatus === 'GRANTED';
  const transcriptConsentGranted =
    callLog.transcriptConsentGranted !== false &&
    (member.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';

  const isActive = ACTIVE_CALL_STATUSES.includes(callLog.callStatus);
  const needsTranscript =
    transcriptConsentGranted &&
    callLog.callStatus === 'COMPLETED' &&
    (!existingConv || !existingConv.turns || existingConv.turns.length === 0);
  const needsLanguage = callLog.callStatus === 'COMPLETED' && !callLog.actualLanguageUsed;
  const needsInteractionId = callLog.callStatus === 'COMPLETED' && !callLog.interactionId;
  const needsRecordingProbe =
    recordingConsentGranted &&
    callLog.callStatus === 'COMPLETED' &&
    Boolean(callLog.interactionId) &&
    callLog.recordingStatus === 'PROCESSING';

  if (
    !params.force &&
    !isActive &&
    !needsTranscript &&
    !needsLanguage &&
    !needsInteractionId &&
    !needsRecordingProbe
  ) {
    return { reconciled: false, updated: false };
  }

  if (
    !params.force &&
    callLog.lastReconciledAt &&
    Date.now() - new Date(callLog.lastReconciledAt).getTime() < 5000
  ) {
    return { reconciled: false, updated: false };
  }

  const now = new Date();
  callLog.lastReconciledAt = now;
  let updated = false;
  let interactionId = callLog.interactionId;
  let actualLanguageUsed = callLog.actualLanguageUsed;
  let recoveredVars = callLog.finalAgentVariables;

  // 1) Query GET /attempts to recover missed terminal webhook or provider metadata
  if (isActive || needsInteractionId || needsLanguage || params.force) {
    const attemptRes = await fetchSarvamAttemptById(callLog.attemptId, callLog.createdAt);
    if (attemptRes.found && attemptRes.attempt) {
      const att = attemptRes.attempt;
      const attInteractionId = cleanSarvamSentinel(att.interaction_id);
      if (attInteractionId && attInteractionId !== interactionId) {
        interactionId = attInteractionId;
        callLog.interactionId = attInteractionId;
        updated = true;
      }

      const attLang = resolveSarvamLanguageCode(att.language_name);
      if (attLang && attLang !== actualLanguageUsed) {
        actualLanguageUsed = attLang;
        callLog.actualLanguageUsed = attLang;
        callLog.languageStatus = computeLanguageVerificationStatus({
          requestedLanguage: callLog.requestedLanguage || callLog.language,
          actualLanguageUsed: attLang,
          existingStatus: callLog.languageStatus,
        });
        updated = true;
      }

      const attRawStatus = cleanSarvamSentinel(att.connectivity_status)?.toLowerCase();
      if (attRawStatus) {
        callLog.providerStatusRaw = attRawStatus;
        callLog.sarvamStatus = attRawStatus;
        const parsedStart = parseSarvamUtcTimestamp(att.start_datetime);
        const parsedEnd = parseSarvamUtcTimestamp(att.end_datetime || att.attempted_at);
        if (parsedEnd) callLog.providerUpdatedAt = parsedEnd;

        if (ACTIVE_CALL_STATUSES.includes(callLog.callStatus)) {
          const evaluated = evaluateSarvamAgentOutcome(
            {
              attempt_id: callLog.attemptId,
              status: attRawStatus,
              connectivity_status: attRawStatus,
              started_at: att.start_datetime,
              ended_at: att.end_datetime,
              ended_by: att.ended_by,
              duration: att.duration_in_seconds,
              interaction_id: interactionId,
              failure_reason: att.failure_reason,
              language_name: att.language_name,
              final_agent_variables: att.agent_variables,
              recording_url: att.audio_url,
            },
            member.fullName,
            medicine.name,
            {
              recordingConsentGranted,
              transcriptConsentGranted,
            }
          );

          if (!evaluated.isIntermediateEvent && callLog.doseInstanceId && callLog.medicineId) {
            callLog.webhookEvents = callLog.webhookEvents || [];
            callLog.webhookEvents.push({
              eventId: `reconcile:${attRawStatus}:${now.getTime()}`,
              receivedAt: now,
              source: 'ANALYTICS_API',
              rawStatus: attRawStatus,
              mappedStatus: evaluated.callStatus,
              sanitizedPayload: {
                interactionId,
                durationSeconds: evaluated.durationSeconds,
                failureReason: cleanSarvamSentinel(att.failure_reason),
                endedBy: cleanSarvamSentinel(att.ended_by),
                languageName: cleanSarvamSentinel(att.language_name),
              },
            });
            await callLog.save();

            const execResult: VoiceCallExecutionResult = {
              provider: 'sarvam',
              mode: 'live',
              callStatus: evaluated.callStatus,
              providerCallId: callLog.attemptId,
              attemptId: callLog.attemptId,
              interactionId,
              sarvamStatus: attRawStatus,
              providerStatusRaw: attRawStatus,
              failureReason: cleanSarvamSentinel(att.failure_reason),
              finalAgentVariables: transcriptConsentGranted ? att.agent_variables : undefined,
              recordingUrl: recordingConsentGranted ? att.audio_url : undefined,
              audioRecordingConsentGranted: recordingConsentGranted,
              transcriptConsentGranted,
              transcriptSource: 'ANALYTICS_API',
              actualLanguageUsed: evaluated.actualLanguageUsed || actualLanguageUsed,
              outcome: evaluated.outcome,
              durationSeconds: evaluated.durationSeconds,
              mealConfirmed: evaluated.mealConfirmed,
              medicineConfirmed: evaluated.medicineConfirmed,
              requestedCallbackDelayMinutes: evaluated.requestedCallbackDelayMinutes,
              feelingUnwell: evaluated.feelingUnwell,
              requestedHelp: evaluated.requestedHelp,
              turns: evaluated.turns,
              aiSummary: evaluated.aiSummary,
              safetyFlags: evaluated.safetyFlags,
            };

            await applyCallResultToEntities({
              callLogId: callLog._id as Types.ObjectId,
              doseId: callLog.doseInstanceId,
              familyId: callLog.familyId,
              memberId: callLog.familyMemberId,
              medicineId: callLog.medicineId,
              medicineName: medicine.name,
              dosage: medicine.dosage,
              memberName: member.fullName,
              languageCode: callLog.language,
              recordingConsentGranted,
              transcriptConsentGranted,
              result: execResult,
              statusSource: 'RECONCILIATION',
              callbackId: callLog.callbackId,
              startedAtOverride: parsedStart,
              endedAtOverride: parsedEnd,
            });
            updated = true;
          } else if (evaluated.isIntermediateEvent) {
            const currentRank = ACTIVE_STAGE_RANK[callLog.callStatus] ?? -1;
            const incomingRank = ACTIVE_STAGE_RANK[evaluated.callStatus] ?? 0;
            if (incomingRank > currentRank) {
              callLog.callStatus = evaluated.callStatus;
              callLog.lastStatusUpdateAt = now;
              callLog.statusHistory.push({
                status: evaluated.callStatus,
                timestamp: now,
                source: 'RECONCILIATION',
                note: `Sarvam Analytics reconciled intermediate status: ${attRawStatus}`,
              });
              updated = true;
            }
          }
        }
      }
    }
  }

  // Reload callLog in case applyCallResultToEntities saved changes
  const latestLog = await CallLog.findOne({ _id: callLog._id, familyId: callLog.familyId });
  if (!latestLog) return { reconciled: true, updated };
  interactionId = latestLog.interactionId || interactionId;
  actualLanguageUsed = latestLog.actualLanguageUsed || actualLanguageUsed;
  recoveredVars = latestLog.finalAgentVariables || recoveredVars;

  // 2) Fetch async Sarvam Analytics transcripts when transcript consent is GRANTED
  const latestConv = await Conversation.findOne({
    callLogId: latestLog._id,
    familyId: latestLog.familyId,
  });
  const stillNeedsTranscript =
    transcriptConsentGranted &&
    latestLog.callStatus === 'COMPLETED' &&
    (!latestConv || !latestConv.turns || latestConv.turns.length === 0);

  if (stillNeedsTranscript || (latestLog.callStatus === 'COMPLETED' && (!actualLanguageUsed || !interactionId))) {
    const interRes = await fetchSarvamInteraction({
      attemptId: latestLog.attemptId,
      interactionId,
      referenceDate: latestLog.createdAt,
    });

    if (interRes.found && interRes.interaction) {
      const inter = interRes.interaction;
      if (inter.interaction_id && !latestLog.interactionId) {
        interactionId = inter.interaction_id;
        latestLog.interactionId = inter.interaction_id;
        updated = true;
      }
      const interLang = resolveSarvamLanguageCode(inter.language_name);
      if (interLang && !latestLog.actualLanguageUsed) {
        actualLanguageUsed = interLang;
        latestLog.actualLanguageUsed = interLang;
        latestLog.languageStatus = computeLanguageVerificationStatus({
          requestedLanguage: latestLog.requestedLanguage || latestLog.language,
          actualLanguageUsed: interLang,
          existingStatus: latestLog.languageStatus,
        });
        updated = true;
      }
      if (transcriptConsentGranted && inter.agent_variables && !recoveredVars) {
        recoveredVars = inter.agent_variables;
        latestLog.finalAgentVariables = inter.agent_variables;
        updated = true;
      }
    }

    if (transcriptConsentGranted && stillNeedsTranscript) {
      const trRes = interactionId
        ? await fetchSarvamTranscript(interactionId)
        : { found: false, messages: [] };

      const recoveredTurns = mapSarvamAnalyticsTranscripts({
        originalTranscript: interRes.interaction?.original_transcript,
        translateTranscript: interRes.interaction?.translate_transcript,
        messages: trRes.messages,
        defaultLanguage: actualLanguageUsed || latestLog.language,
      });

      if (recoveredTurns.length > 0) {
        latestLog.transcriptAvailable = true;
        latestLog.transcriptStatus = 'AVAILABLE';
        latestLog.transcriptSource = 'ANALYTICS_API';
        updated = true;

        await Conversation.findOneAndUpdate(
          { callLogId: latestLog._id, familyId: latestLog.familyId },
          {
            $set: {
              ...(interactionId ? { interactionId } : {}),
              ...(actualLanguageUsed ? { actualLanguageUsed } : {}),
              transcriptSource: 'ANALYTICS_API',
              turns: recoveredTurns.map((t) => ({
                ...t,
                timestamp: t.timestamp ?? new Date(),
                language: t.language || actualLanguageUsed || latestLog.language,
              })),
              ...(recoveredVars ? { finalAgentVariables: recoveredVars } : {}),
            },
          },
          { upsert: true, new: true }
        );
      } else if (
        latestLog.endedAt &&
        Date.now() - new Date(latestLog.endedAt).getTime() > 120_000 &&
        latestLog.transcriptStatus === 'PENDING'
      ) {
        latestLog.transcriptStatus = 'UNAVAILABLE';
        updated = true;
      }
    }
  }

  // 3) Probe Sarvam recording availability honestly when audio recording consent is GRANTED
  if (
    recordingConsentGranted &&
    latestLog.callStatus === 'COMPLETED' &&
    interactionId &&
    (latestLog.recordingStatus === 'PROCESSING' || params.force)
  ) {
    const recProbe = await probeSarvamRecording(interactionId);
    if (recProbe.status === 'AVAILABLE') {
      latestLog.recordingStatus = 'AVAILABLE';
      latestLog.recordingNote = 'Audio recording verified available on Sarvam Analytics.';
      await Recording.findOneAndUpdate(
        { callLogId: latestLog._id },
        {
          callLogId: latestLog._id,
          familyId: latestLog.familyId,
          familyMemberId: latestLog.familyMemberId,
          provider: 'sarvam',
          storageKey: `sarvam:${interactionId}`,
          mimeType: recProbe.mimeType || 'audio/wav',
          durationSeconds: latestLog.durationSeconds,
          consentVerified: true,
        },
        { upsert: true, new: true }
      );
      updated = true;
    } else if (recProbe.status === 'NOT_READY') {
      const elapsedMs = latestLog.endedAt
        ? Date.now() - new Date(latestLog.endedAt).getTime()
        : 0;
      if (params.force || elapsedMs > 90_000) {
        latestLog.recordingStatus = 'UNAVAILABLE';
        latestLog.recordingNote =
          'Audio recording returned HTTP 404 on Sarvam Analytics. Vobiz/Sarvam call recording may not be enabled for this attempt.';
      } else {
        latestLog.recordingStatus = 'PROCESSING';
        latestLog.recordingNote =
          'Recording returned HTTP 404 (Sarvam Analytics has up to ~60s archival delay). Retry shortly.';
      }
      updated = true;
    }
  }

  latestLog.lastReconciledAt = now;
  await latestLog.save();

  if (updated) {
    await recordAudit({
      familyId: latestLog.familyId,
      actorType: 'SYSTEM',
      actorId: latestLog.attemptId || String(latestLog._id),
      action: 'SARVAM_CALL_RECONCILED',
      resourceType: 'CallLog',
      resourceId: String(latestLog._id),
      metadata: {
        callStatus: latestLog.callStatus,
        transcriptStatus: latestLog.transcriptStatus,
        recordingStatus: latestLog.recordingStatus,
        actualLanguageUsed: latestLog.actualLanguageUsed ?? null,
      },
    });
  }

  return { reconciled: true, updated };
}

export async function reconcileSarvamCall(params: {
  familyId: string;
  callLogId: string;
  force?: boolean;
}) {
  await reconcileSarvamCallInternal(params);
  return getCallDetail(params.familyId, params.callLogId);
}

export async function getCallStatusSnapshot(
  familyId: string,
  callLogId: string,
  options?: { reconcile?: boolean }
) {
  if (!Types.ObjectId.isValid(callLogId)) {
    throw new ValidationError('Invalid callLogId');
  }
  if (options?.reconcile) {
    await reconcileSarvamCallInternal({ familyId, callLogId }).catch(() => undefined);
  }
  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(callLogId),
    familyId: new Types.ObjectId(familyId),
  })
    .select(
      '_id provider mode isMock isTestCall callType callPurpose callStatus outcome sarvamStatus providerStatusRaw attemptId interactionId failureReason queuedAt initiatingAt startedAt ringingAt answeredAt endedAt lastStatusUpdateAt lastReconciledAt providerUpdatedAt durationSeconds mealConfirmed medicineConfirmed recordingStatus recordingNote recordingConsentGranted audioRecordingConsentGranted transcriptConsentGranted transcriptAvailable transcriptStatus transcriptSource language requestedLanguage actualLanguageUsed fallbackLanguage languageStatus statusHistory webhookEvents updatedAt'
    )
    .lean();

  if (!callLog) throw new NotFoundError('Call log');
  return callLog;
}

export async function cancelActiveRealCall(input: {
  familyId: string;
  actorUserId: string;
  callLogId: string;
  reason?: string;
  ipAddress?: string;
}) {
  if (!Types.ObjectId.isValid(input.callLogId)) {
    throw new ValidationError('Invalid callLogId');
  }

  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(input.callLogId),
    familyId: new Types.ObjectId(input.familyId),
  });
  if (!callLog) throw new NotFoundError('Call log');

  if (!ACTIVE_CALL_STATUSES.includes(callLog.callStatus)) {
    throw new ConflictError(
      `Call is already in terminal state (${callLog.callStatus}) and cannot be cancelled.`
    );
  }

  const now = new Date();
  const reasonNote = input.reason?.trim() || 'Cancelled by authorized Admin in CareVoice';
  callLog.callStatus = 'CANCELLED';
  callLog.outcome = 'CANCELLED';
  callLog.sarvamStatus = 'cancelled';
  callLog.endedAt = now;
  callLog.failureReason = reasonNote;
  callLog.statusHistory.push({
    status: 'CANCELLED',
    timestamp: now,
    source: 'ADMIN',
    note: reasonNote,
  });
  callLog.aiSummary = `Call marked CANCELLED by Admin: ${reasonNote}. Dose remains UNCONFIRMED.`;
  await callLog.save();

  if (callLog.doseInstanceId) {
    await DoseInstance.findOneAndUpdate(
      { _id: callLog.doseInstanceId, status: { $in: ['PENDING', 'CALLBACK_REQUESTED'] } },
      { status: 'UNCONFIRMED' }
    );
  }

  await recordAudit({
    familyId: input.familyId,
    actorType: 'USER',
    actorId: input.actorUserId,
    action: 'REAL_CALL_CANCELLED',
    resourceType: 'CallLog',
    resourceId: String(callLog._id),
    ipAddress: input.ipAddress,
    metadata: { reason: reasonNote },
  });

  return getCallDetail(input.familyId, String(callLog._id));
}

export async function getCallDetail(
  familyId: string,
  callLogId: string,
  options?: { reconcile?: boolean }
) {
  if (!Types.ObjectId.isValid(callLogId)) {
    throw new ValidationError('Invalid callLogId');
  }
  if (options?.reconcile) {
    await reconcileSarvamCallInternal({ familyId, callLogId }).catch(() => undefined);
  }
  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(callLogId),
    familyId: new Types.ObjectId(familyId),
  })
    .populate(
      'familyMemberId',
      'fullName phoneNumber preferredLanguage timezone recordingConsentStatus transcriptConsentStatus voiceCallingConsentStatus'
    )
    .populate('medicineId', 'name dosage prescribedInstructions foodInstruction associatedMeal')
    .populate('doseInstanceId', 'slotLabel scheduledAt status mealStatus scheduledDateLocal')
    .lean();

  if (!callLog) throw new NotFoundError('Call log');

  const [conversation, recording, escalations, callbacks] = await Promise.all([
    Conversation.findOne({ callLogId: callLog._id, familyId: callLog.familyId }).lean(),
    Recording.findOne({ callLogId: callLog._id, familyId: callLog.familyId }).lean(),
    Escalation.find({
      callLogId: callLog._id,
      familyId: callLog.familyId,
    }).lean(),
    Callback.find({ sourceCallLogId: callLog._id, familyId: callLog.familyId }).lean(),
  ]);

  const populatedMember = callLog.familyMemberId as unknown as {
    transcriptConsentStatus?: string;
    recordingConsentStatus?: string;
  };
  const transcriptAllowed =
    callLog.transcriptConsentGranted !== false &&
    (populatedMember?.transcriptConsentStatus ?? 'PENDING') === 'GRANTED';
  const audioAllowed =
    callLog.audioRecordingConsentGranted !== false &&
    callLog.recordingConsentGranted !== false &&
    populatedMember?.recordingConsentStatus === 'GRANTED';

  const safeConversation =
    conversation && !transcriptAllowed
      ? {
          ...conversation,
          turns: [],
          finalAgentVariables: undefined,
          aiSummary:
            conversation.aiSummary ||
            '[Conversation transcript withheld: patient CALL_TRANSCRIPT consent not granted]',
        }
      : conversation;

  const safeCallLog = !transcriptAllowed || !audioAllowed
    ? {
        ...callLog,
        transcriptAvailable: transcriptAllowed ? callLog.transcriptAvailable : false,
        transcriptStatus: transcriptAllowed ? callLog.transcriptStatus : 'CONSENT_DENIED',
        recordingStatus: audioAllowed ? callLog.recordingStatus : 'CONSENT_DENIED',
      }
    : callLog;

  return {
    callLog: safeCallLog,
    conversation: safeConversation,
    recording:
      recording && audioAllowed
        ? {
            id: String(recording._id),
            mimeType: recording.mimeType,
            durationSeconds: recording.durationSeconds,
            consentVerified: recording.consentVerified,
            provider: recording.provider,
          }
        : null,
    escalations,
    callbacks,
  };
}

export async function getAuthorizedRecordingAudio(
  familyId: string,
  callLogId: string
): Promise<{
  mimeType: string;
  audioBuffer?: Buffer;
  audioDataBase64?: string;
  externalUrl?: string;
}> {
  const [recording, callLog] = await Promise.all([
    Recording.findOne({
      callLogId: new Types.ObjectId(callLogId),
      familyId: new Types.ObjectId(familyId),
    }).select('+audioDataBase64 +externalUrl'),
    CallLog.findOne({
      _id: new Types.ObjectId(callLogId),
      familyId: new Types.ObjectId(familyId),
    }).lean(),
  ]);

  if (!callLog) throw new NotFoundError('Call log');

  const member = await FamilyMember.findOne({
    _id: callLog.familyMemberId,
    familyId: callLog.familyId,
  }).lean();

  const callLevelAudioConsent =
    callLog.audioRecordingConsentGranted ?? callLog.recordingConsentGranted;
  if (
    !callLevelAudioConsent ||
    !member ||
    member.recordingConsentStatus !== 'GRANTED'
  ) {
    throw new ForbiddenError('Recording access denied: patient CALL_RECORDING consent is not GRANTED');
  }

  const fetchFromSarvamOrUpdateNote = async (interactionId: string) => {
    try {
      return await fetchSarvamRecordingAudio(interactionId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'RECORDING_NOT_READY') {
        const elapsedMs = callLog.endedAt
          ? Date.now() - new Date(callLog.endedAt).getTime()
          : 0;
        await CallLog.updateOne(
          { _id: callLog._id },
          {
            $set: {
              recordingStatus: elapsedMs > 90_000 ? 'UNAVAILABLE' : 'PROCESSING',
              recordingNote:
                elapsedMs > 90_000
                  ? 'Audio recording returned HTTP 404 on Sarvam Analytics. Vobiz/Sarvam recording may be disabled or unavailable.'
                  : 'Audio recording not yet available on Sarvam Analytics (HTTP 404). Retry after ~60s archival window.',
            },
          }
        ).catch(() => undefined);
      }
      throw err;
    }
  };

  if (!recording) {
    if (callLog.provider === 'sarvam' && callLog.interactionId) {
      const fetched = await fetchFromSarvamOrUpdateNote(callLog.interactionId);
      return {
        mimeType: fetched.mimeType,
        audioBuffer: fetched.buffer,
        audioDataBase64: undefined,
        externalUrl: undefined,
      };
    }
    throw new NotFoundError('Recording');
  }

  if (!recording.consentVerified) {
    throw new ForbiddenError('Recording access denied: patient recording consent is not verified');
  }

  if (recording.audioDataBase64) {
    return {
      mimeType: recording.mimeType,
      audioBuffer: Buffer.from(recording.audioDataBase64, 'base64'),
      audioDataBase64: recording.audioDataBase64,
      externalUrl: undefined,
    };
  }

  if (recording.provider === 'sarvam' && callLog.interactionId) {
    const fetched = await fetchFromSarvamOrUpdateNote(callLog.interactionId);
    return {
      mimeType: fetched.mimeType,
      audioBuffer: fetched.buffer,
      audioDataBase64: undefined,
      externalUrl: undefined,
    };
  }

  return {
    mimeType: recording.mimeType,
    audioBuffer: undefined,
    audioDataBase64: undefined,
    externalUrl: recording.externalUrl,
  };
}

