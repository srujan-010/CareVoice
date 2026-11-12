import crypto from 'crypto';
import { Types } from 'mongoose';
import { withOptionalTransaction } from '../config/database';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { Callback, ICallback } from '../models/Callback';
import { DoseInstance } from '../models/DoseInstance';
import { Family } from '../models/Family';
import { FamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { enqueueCallJob, removeCallJob } from '../queues/queueManager';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { addMinutesUtc } from '../utils/timezone';
import { recordAudit } from './audit.service';

export interface RequestCallbackInput {
  familyId?: string;
  familyMemberId: string;
  doseInstanceId: string;
  sourceCallLogId?: string;
  delayMinutes: number;
  reason: string;
  patientConfirmed?: boolean;
  actorType?: 'USER' | 'VOICE_AGENT';
  actorId?: string;
}

export async function requestSmartCallback(input: RequestCallbackInput) {
  if (!Number.isFinite(input.delayMinutes) || input.delayMinutes < 1 || input.delayMinutes > 120) {
    throw new ValidationError('Callback delayMinutes must be between 1 and 120 minutes');
  }

  const dose = await DoseInstance.findOne({
    _id: new Types.ObjectId(input.doseInstanceId),
    familyMemberId: new Types.ObjectId(input.familyMemberId),
    ...(input.familyId ? { familyId: new Types.ObjectId(input.familyId) } : {}),
  });
  if (!dose) {
    throw new NotFoundError('Dose instance for patient');
  }

  const [family, member, medicine] = await Promise.all([
    Family.findById(dose.familyId).lean(),
    FamilyMember.findOne({ _id: dose.familyMemberId, familyId: dose.familyId }),
    Medicine.findOne({ _id: dose.medicineId, familyId: dose.familyId }),
  ]);

  if (!member || !member.isActive) {
    throw new ForbiddenError('Cannot schedule callback for an inactive family member');
  }
  if (member.voiceCallingConsentStatus !== 'GRANTED') {
    throw new ForbiddenError('Voice calling consent is not granted for this family member');
  }
  if (!medicine || !medicine.isActive) {
    throw new ForbiddenError('Medicine prescription is inactive');
  }
  if (medicine.endDate && medicine.endDate < new Date()) {
    throw new ForbiddenError('Medicine prescription has expired');
  }
  if (dose.status === 'PATIENT_REPORTED_TAKEN') {
    throw new ConflictError('Dose is already confirmed taken; callback is unnecessary');
  }

  if (input.sourceCallLogId) {
    const callLog = await CallLog.findOne({
      _id: new Types.ObjectId(input.sourceCallLogId),
      familyId: dose.familyId,
      familyMemberId: member._id,
    }).lean();
    if (!callLog) {
      throw new ForbiddenError('sourceCallLogId does not match this patient');
    }
  }

  // Prevent duplicate active callbacks for the same dose
  const activeExisting = await Callback.findOne({
    doseInstanceId: dose._id,
    status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
  }).lean();
  if (activeExisting) {
    throw new ConflictError(
      'An active callback is already scheduled for this dose. Cancel or complete it before creating another.'
    );
  }

  // Respect retry limits
  const totalPreviousCallbacks = await Callback.countDocuments({
    doseInstanceId: dose._id,
  });
  const maxRetries = Math.min(
    family?.settings?.maxCallbackRetries ?? 3,
    (member.callingPreferences?.maxRetries ?? 2) + 1
  );

  if (totalPreviousCallbacks >= maxRetries) {
    throw new ConflictError(
      `Callback retry limit (${maxRetries}) reached for this dose. Escalating to family caregivers.`
    );
  }

  const attemptNumber = totalPreviousCallbacks + 1;
  const scheduledFor = addMinutesUtc(new Date(), input.delayMinutes);
  const idempotencyKey = `cb:${String(dose._id)}:attempt:${attemptNumber}:${crypto.randomUUID().slice(0, 8)}`;
  const jobKey = `dose:${String(dose._id)}:type:CALLBACK:attempt:${attemptNumber}`;

  const result = await withOptionalTransaction(async (session) => {
    const [callback] = await Callback.create(
      [
        {
          familyId: dose.familyId,
          familyMemberId: member._id,
          medicineId: medicine._id,
          doseInstanceId: dose._id,
          sourceCallLogId: input.sourceCallLogId
            ? new Types.ObjectId(input.sourceCallLogId)
            : undefined,
          reason: input.reason.trim(),
          requestedDelayMinutes: input.delayMinutes,
          scheduledFor,
          status: input.patientConfirmed === false ? 'REQUESTED' : 'SCHEDULED',
          attemptNumber,
          maxRetries,
          idempotencyKey,
          validationNotes: 'Validated active member, medicine, consent & retry budget',
        },
      ],
      session ? { session } : undefined
    );

    const [callSchedule] = await CallSchedule.create(
      [
        {
          familyId: dose.familyId,
          familyMemberId: member._id,
          medicineId: medicine._id,
          doseInstanceId: dose._id,
          callbackId: callback._id,
          callType: 'CALLBACK',
          scheduledFor,
          status: 'QUEUED',
          jobKey,
          attemptNumber,
          maxAttempts: maxRetries,
        },
      ],
      session ? { session } : undefined
    );

    // Explicitly set CALLBACK_REQUESTED & NEVER mark medicine as taken!
    dose.status = 'CALLBACK_REQUESTED';
    if (input.reason.toLowerCase().includes('meal') || input.reason.toLowerCase().includes('eat')) {
      dose.mealStatus = 'NOT_FINISHED';
    }
    await dose.save(session ? { session } : undefined);

    return { callback, callSchedule };
  });

  await enqueueCallJob(
    {
      callScheduleId: String(result.callSchedule._id),
      jobKey: result.callSchedule.jobKey,
      familyId: String(dose.familyId),
      callType: 'CALLBACK',
    },
    result.callSchedule.scheduledFor
  );

  await recordAudit({
    familyId: dose.familyId,
    actorType: input.actorType ?? 'VOICE_AGENT',
    actorId: input.actorId ?? String(member._id),
    action: 'CALLBACK_SCHEDULED',
    resourceType: 'Callback',
    resourceId: String(result.callback._id),
    metadata: {
      delayMinutes: input.delayMinutes,
      attemptNumber,
      scheduledFor: scheduledFor.toISOString(),
    },
  });

  return result.callback;
}

/**
 * Re-validates a callback right before placing the telephone call.
 */
export async function verifyCallbackBeforeCall(
  callbackId: string | Types.ObjectId
): Promise<{ valid: boolean; reason?: string; callback?: ICallback }> {
  const callback = await Callback.findById(callbackId);
  if (!callback) return { valid: false, reason: 'Callback not found' };

  if (!['CONFIRMED', 'SCHEDULED', 'REQUESTED'].includes(callback.status)) {
    return { valid: false, reason: `Callback status is ${callback.status}`, callback };
  }

  const [member, medicine, dose] = await Promise.all([
    FamilyMember.findById(callback.familyMemberId).lean(),
    Medicine.findById(callback.medicineId).lean(),
    DoseInstance.findById(callback.doseInstanceId).lean(),
  ]);

  if (!member || !member.isActive) {
    return { valid: false, reason: 'Family member is inactive', callback };
  }
  if (member.voiceCallingConsentStatus !== 'GRANTED') {
    return { valid: false, reason: 'Voice calling consent is revoked/denied', callback };
  }
  if (!medicine || !medicine.isActive || (medicine.endDate && medicine.endDate < new Date())) {
    return { valid: false, reason: 'Medicine prescription is inactive or expired', callback };
  }
  if (!dose || dose.status === 'PATIENT_REPORTED_TAKEN') {
    return { valid: false, reason: 'Dose already confirmed taken', callback };
  }

  return { valid: true, callback };
}

export async function listCallbacks(
  familyId: string,
  filters?: { status?: string; familyMemberId?: string }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.status) query.status = filters.status;
  if (filters?.familyMemberId) {
    query.familyMemberId = new Types.ObjectId(filters.familyMemberId);
  }

  return Callback.find(query)
    .populate('familyMemberId', 'fullName phoneNumber preferredLanguage')
    .populate('medicineId', 'name dosage')
    .populate('doseInstanceId', 'slotLabel scheduledAt status mealStatus')
    .sort({ scheduledFor: -1 })
    .limit(100)
    .lean();
}

export async function cancelCallback(
  familyId: string,
  callbackId: string,
  actorUserId: string
) {
  const callback = await Callback.findOne({
    _id: new Types.ObjectId(callbackId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!callback) throw new NotFoundError('Callback');

  if (!['REQUESTED', 'CONFIRMED', 'SCHEDULED'].includes(callback.status)) {
    throw new ConflictError(`Cannot cancel callback in status ${callback.status}`);
  }

  callback.status = 'CANCELLED';
  callback.validationNotes = 'Cancelled by family caregiver';
  await callback.save();

  const jobs = await CallSchedule.find({
    callbackId: callback._id,
    status: 'QUEUED',
  });
  for (const job of jobs) {
    job.status = 'CANCELLED';
    job.failureReason = 'Parent callback cancelled';
    await job.save();
    await removeCallJob(job.jobKey);
  }

  await DoseInstance.findOneAndUpdate(
    { _id: callback.doseInstanceId, status: 'CALLBACK_REQUESTED' },
    { status: 'UNCONFIRMED' }
  );

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'CALLBACK_CANCELLED',
    resourceType: 'Callback',
    resourceId: callbackId,
  });

  return callback;
}

