import crypto from 'crypto';
import { Types } from 'mongoose';
import {
  MockCallScenario,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from '../adapters/voice/voiceProvider.interface';
import { withOptionalTransaction } from '../config/database';
import { isTelephonyReady } from '../config/env';
import { getLanguageMeta } from '../constants/languages';
import { CallOutcome, CallType, MedicineConfirmationValue } from '../constants/statuses';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { Callback } from '../models/Callback';
import { Conversation } from '../models/Conversation';
import { DoseInstance } from '../models/DoseInstance';
import { FamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { Recording } from '../models/Recording';
import {
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
  simulateMockVoiceCall,
} from './sarvamVoice.service';
import { MEDICAL_SAFETY_DIRECTIVES } from './voiceContext.service';

export interface SimulateCallInput {
  familyId: string;
  actorUserId: string;
  doseInstanceId: string;
  callType?: CallType;
  scenario: MockCallScenario;
  delayMinutes?: number;
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
}) {
  const { result } = params;

  await withOptionalTransaction(async (session) => {
    const callLog = await CallLog.findById(params.callLogId, null, session ? { session } : undefined);
    if (!callLog) throw new NotFoundError('Call log');

    callLog.outcome = result.outcome;
    callLog.endedAt = new Date();
    callLog.durationSeconds = result.durationSeconds;
    callLog.mealConfirmed = result.mealConfirmed;
    callLog.medicineConfirmed = result.medicineConfirmed;
    callLog.aiSummary = result.aiSummary;
    callLog.transcriptAvailable = result.turns.length > 0;
    if (result.attemptId) callLog.attemptId = result.attemptId;
    if (result.interactionId) callLog.interactionId = result.interactionId;
    if (result.sarvamStatus) callLog.sarvamStatus = result.sarvamStatus;
    if (result.failureReason !== undefined) callLog.failureReason = result.failureReason;
    if (result.channelInfo) callLog.channelInfo = result.channelInfo;
    if (result.finalAgentVariables !== undefined) {
      callLog.finalAgentVariables = result.finalAgentVariables;
    }
    callLog.recordingStatus = !params.recordingConsentGranted
      ? 'CONSENT_DENIED'
      : result.recordingWavBase64
        ? 'AVAILABLE'
        : 'UNAVAILABLE';
    await callLog.save(session ? { session } : undefined);

    if (result.turns.length > 0 || result.aiSummary || result.finalAgentVariables) {
      await Conversation.findOneAndUpdate(
        { callLogId: callLog._id },
        {
          callLogId: callLog._id,
          familyId: params.familyId,
          familyMemberId: params.memberId,
          doseInstanceId: params.doseId,
          ...(result.interactionId ? { interactionId: result.interactionId } : {}),
          language: params.languageCode,
          turns: result.turns.map((t) => ({ ...t, timestamp: new Date() })),
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
                  result.outcome === 'FAILED'
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

export async function simulateCallForDose(input: SimulateCallInput) {
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

  const callLog = await CallLog.create({
    familyId: dose.familyId,
    familyMemberId: member._id,
    medicineId: medicine._id,
    doseInstanceId: dose._id,
    provider: 'mock',
    providerCallId: `mock-pending-${crypto.randomUUID().slice(0, 8)}`,
    mode: 'mock',
    callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    scheduledAt: dose.scheduledAt,
    startedAt: now,
    durationSeconds: 0,
    outcome: 'ANSWERED',
    recordingStatus:
      member.recordingConsentStatus === 'GRANTED' ? 'PROCESSING' : 'CONSENT_DENIED',
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
    recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
    medicineId: String(medicine._id),
    medicineName: medicine.name,
    dosage: medicine.dosage,
    foodInstruction: dose.foodInstruction,
    associatedMeal: dose.associatedMeal,
    prescribedInstructions: medicine.prescribedInstructions,
    doseInstanceId: String(dose._id),
    callType,
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
    recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
    result: simResult,
  });

  await recordAudit({
    familyId: input.familyId,
    actorType: 'USER',
    actorId: input.actorUserId,
    action: 'MOCK_VOICE_CALL_SIMULATED',
    resourceType: 'CallLog',
    resourceId: String(callLog._id),
    metadata: { scenario: input.scenario, language: langMeta.code },
  });

  return getCallDetail(input.familyId, String(callLog._id));
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

  const execResult: VoiceCallExecutionResult = {
    provider: callLog.provider,
    mode: callLog.mode,
    providerCallId: callLog.providerCallId || String(callLog._id),
    outcome: input.outcome,
    durationSeconds: input.durationSeconds ?? 0,
    mealConfirmed: input.mealConfirmed ?? null,
    medicineConfirmed: input.medicineConfirmed ?? 'UNCONFIRMED',
    feelingUnwell: input.feelingUnwell,
    requestedHelp: input.requestedHelp,
    turns: input.turns ?? [],
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
    recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
    result: execResult,
    callbackId: callLog.callbackId,
  });

  return getCallDetail(String(callLog.familyId), String(callLog._id));
}

/**
 * Processes an official Sarvam Voice Agents Instant Outbound Webhook event:
 * - Correlates attempt_id with CallLog and verifies patient_id + dose_id metadata
 * - Guarantees atomic idempotency across retries using processedWebhookIds
 * - Persists interaction_transcript and final_agent_variables
 * - Maps connected / no_answer / busy / failed without ever assuming unconfirmed intake
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

  const idempotencyKey = `sarvam:${attemptId}:${payload.status}:${payload.interaction_id || 'none'}`;
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
    const evaluated = evaluateSarvamAgentOutcome(payload, member.fullName, medicine.name);
    const execResult: VoiceCallExecutionResult = {
      provider: 'sarvam',
      mode: 'live',
      providerCallId: attemptId,
      attemptId,
      interactionId: payload.interaction_id ?? undefined,
      sarvamStatus: payload.status,
      failureReason: payload.failure_reason ?? undefined,
      channelInfo: payload.channel_info ?? undefined,
      finalAgentVariables: payload.final_agent_variables ?? undefined,
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
      recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
      result: execResult,
      callbackId: callLog.callbackId,
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
        mappedOutcome: evaluated.outcome,
        medicineConfirmed: evaluated.medicineConfirmed,
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

  const callLog = await CallLog.create({
    familyId: job.familyId,
    familyMemberId: job.familyMemberId,
    medicineId: job.medicineId,
    doseInstanceId: job.doseInstanceId,
    callScheduleId: job._id,
    callbackId: job.callbackId,
    provider: telephony.mode,
    mode: telephony.ready ? 'live' : 'mock',
    callType: job.callType,
    phoneNumber: member.phoneNumber,
    language: langMeta.code,
    scheduledAt: job.scheduledFor,
    startedAt: new Date(),
    durationSeconds: 0,
    outcome: 'NO_ANSWER',
    recordingStatus:
      member.recordingConsentStatus === 'GRANTED' ? 'UNAVAILABLE' : 'CONSENT_DENIED',
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
        recordingConsentGranted: member.recordingConsentStatus === 'GRANTED',
        medicineId: String(medicine._id),
        medicineName: medicine.name,
        dosage: medicine.dosage,
        foodInstruction: dose.foodInstruction,
        associatedMeal: dose.associatedMeal,
        prescribedInstructions: medicine.prescribedInstructions,
        doseInstanceId: String(dose._id),
        callType: job.callType,
        scheduledAtIso: job.scheduledFor.toISOString(),
        safetyDirectives: MEDICAL_SAFETY_DIRECTIVES,
      };

      const liveRes = await dispatchLiveVoiceCall(context);
      const attemptId = liveRes.attemptId || liveRes.providerCallId;
      callLog.attemptId = attemptId;
      callLog.providerCallId = attemptId;
      callLog.aiSummary = `Live Sarvam outbound call queued (${liveRes.rawStatus}). Awaiting webhook outcome.`;
      await callLog.save();
      job.status = 'COMPLETED';
      job.completedAt = new Date();
      await job.save();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sarvam outbound dispatch failed';
      callLog.outcome = 'FAILED';
      callLog.sarvamStatus = 'failed';
      callLog.failureReason = msg.slice(0, 1000);
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
  callLog.providerCallId = `mock-queued-${String(callLog._id)}`;
  callLog.outcome = 'NO_ANSWER';
  callLog.medicineConfirmed = 'UNCONFIRMED';
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
  filters?: { familyMemberId?: string; outcome?: CallOutcome; callType?: CallType }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.familyMemberId) {
    query.familyMemberId = new Types.ObjectId(filters.familyMemberId);
  }
  if (filters?.outcome) query.outcome = filters.outcome;
  if (filters?.callType) query.callType = filters.callType;

  return CallLog.find(query)
    .populate('familyMemberId', 'fullName phoneNumber preferredLanguage timezone')
    .populate('medicineId', 'name dosage')
    .populate('doseInstanceId', 'slotLabel scheduledAt status mealStatus')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function getCallDetail(familyId: string, callLogId: string) {
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
    // Import Escalation lazily or query directly
    (await import('../models/Escalation')).Escalation.find({
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

export async function getAuthorizedRecordingAudio(familyId: string, callLogId: string) {
  const recording = await Recording.findOne({
    callLogId: new Types.ObjectId(callLogId),
    familyId: new Types.ObjectId(familyId),
  }).select('+audioDataBase64 +externalUrl');

  if (!recording) throw new NotFoundError('Recording');
  if (!recording.consentVerified) {
    throw new ForbiddenError('Recording access denied: patient recording consent is not verified');
  }

  return recording;
}

