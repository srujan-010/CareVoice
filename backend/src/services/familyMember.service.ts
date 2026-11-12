import mongoose, { Types } from 'mongoose';
import { withOptionalTransaction } from '../config/database';
import { LANGUAGE_CODES } from '../constants/languages';
import {
  CONSENT_TYPES,
  ConsentStatus,
  ConsentType,
  DOSE_STATUSES,
  normalizeConsentTypeInput,
} from '../constants/statuses';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { Callback } from '../models/Callback';
import { Consent } from '../models/Consent';
import { Conversation } from '../models/Conversation';
import { FamilyMember, ICallingPreferences, IEmergencyContact } from '../models/FamilyMember';
import { Recording } from '../models/Recording';
import { removeCallJob } from '../queues/queueManager';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { normalizeAndValidateE164 } from '../utils/phone';
import { isValidTimezone } from '../utils/timezone';
import { recordAudit } from './audit.service';

export interface CreateFamilyMemberInput {
  fullName: string;
  phoneNumber: string;
  age?: number;
  preferredLanguage: string;
  timezone: string;
  relationship: string;
  emergencyContact: IEmergencyContact;
  callingPreferences?: Partial<ICallingPreferences>;
  recordingConsentStatus?: ConsentStatus;
  transcriptConsentStatus?: ConsentStatus;
  voiceCallingConsentStatus?: ConsentStatus;
  isActive?: boolean;
  notes?: string;
}

export type UpdateFamilyMemberInput = Partial<CreateFamilyMemberInput>;

function normalizePhone(phone: string): string {
  return normalizeAndValidateE164(phone, 'Phone number');
}

async function cancelPendingMemberCallsAndCallbacks(
  familyId: string,
  memberId: Types.ObjectId,
  reason: string
): Promise<void> {
  const jobs = await CallSchedule.find({
    familyId: new Types.ObjectId(familyId),
    familyMemberId: memberId,
    status: 'QUEUED',
  });

  for (const job of jobs) {
    job.status = 'CANCELLED';
    job.failureReason = reason;
    await job.save();
    await removeCallJob(job.jobKey);
  }

  await Callback.updateMany(
    {
      familyId: new Types.ObjectId(familyId),
      familyMemberId: memberId,
      status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
    },
    {
      $set: {
        status: 'CANCELLED',
        validationNotes: reason,
      },
    }
  );
}

/**
 * Enforces CareVoice's strict Consent Revocation & Retention Policy:
 * - Revoking/denying VOICE_CALLING cancels pending calls & callbacks.
 * - Revoking/denying CALL_TRANSCRIPT purges stored verbatim turns and sensitive variables from Conversation & CallLog.
 * - Revoking/denying CALL_RECORDING deletes stored Recording records & marks CallLogs CONSENT_DENIED.
 */
async function applyConsentRetentionPolicy(params: {
  familyId: string;
  memberId: Types.ObjectId;
  consentType: ConsentType;
  newStatus: ConsentStatus;
  consentId?: Types.ObjectId;
  actorUserId: string;
  ipAddress?: string;
}): Promise<void> {
  const { familyId, memberId, consentType, newStatus, consentId, actorUserId, ipAddress } = params;
  const familyObjId = new Types.ObjectId(familyId);

  if (consentType === 'VOICE_CALLING' && newStatus !== 'GRANTED') {
    await cancelPendingMemberCallsAndCallbacks(
      familyId,
      memberId,
      `Voice calling consent ${newStatus.toLowerCase()}`
    );
    return;
  }

  if (newStatus !== 'REVOKED' && newStatus !== 'DENIED') {
    return;
  }

  const now = new Date();

  if (consentType === 'CALL_TRANSCRIPT') {
    const convRes = await Conversation.updateMany(
      { familyId: familyObjId, familyMemberId: memberId },
      {
        $set: {
          turns: [],
          aiSummary: `[Conversation transcript purged: CALL_TRANSCRIPT consent ${newStatus.toLowerCase()}]`,
        },
        $unset: {
          finalAgentVariables: 1,
        },
        $addToSet: {
          safetyFlags: 'TRANSCRIPT_DELETED_CONSENT_REVOKED',
        },
      }
    );

    await CallLog.updateMany(
      { familyId: familyObjId, familyMemberId: memberId },
      {
        $set: {
          transcriptConsentGranted: false,
          transcriptAvailable: false,
          transcriptStatus: 'CONSENT_DENIED',
        },
      }
    );

    if (consentId) {
      await Consent.updateOne({ _id: consentId }, { $set: { retentionPolicyAppliedAt: now } });
    }

    await recordAudit({
      familyId,
      actorType: 'USER',
      actorId: actorUserId,
      action: 'CONSENT_RETENTION_TRANSCRIPT_PURGED',
      resourceType: 'FamilyMember',
      resourceId: String(memberId),
      ipAddress,
      metadata: {
        consentType,
        status: newStatus,
        conversationsRedacted: convRes.modifiedCount,
      },
    });
  } else if (consentType === 'CALL_RECORDING') {
    const delRes = await Recording.deleteMany({
      familyId: familyObjId,
      familyMemberId: memberId,
    });

    await CallLog.updateMany(
      { familyId: familyObjId, familyMemberId: memberId },
      {
        $set: {
          recordingConsentGranted: false,
          audioRecordingConsentGranted: false,
          recordingStatus: 'CONSENT_DENIED',
          recordingNote: `Audio recording deleted/withheld per CALL_RECORDING consent ${newStatus.toLowerCase()}.`,
        },
      }
    );

    if (consentId) {
      await Consent.updateOne({ _id: consentId }, { $set: { retentionPolicyAppliedAt: now } });
    }

    await recordAudit({
      familyId,
      actorType: 'USER',
      actorId: actorUserId,
      action: 'CONSENT_RETENTION_RECORDING_PURGED',
      resourceType: 'FamilyMember',
      resourceId: String(memberId),
      ipAddress,
      metadata: {
        consentType,
        status: newStatus,
        recordingsDeleted: delRes.deletedCount,
      },
    });
  }
}

export async function listFamilyMembers(
  familyId: string,
  filters?: { isActive?: boolean; search?: string }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.isActive !== undefined) {
    query.isActive = filters.isActive;
  }
  if (filters?.search?.trim()) {
    const regex = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ fullName: regex }, { phoneNumber: regex }, { relationship: regex }];
  }

  const members = await FamilyMember.find(query).sort({ createdAt: -1 }).lean();

  // Enrich with active medicine counts when Medicine model is registered (Stage 2+)
  const MedicineModel = mongoose.models.Medicine;
  let medCountsByMember = new Map<string, number>();

  if (MedicineModel && members.length > 0) {
    const agg = await MedicineModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          familyId: new Types.ObjectId(familyId),
          isActive: true,
        },
      },
      { $group: { _id: '$familyMemberId', count: { $sum: 1 } } },
    ]);
    medCountsByMember = new Map(agg.map((item) => [String(item._id), item.count]));
  }

  return members.map((m) => ({
    ...m,
    id: String(m._id),
    activeMedicineCount: medCountsByMember.get(String(m._id)) ?? 0,
  }));
}

export async function createFamilyMember(
  familyId: string,
  actorUserId: string,
  actorName: string,
  input: CreateFamilyMemberInput,
  ipAddress?: string
) {
  const normalizedPhone = normalizePhone(input.phoneNumber);
  const emergencyPhone = normalizePhone(input.emergencyContact.phoneNumber);

  if (!isValidTimezone(input.timezone)) {
    throw new ValidationError(`Invalid IANA timezone: ${input.timezone}`);
  }
  if (!LANGUAGE_CODES.includes(input.preferredLanguage)) {
    throw new ValidationError(`Unsupported preferred language: ${input.preferredLanguage}`);
  }

  const existing = await FamilyMember.findOne({
    familyId: new Types.ObjectId(familyId),
    phoneNumber: normalizedPhone,
  }).lean();
  if (existing) {
    throw new ConflictError('A family member with this phone number already exists');
  }

  const recordingConsent: ConsentStatus = input.recordingConsentStatus ?? 'PENDING';
  const transcriptConsent: ConsentStatus = input.transcriptConsentStatus ?? 'PENDING';
  const callingConsent: ConsentStatus = input.voiceCallingConsentStatus ?? 'GRANTED';

  const member = await withOptionalTransaction(async (session) => {
    const [created] = await FamilyMember.create(
      [
        {
          familyId: new Types.ObjectId(familyId),
          fullName: input.fullName.trim(),
          phoneNumber: normalizedPhone,
          age: input.age,
          preferredLanguage: input.preferredLanguage,
          timezone: input.timezone,
          relationship: input.relationship.trim(),
          emergencyContact: {
            name: input.emergencyContact.name.trim(),
            phoneNumber: emergencyPhone,
            relationship: input.emergencyContact.relationship.trim(),
          },
          callingPreferences: {
            quietHoursStart: input.callingPreferences?.quietHoursStart ?? '22:00',
            quietHoursEnd: input.callingPreferences?.quietHoursEnd ?? '06:30',
            maxRetries: input.callingPreferences?.maxRetries ?? 2,
            retryIntervalMinutes: input.callingPreferences?.retryIntervalMinutes ?? 10,
            allowMealReminders: input.callingPreferences?.allowMealReminders ?? true,
            allowMedicineReminders: input.callingPreferences?.allowMedicineReminders ?? true,
            allowConfirmationCalls: input.callingPreferences?.allowConfirmationCalls ?? true,
            preferredVoiceGender: input.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
          },
          recordingConsentStatus: recordingConsent,
          transcriptConsentStatus: transcriptConsent,
          voiceCallingConsentStatus: callingConsent,
          isActive: input.isActive ?? true,
          notes: input.notes?.trim(),
        },
      ],
      session ? { session } : undefined
    );

    const now = new Date();
    const consentDocs = CONSENT_TYPES.map((consentType) => {
      const status: ConsentStatus =
        consentType === 'CALL_RECORDING'
          ? recordingConsent
          : consentType === 'CALL_TRANSCRIPT'
            ? transcriptConsent
            : consentType === 'VOICE_CALLING'
              ? callingConsent
              : 'PENDING';
      return {
        familyId: new Types.ObjectId(familyId),
        familyMemberId: created._id,
        consentType,
        status,
        consentVersion: 'v1.0',
        grantedAt: status === 'GRANTED' ? now : undefined,
        revokedAt: status === 'REVOKED' || status === 'DENIED' ? now : undefined,
        grantedByUserId: new Types.ObjectId(actorUserId),
        grantedByName: actorName,
        method: 'DASHBOARD' as const,
      };
    });

    await Consent.insertMany(consentDocs, session ? { session } : {});
    return created;
  });

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'FAMILY_MEMBER_CREATED',
    resourceType: 'FamilyMember',
    resourceId: String(member._id),
    ipAddress,
    metadata: { preferredLanguage: member.preferredLanguage, timezone: member.timezone },
  });

  return {
    ...member.toObject(),
    id: String(member._id),
  };
}

export async function getFamilyMemberById(familyId: string, memberId: string) {
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(memberId),
    familyId: new Types.ObjectId(familyId),
  }).lean();

  if (!member) {
    throw new NotFoundError('Family member');
  }

  const consents = await Consent.find({
    familyId: new Types.ObjectId(familyId),
    familyMemberId: member._id,
  }).lean();

  const consentTypesPresent = new Set(consents.map((c) => c.consentType));
  const normalizedConsents = [...consents];
  if (!consentTypesPresent.has('CALL_TRANSCRIPT')) {
    normalizedConsents.push({
      _id: member._id,
      familyId: member.familyId,
      familyMemberId: member._id,
      consentType: 'CALL_TRANSCRIPT',
      status: member.transcriptConsentStatus ?? 'PENDING',
      consentVersion: 'v1.0',
      method: 'DASHBOARD',
    } as never);
  }

  return {
    ...member,
    transcriptConsentStatus: member.transcriptConsentStatus ?? 'PENDING',
    id: String(member._id),
    consents: normalizedConsents,
  };
}

export async function getFamilyMemberProfile(familyId: string, memberId: string) {
  const member = await getFamilyMemberById(familyId, memberId);

  const MedicineModel = mongoose.models.Medicine;
  const DoseInstanceModel = mongoose.models.DoseInstance;
  const CallLogModel = mongoose.models.CallLog;

  const [medicines, doseHistory, callHistory] = await Promise.all([
    MedicineModel
      ? MedicineModel.find({
          familyId: new Types.ObjectId(familyId),
          familyMemberId: new Types.ObjectId(memberId),
        })
          .sort({ isActive: -1, createdAt: -1 })
          .lean()
      : Promise.resolve([]),
    DoseInstanceModel
      ? DoseInstanceModel.find({
          familyId: new Types.ObjectId(familyId),
          familyMemberId: new Types.ObjectId(memberId),
        })
          .populate('medicineId', 'name dosage')
          .sort({ scheduledAt: -1 })
          .limit(50)
          .lean()
      : Promise.resolve([]),
    CallLogModel
      ? CallLogModel.find({
          familyId: new Types.ObjectId(familyId),
          familyMemberId: new Types.ObjectId(memberId),
        })
          .populate('medicineId', 'name dosage')
          .sort({ createdAt: -1 })
          .limit(30)
          .lean()
      : Promise.resolve([]),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const st of DOSE_STATUSES) {
    statusCounts[st] = 0;
  }
  for (const dose of doseHistory as Array<{ status?: string }>) {
    if (dose.status) {
      statusCounts[dose.status] = (statusCounts[dose.status] ?? 0) + 1;
    }
  }

  const totalConfirmedOrMissed =
    statusCounts.PATIENT_REPORTED_TAKEN +
    statusCounts.PATIENT_REPORTED_NOT_TAKEN +
    statusCounts.UNCONFIRMED +
    statusCounts.ESCALATED;

  const adherenceRate =
    totalConfirmedOrMissed > 0
      ? Math.round((statusCounts.PATIENT_REPORTED_TAKEN / totalConfirmedOrMissed) * 100)
      : null;

  return {
    member,
    medicines,
    doseHistory,
    callHistory,
    adherenceSummary: {
      totalTrackedDoses: doseHistory.length,
      adherenceRate,
      breakdown: statusCounts,
    },
  };
}

export async function updateFamilyMember(
  familyId: string,
  memberId: string,
  actorUserId: string,
  actorName: string,
  input: UpdateFamilyMemberInput,
  ipAddress?: string
) {
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(memberId),
    familyId: new Types.ObjectId(familyId),
  });

  if (!member) {
    throw new NotFoundError('Family member');
  }

  if (input.timezone && !isValidTimezone(input.timezone)) {
    throw new ValidationError(`Invalid IANA timezone: ${input.timezone}`);
  }
  if (input.preferredLanguage && !LANGUAGE_CODES.includes(input.preferredLanguage)) {
    throw new ValidationError(`Unsupported preferred language: ${input.preferredLanguage}`);
  }

  if (input.phoneNumber) {
    const normalized = normalizePhone(input.phoneNumber);
    if (normalized !== member.phoneNumber) {
      const dup = await FamilyMember.findOne({
        familyId: new Types.ObjectId(familyId),
        phoneNumber: normalized,
        _id: { $ne: member._id },
      }).lean();
      if (dup) throw new ConflictError('Another family member already uses this phone number');
      member.phoneNumber = normalized;
    }
  }

  if (input.fullName !== undefined) member.fullName = input.fullName.trim();
  if (input.age !== undefined) member.age = input.age;
  if (input.preferredLanguage !== undefined) member.preferredLanguage = input.preferredLanguage;
  if (input.timezone !== undefined) member.timezone = input.timezone;
  if (input.relationship !== undefined) member.relationship = input.relationship.trim();
  if (input.notes !== undefined) member.notes = input.notes.trim();
  if (input.isActive !== undefined) member.isActive = input.isActive;

  if (input.emergencyContact) {
    member.emergencyContact = {
      name: input.emergencyContact.name?.trim() ?? member.emergencyContact.name,
      phoneNumber: input.emergencyContact.phoneNumber
        ? normalizePhone(input.emergencyContact.phoneNumber)
        : member.emergencyContact.phoneNumber,
      relationship:
        input.emergencyContact.relationship?.trim() ?? member.emergencyContact.relationship,
    };
  }

  if (input.callingPreferences) {
    member.callingPreferences = {
      ...member.callingPreferences,
      ...input.callingPreferences,
    };
  }

  const consentNow = new Date();

  if (input.recordingConsentStatus) {
    member.recordingConsentStatus = input.recordingConsentStatus;
    const recConsent = await Consent.findOneAndUpdate(
      { familyMemberId: member._id, consentType: 'CALL_RECORDING' },
      {
        status: input.recordingConsentStatus,
        consentVersion: 'v1.0',
        ...(input.recordingConsentStatus === 'GRANTED' ? { grantedAt: consentNow } : {}),
        ...(input.recordingConsentStatus === 'REVOKED' || input.recordingConsentStatus === 'DENIED'
          ? { revokedAt: consentNow }
          : {}),
        grantedByUserId: new Types.ObjectId(actorUserId),
        grantedByName: actorName,
        method: 'DASHBOARD',
      },
      { upsert: true, new: true }
    );
    await applyConsentRetentionPolicy({
      familyId,
      memberId: member._id as Types.ObjectId,
      consentType: 'CALL_RECORDING',
      newStatus: input.recordingConsentStatus,
      consentId: recConsent?._id as Types.ObjectId | undefined,
      actorUserId,
      ipAddress,
    });
  }

  if (input.transcriptConsentStatus) {
    member.transcriptConsentStatus = input.transcriptConsentStatus;
    const transConsent = await Consent.findOneAndUpdate(
      { familyMemberId: member._id, consentType: 'CALL_TRANSCRIPT' },
      {
        status: input.transcriptConsentStatus,
        consentVersion: 'v1.0',
        ...(input.transcriptConsentStatus === 'GRANTED' ? { grantedAt: consentNow } : {}),
        ...(input.transcriptConsentStatus === 'REVOKED' ||
        input.transcriptConsentStatus === 'DENIED'
          ? { revokedAt: consentNow }
          : {}),
        grantedByUserId: new Types.ObjectId(actorUserId),
        grantedByName: actorName,
        method: 'DASHBOARD',
      },
      { upsert: true, new: true }
    );
    await applyConsentRetentionPolicy({
      familyId,
      memberId: member._id as Types.ObjectId,
      consentType: 'CALL_TRANSCRIPT',
      newStatus: input.transcriptConsentStatus,
      consentId: transConsent?._id as Types.ObjectId | undefined,
      actorUserId,
      ipAddress,
    });
  }

  if (input.voiceCallingConsentStatus) {
    member.voiceCallingConsentStatus = input.voiceCallingConsentStatus;
    await Consent.findOneAndUpdate(
      { familyMemberId: member._id, consentType: 'VOICE_CALLING' },
      {
        status: input.voiceCallingConsentStatus,
        consentVersion: 'v1.0',
        ...(input.voiceCallingConsentStatus === 'GRANTED' ? { grantedAt: consentNow } : {}),
        ...(input.voiceCallingConsentStatus === 'REVOKED' ||
        input.voiceCallingConsentStatus === 'DENIED'
          ? { revokedAt: consentNow }
          : {}),
        grantedByUserId: new Types.ObjectId(actorUserId),
        grantedByName: actorName,
        method: 'DASHBOARD',
      },
      { upsert: true }
    );
  }

  await member.save();

  if (!member.isActive) {
    await cancelPendingMemberCallsAndCallbacks(
      familyId,
      member._id as Types.ObjectId,
      'Family member deactivated'
    );
  } else if (member.voiceCallingConsentStatus !== 'GRANTED') {
    await cancelPendingMemberCallsAndCallbacks(
      familyId,
      member._id as Types.ObjectId,
      `Voice calling consent ${member.voiceCallingConsentStatus.toLowerCase()}`
    );
  }

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'FAMILY_MEMBER_UPDATED',
    resourceType: 'FamilyMember',
    resourceId: String(member._id),
    ipAddress,
  });

  return {
    ...member.toObject(),
    id: String(member._id),
  };
}

export async function updateMemberConsent(
  familyId: string,
  memberId: string,
  actorUserId: string,
  actorName: string,
  payload: {
    consentType: ConsentType | string;
    status: ConsentStatus;
    method?: 'DASHBOARD' | 'VERBAL_CALL' | 'WRITTEN';
    notes?: string;
    consentVersion?: string;
  },
  ipAddress?: string
) {
  const normalizedConsentType = normalizeConsentTypeInput(String(payload.consentType));
  if (!normalizedConsentType) {
    throw new ValidationError(`Unsupported consentType: ${payload.consentType}`);
  }

  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(memberId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!member) throw new NotFoundError('Family member');

  const now = new Date();
  const consent = await Consent.findOneAndUpdate(
    {
      familyId: new Types.ObjectId(familyId),
      familyMemberId: member._id,
      consentType: normalizedConsentType,
    },
    {
      status: payload.status,
      consentVersion: payload.consentVersion || 'v1.0',
      ...(payload.status === 'GRANTED' ? { grantedAt: now } : {}),
      ...(payload.status === 'REVOKED' || payload.status === 'DENIED' ? { revokedAt: now } : {}),
      grantedByUserId: new Types.ObjectId(actorUserId),
      grantedByName: actorName,
      method: payload.method ?? 'DASHBOARD',
      notes: payload.notes,
    },
    { upsert: true, new: true }
  );

  if (normalizedConsentType === 'CALL_RECORDING') {
    member.recordingConsentStatus = payload.status;
    await member.save();
  } else if (normalizedConsentType === 'CALL_TRANSCRIPT') {
    member.transcriptConsentStatus = payload.status;
    await member.save();
  } else if (normalizedConsentType === 'VOICE_CALLING') {
    member.voiceCallingConsentStatus = payload.status;
    await member.save();
  }

  await applyConsentRetentionPolicy({
    familyId,
    memberId: member._id as Types.ObjectId,
    consentType: normalizedConsentType,
    newStatus: payload.status,
    consentId: consent._id as Types.ObjectId,
    actorUserId,
    ipAddress,
  });

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'MEMBER_CONSENT_UPDATED',
    resourceType: 'Consent',
    resourceId: String(consent._id),
    ipAddress,
    metadata: {
      consentType: normalizedConsentType,
      status: payload.status,
      consentVersion: consent.consentVersion,
    },
  });

  return consent;
}

export async function setFamilyMemberActiveStatus(
  familyId: string,
  memberId: string,
  actorUserId: string,
  isActive: boolean,
  ipAddress?: string
) {
  const member = await FamilyMember.findOneAndUpdate(
    { _id: new Types.ObjectId(memberId), familyId: new Types.ObjectId(familyId) },
    { isActive },
    { new: true }
  );
  if (!member) throw new NotFoundError('Family member');

  if (!isActive) {
    await cancelPendingMemberCallsAndCallbacks(
      familyId,
      member._id as Types.ObjectId,
      'Family member deactivated'
    );
  }

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: isActive ? 'FAMILY_MEMBER_ACTIVATED' : 'FAMILY_MEMBER_DEACTIVATED',
    resourceType: 'FamilyMember',
    resourceId: String(member._id),
    ipAddress,
  });

  return {
    ...member.toObject(),
    id: String(member._id),
  };
}

export async function deleteFamilyMember(
  familyId: string,
  memberId: string,
  actorUserId: string,
  ipAddress?: string
) {
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(memberId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!member) throw new NotFoundError('Family member');

  const jobsToRemove = await CallSchedule.find(
    {
      familyId: new Types.ObjectId(familyId),
      familyMemberId: member._id,
      status: 'QUEUED',
    },
    { jobKey: 1 }
  ).lean();

  await withOptionalTransaction(async (session) => {
    await Consent.deleteMany(
      { familyId: new Types.ObjectId(familyId), familyMemberId: member._id },
      session ? { session } : undefined
    );

    // Cancel/deactivate linked medicines & future queued calls if Stage 2 models exist
    const MedicineModel = mongoose.models.Medicine;
    const MedicineScheduleModel = mongoose.models.MedicineSchedule;
    const CallScheduleModel = mongoose.models.CallSchedule;

    if (MedicineModel) {
      await MedicineModel.updateMany(
        { familyId: new Types.ObjectId(familyId), familyMemberId: member._id },
        { isActive: false },
        session ? { session } : undefined
      );
    }
    if (MedicineScheduleModel) {
      await MedicineScheduleModel.updateMany(
        { familyId: new Types.ObjectId(familyId), familyMemberId: member._id },
        { isActive: false },
        session ? { session } : undefined
      );
    }
    if (CallScheduleModel) {
      await CallScheduleModel.updateMany(
        {
          familyId: new Types.ObjectId(familyId),
          familyMemberId: member._id,
          status: 'QUEUED',
        },
        { status: 'CANCELLED', failureReason: 'Family member deleted' },
        session ? { session } : undefined
      );
    }

    await Callback.updateMany(
      {
        familyId: new Types.ObjectId(familyId),
        familyMemberId: member._id,
        status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
      },
      { status: 'CANCELLED', validationNotes: 'Family member deleted' },
      session ? { session } : undefined
    );

    await member.deleteOne(session ? { session } : undefined);
  });

  for (const job of jobsToRemove) {
    await removeCallJob(job.jobKey);
  }

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'FAMILY_MEMBER_DELETED',
    resourceType: 'FamilyMember',
    resourceId: memberId,
    ipAddress,
    metadata: { fullName: member.fullName },
  });

  return { deleted: true, id: memberId };
}
