import { ClientSession, Types } from 'mongoose';
import {
  EscalationReason,
  EscalationSeverity,
  EscalationStatus,
  NotificationTrigger,
} from '../constants/statuses';
import { DoseInstance } from '../models/DoseInstance';
import { Escalation } from '../models/Escalation';
import { FamilyMember } from '../models/FamilyMember';
import { NotFoundError } from '../utils/errors';
import { recordAudit } from './audit.service';
import { dispatchFamilyAlert } from './notification.service';

const REASON_TO_TRIGGER: Record<EscalationReason, NotificationTrigger> = {
  REPEATED_NO_ANSWER: 'REPEATED_NO_ANSWER',
  MEDICINE_UNCONFIRMED: 'UNCONFIRMED_MEDICINE',
  PATIENT_FORGOT: 'FORGOT_MEDICINE',
  PATIENT_REQUESTED_HELP: 'HELP_REQUESTED',
  PATIENT_FEELING_UNWELL: 'FEELING_UNWELL',
  EMERGENCY: 'EMERGENCY_ESCALATION',
};

export async function createEscalation(
  input: {
    familyId: string | Types.ObjectId;
    familyMemberId: string | Types.ObjectId;
    doseInstanceId?: string | Types.ObjectId;
    callLogId?: string | Types.ObjectId;
    reason: EscalationReason;
    severity?: EscalationSeverity;
    description: string;
  },
  session?: ClientSession
) {
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(String(input.familyMemberId)),
    familyId: new Types.ObjectId(String(input.familyId)),
  }).lean();
  if (!member) throw new NotFoundError('Family member');

  const severity: EscalationSeverity =
    input.severity ??
    (input.reason === 'EMERGENCY' || input.reason === 'PATIENT_FEELING_UNWELL'
      ? 'CRITICAL'
      : input.reason === 'PATIENT_REQUESTED_HELP'
        ? 'HIGH'
        : 'MEDIUM');

  const [escalation] = await Escalation.create(
    [
      {
        familyId: new Types.ObjectId(String(input.familyId)),
        familyMemberId: member._id,
        doseInstanceId: input.doseInstanceId
          ? new Types.ObjectId(String(input.doseInstanceId))
          : undefined,
        callLogId: input.callLogId ? new Types.ObjectId(String(input.callLogId)) : undefined,
        reason: input.reason,
        severity,
        status: 'OPEN',
        description: input.description.trim(),
      },
    ],
    session ? { session } : undefined
  );

  if (input.doseInstanceId) {
    await DoseInstance.findOneAndUpdate(
      {
        _id: new Types.ObjectId(String(input.doseInstanceId)),
        familyId: new Types.ObjectId(String(input.familyId)),
        status: { $ne: 'PATIENT_REPORTED_TAKEN' },
      },
      { status: 'ESCALATED' },
      session ? { session } : undefined
    );
  }

  await dispatchFamilyAlert(
    {
      familyId: input.familyId,
      familyMemberId: member._id,
      doseInstanceId: input.doseInstanceId,
      callLogId: input.callLogId,
      escalationId: escalation._id as Types.ObjectId,
      triggerType: REASON_TO_TRIGGER[input.reason],
      title: `[${severity}] ${member.fullName}: ${input.reason.replace(/_/g, ' ')}`,
      message: input.description,
    },
    session
  );

  return escalation;
}

export async function listEscalations(familyId: string, status?: EscalationStatus) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (status) query.status = status;

  return Escalation.find(query)
    .populate('familyMemberId', 'fullName phoneNumber relationship emergencyContact')
    .populate('doseInstanceId', 'scheduledAt slotLabel status')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function updateEscalationStatus(
  familyId: string,
  escalationId: string,
  actorUserId: string,
  payload: { status: EscalationStatus; resolutionNotes?: string }
) {
  const esc = await Escalation.findOne({
    _id: new Types.ObjectId(escalationId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!esc) throw new NotFoundError('Escalation');

  esc.status = payload.status;
  if (payload.status === 'ACKNOWLEDGED') {
    esc.acknowledgedByUserId = new Types.ObjectId(actorUserId);
  }
  if (payload.status === 'RESOLVED' || payload.status === 'DISMISSED') {
    esc.resolvedByUserId = new Types.ObjectId(actorUserId);
    esc.resolvedAt = new Date();
  }
  if (payload.resolutionNotes !== undefined) {
    esc.resolutionNotes = payload.resolutionNotes.trim();
  }

  await esc.save();

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'ESCALATION_UPDATED',
    resourceType: 'Escalation',
    resourceId: escalationId,
    metadata: { status: esc.status },
  });

  return esc;
}

