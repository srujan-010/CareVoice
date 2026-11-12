import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  MockCallScenario,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from '../adapters/voice/voiceProvider.interface';
import { withOptionalTransaction } from '../config/database';
import {
  getSarvamWebhookReadiness,
  isMockSimulationAllowed,
  isTelephonyReady,
} from '../config/env';
import { getLanguageMeta } from '../constants/languages';
import {
  CallLifecycleStatus,
  CallOutcome,
  CallType,
  MedicineConfirmationValue,
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
  dispatchLiveVoiceCall,
  evaluateSarvamAgentOutcome,
  fetchSarvamRecordingAudio,
  getVoiceAgentStatus,
  mapProviderRawStatusToLifecycle,
  simulateMockVoiceCall,
  verifySarvamAgentDeployment,
} from './sarvamVoice.service';
import { MEDICAL_SAFETY_DIRECTIVES } from './voiceContext.service';

const ACTIVE_CALL_STATUSES: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'IN_PROGRESS',
];

const ACTIVE_STAGE_RANK: Record<string, number> = {
  QUEUED: 0,
  INITIATING: 1,
  RINGING: 2,
  IN_PROGRESS: 3,
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
  if (outcome === 'FAILED') return 'FAILED';
  if (outcome === 'CANCELLED') return 'CANCELLED';
  return 'COMPLETED';
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
  result: VoiceCallExecutionResult;
  callbackId?: Types.ObjectId;
  startedAtOverride?: Date;
  endedAtOverride?: Date;
}) {
  const { result } = params;

  await withOptionalTransaction(async (session) => {
    const callLog = await CallLog.findById(params.callLogId, null, session ? { session } : undefined);
    if (!callLog) throw new NotFoundError('Call log');

    const eventTime = params.endedAtOverride ?? new Date();
    const resolvedCallStatus: CallLifecycleStatus =
      result.callStatus ?? mapOutcomeToLifecycleStatus(result.outcome);

    callLog.callStatus = resolvedCallStatus;
    callLog.outcome = result.outcome;
    if (params.startedAtOverride && !callLog.startedAt) {
      callLog.startedAt = params.startedAtOverride;
    }
    callLog.endedAt = eventTime;
    callLog.durationSeconds = result.durationSeconds;
    callLog.mealConfirmed = result.mealConfirmed;
    callLog.medicineConfirmed = result.medicineConfirmed;
    callLog.aiSummary = result.aiSummary;
    callLog.recordingConsentGranted = params.recordingConsentGranted;
    callLog.transcriptConsentGranted = params.recordingConsentGranted;
    callLog.transcriptAvailable = params.recordingConsentGranted && result.turns.length > 0;
    if (result.attemptId) callLog.attemptId = result.attemptId;
    if (result.interactionId) callLog.interactionId = result.interactionId;
    if (result.sarvamStatus) callLog.sarvamStatus = result.sarvamStatus;
    if (result.failureReason !== undefined) callLog.failureReason = result.failureReason;
    if (result.channelInfo) callLog.channelInfo = result.channelInfo;
    if (result.finalAgentVariables !== undefined) {
      callLog.finalAgentVariables = result.finalAgentVariables;
    }
    callLog.statusHistory.push({
      status: resolvedCallStatus,
      timestamp: eventTime,
      source: result.provider === 'sarvam' ? 'WEBHOOK' : 'SYSTEM',
      note: result.failureReason || result.aiSummary?.slice(0, 200),
    });

    const hasSarvamAudioRef = Boolean(
      result.provider === 'sarvam' &&
        (result.recordingUrl || result.interactionId) &&
        resolvedCallStatus === 'COMPLETED'
    );
    callLog.recordingStatus = !params.recordingConsentGranted
      ? 'CONSENT_DENIED'
      : result.recordingWavBase64 || hasSarvamAudioRef
        ? 'AVAILABLE'
        : 'UNAVAILABLE';
    await callLog.save(session ? { session } : undefined);

    const safeTurns = params.recordingConsentGranted ? result.turns : [];

    if (safeTurns.length > 0 || result.aiSummary || result.finalAgentVariables) {
      await Conversation.findOneAndUpdate(
        { callLogId: callLog._id },
        {
          callLogId: callLog._id,
          familyId: params.familyId,
          familyMemberId: params.memberId,
          doseInstanceId: params.doseId,
          ...(result.interactionId ? { interactionId: result.interactionId } : {}),
          language: params.languageCode,
          turns: safeTurns.map((t) => ({ ...t, timestamp: new Date() })),
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
          ...(result.finalAgentVariables
            ? { finalAgentVariables: result.finalAgentVariables }
            : {}),
          aiSummary: result.aiSummary,
          safetyFlags: result.safetyFlags,
        },
        { upsert: true, new: true, session }
      );
    }

    if (params.recordingConsentGranted && result.recordingWavBase64) {
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
    } else if (params.recordingConsentGranted && hasSarvamAudioRef) {
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
                  result.outcome === 'CANCELLED'
                ? 'FAILED'
                : 'COMPLETED',
          resultingCallLogId: callLog._id,
        },
        session ? { session } : undefined
      );
    }
  });

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
    result.outcome === 'FAILED'
  ) {
    const missedCount = await CallLog.countDocuments({
      doseInstanceId: params.doseId,
      outcome: { $in: ['NO_ANSWER', 'BUSY', 'REJECTED', 'FAILED'] },
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
    liveCallingAllowed: baseStatus.telephonyReady && baseStatus.webhookReady,
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
    transcriptConsentGranted: recordingConsentGranted,
    queuedAt: now,
    initiatingAt: now,
    callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    scheduledAt: dose.scheduledAt,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
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
    voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
    recordingConsentGranted,
    medicineId: String(medicine._id),
    medicineName: medicine.name,
    dosage: medicine.dosage,
    foodInstruction: dose.foodInstruction,
    associatedMeal: dose.associatedMeal,
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
    result: simResult,
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

  const langMeta = getLanguageMeta(member.preferredLanguage);
  const recordingConsentGranted = member.recordingConsentStatus === 'GRANTED';
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
        note: 'Safety, consent, E.164, and deployment checks passed; calling Sarvam Outbound API',
      },
    ],
    recordingConsentGranted,
    transcriptConsentGranted: recordingConsentGranted,
    queuedAt: now,
    initiatingAt: now,
    callType,
    phoneNumber: validatedPhone,
    language: langMeta.code,
    scheduledAt: dose.scheduledAt,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
    transcriptAvailable: false,
    mealConfirmed: null,
    medicineConfirmed: 'UNCONFIRMED',
    contextSnapshot: {
      patientName: member.fullName,
      languageBcp47: langMeta.bcp47,
      medicineName: medicine.name,
      dosage: medicine.dosage,
      slotLabel: dose.slotLabel,
      associatedMeal: dose.associatedMeal,
      foodInstruction: dose.foodInstruction,
      prescribedInstructions: medicine.prescribedInstructions,
      recordingConsentStatus: member.recordingConsentStatus,
      voiceCallingConsentStatus: member.voiceCallingConsentStatus,
      deploymentStatus: deploymentCheck.status,
    },
    aiSummary: `Initiating live Sarvam outbound call to ${member.fullName}...`,
  });

  const context: VoiceCallContextPayload = {
    callLogId: String(callLog._id),
    familyId: String(dose.familyId),
    familyMemberId: String(member._id),
    patientName: member.fullName,
    phoneNumber: validatedPhone,
    languageCode: langMeta.code,
    languageBcp47: langMeta.bcp47,
    voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
    recordingConsentGranted,
    medicineId: String(medicine._id),
    medicineName: medicine.name,
    dosage: medicine.dosage,
    foodInstruction: dose.foodInstruction,
    associatedMeal: dose.associatedMeal,
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
    if (safeLifecycle === 'RINGING') callLog.ringingAt = acceptedAt;
    if (safeLifecycle === 'IN_PROGRESS') callLog.answeredAt = acceptedAt;
    callLog.providerResponseMeta = {
      accepted: liveRes.accepted,
      attemptId: liveRes.attemptId,
      rawStatus: liveRes.rawStatus,
      httpStatus: liveRes.httpStatus,
      deploymentStatus: deploymentCheck.status,
    };
    callLog.statusHistory.push({
      status: safeLifecycle,
      timestamp: acceptedAt,
      source: 'PROVIDER_API',
      note: `Sarvam accepted outbound call (attempt_id: ${liveRes.attemptId}, status: ${liveRes.rawStatus})`,
    });
    callLog.aiSummary = `Sarvam outbound call accepted (attempt_id: ${liveRes.attemptId}). Dialing ${member.fullName}; awaiting live webhook events. Dose remains ${dose.status}.`;
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
        recordingConsentGranted,
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
    const msg = err instanceof Error ? err.message : 'Sarvam outbound dispatch failed';
    const failedAt = new Date();
    callLog.callStatus = 'FAILED';
    callLog.outcome = 'FAILED';
    callLog.sarvamStatus = 'failed';
    callLog.endedAt = failedAt;
    callLog.failureReason = msg.slice(0, 1000);
    callLog.providerResponseMeta = {
      error: msg.slice(0, 500),
      code: err instanceof AppError ? err.code : 'SARVAM_PROVIDER_ERROR',
      details: err instanceof AppError ? err.details : undefined,
    };
    callLog.statusHistory.push({
      status: 'FAILED',
      timestamp: failedAt,
      source: 'PROVIDER_API',
      note: msg.slice(0, 400),
    });
    callLog.aiSummary = `Live Sarvam outbound call failed before connecting: ${msg}`;
    await callLog.save();

    await recordAudit({
      familyId: input.familyId,
      actorType: 'USER',
      actorId: input.actorUserId,
      action: 'REAL_TEST_CALL_FAILED',
      resourceType: 'CallLog',
      resourceId: String(callLog._id),
      ipAddress: input.ipAddress,
      metadata: {
        error: msg.slice(0, 300),
        callType,
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
    turns: recordingConsentGranted ? input.turns ?? [] : [],
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

  const eventSuffix =
    typeof payload.event_id === 'string' && payload.event_id.trim()
      ? payload.event_id.trim()
      : payload.interaction_id || 'none';
  const idempotencyKey = `sarvam:${attemptId}:${payload.status}:${eventSuffix}`;

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
      callLog.recordingConsentGranted !== false && member.recordingConsentStatus === 'GRANTED';

    const evaluated = evaluateSarvamAgentOutcome(payload, member.fullName, medicine.name, {
      recordingConsentGranted,
    });

    const parsedStartedAt =
      payload.started_at && !Number.isNaN(Date.parse(payload.started_at))
        ? new Date(payload.started_at)
        : undefined;
    const parsedEndedAt =
      payload.ended_at && !Number.isNaN(Date.parse(payload.ended_at))
        ? new Date(payload.ended_at)
        : undefined;

    if (evaluated.isIntermediateEvent) {
      const stageTime = new Date();
      const isStillActive = ACTIVE_CALL_STATUSES.includes(claimed.callStatus);
      const currentRank = ACTIVE_STAGE_RANK[claimed.callStatus] ?? -1;
      const incomingRank = ACTIVE_STAGE_RANK[evaluated.callStatus] ?? 0;

      if (isStillActive && incomingRank >= currentRank) {
        claimed.callStatus = evaluated.callStatus;
        claimed.sarvamStatus = payload.status;
        if (parsedStartedAt) claimed.startedAt = parsedStartedAt;
        if (evaluated.callStatus === 'RINGING') claimed.ringingAt = stageTime;
        if (evaluated.callStatus === 'IN_PROGRESS') claimed.answeredAt = stageTime;
        if (payload.interaction_id) claimed.interactionId = payload.interaction_id;
        if (payload.channel_info) claimed.channelInfo = payload.channel_info;
        claimed.aiSummary = evaluated.aiSummary;
        claimed.statusHistory.push({
          status: evaluated.callStatus,
          timestamp: stageTime,
          source: 'WEBHOOK',
          note: `Sarvam webhook lifecycle transition: ${payload.status}`,
        });
        await claimed.save();
      } else {
        claimed.statusHistory.push({
          status: claimed.callStatus,
          timestamp: stageTime,
          source: 'WEBHOOK',
          note: `Ignored out-of-order Sarvam stage (${payload.status}) while call in ${claimed.callStatus}`,
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
          sarvamStatus: payload.status,
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

    const execResult: VoiceCallExecutionResult = {
      provider: 'sarvam',
      mode: 'live',
      callStatus: evaluated.callStatus,
      providerCallId: attemptId,
      attemptId,
      interactionId: payload.interaction_id ?? undefined,
      sarvamStatus: payload.status,
      failureReason: payload.failure_reason ?? undefined,
      channelInfo: payload.channel_info ?? undefined,
      finalAgentVariables: payload.final_agent_variables ?? undefined,
      recordingUrl:
        recordingConsentGranted && typeof payload.recording_url === 'string'
          ? payload.recording_url
          : undefined,
      transcriptConsentGranted: recordingConsentGranted,
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
      result: execResult,
      callbackId: callLog.callbackId,
      startedAtOverride: parsedStartedAt,
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
        sarvamStatus: payload.status,
        callStatus: evaluated.callStatus,
        mappedOutcome: evaluated.outcome,
        medicineConfirmed: evaluated.medicineConfirmed,
        recordingConsentGranted,
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
  const now = new Date();

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
    transcriptConsentGranted: recordingConsentGranted,
    queuedAt: job.scheduledFor,
    initiatingAt: now,
    callType: job.callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    scheduledAt: job.scheduledFor,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'PENDING',
    recordingStatus: recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
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
        voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
        recordingConsentGranted,
        medicineId: String(medicine._id),
        medicineName: medicine.name,
        dosage: medicine.dosage,
        foodInstruction: dose.foodInstruction,
        associatedMeal: dose.associatedMeal,
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
      const msg = err instanceof Error ? err.message : 'Sarvam outbound dispatch failed';
      const failedAt = new Date();
      callLog.callStatus = 'FAILED';
      callLog.outcome = 'FAILED';
      callLog.sarvamStatus = 'failed';
      callLog.endedAt = failedAt;
      callLog.failureReason = msg.slice(0, 1000);
      callLog.statusHistory.push({
        status: 'FAILED',
        timestamp: failedAt,
        source: 'PROVIDER_API',
        note: msg.slice(0, 400),
      });
      callLog.aiSummary = `Live Sarvam outbound dispatch failed: ${msg}`;
      await callLog.save();

      await DoseInstance.findOneAndUpdate(
        { _id: dose._id, status: { $in: ['PENDING', 'CALLBACK_REQUESTED'] } },
        { status: 'UNCONFIRMED' }
      );

      if (job.callbackId) {
        await Callback.findByIdAndUpdate(job.callbackId, {
          status: 'FAILED',
          resultingCallLogId: callLog._id,
          validationNotes: `Outbound dispatch failed: ${msg.slice(0, 300)}`,
        });
      }

      job.status = 'FAILED';
      job.failureReason = msg;
      await job.save();
      throw err;
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

export async function getCallStatusSnapshot(familyId: string, callLogId: string) {
  if (!Types.ObjectId.isValid(callLogId)) {
    throw new ValidationError('Invalid callLogId');
  }
  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(callLogId),
    familyId: new Types.ObjectId(familyId),
  })
    .select(
      '_id provider mode isMock isTestCall callType callPurpose callStatus outcome sarvamStatus attemptId interactionId failureReason startedAt ringingAt answeredAt endedAt durationSeconds mealConfirmed medicineConfirmed recordingStatus recordingConsentGranted transcriptAvailable statusHistory updatedAt'
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

export async function getCallDetail(familyId: string, callLogId: string) {
  if (!Types.ObjectId.isValid(callLogId)) {
    throw new ValidationError('Invalid callLogId');
  }
  const callLog = await CallLog.findOne({
    _id: new Types.ObjectId(callLogId),
    familyId: new Types.ObjectId(familyId),
  })
    .populate('familyMemberId', 'fullName phoneNumber preferredLanguage timezone recordingConsentStatus')
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

  return {
    callLog,
    conversation,
    recording: recording
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

  if (
    !callLog.recordingConsentGranted ||
    !member ||
    member.recordingConsentStatus !== 'GRANTED'
  ) {
    throw new ForbiddenError('Recording access denied: patient recording consent is not GRANTED');
  }

  if (!recording) {
    if (callLog.provider === 'sarvam' && callLog.interactionId) {
      const fetched = await fetchSarvamRecordingAudio(callLog.interactionId);
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
    const fetched = await fetchSarvamRecordingAudio(callLog.interactionId);
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

