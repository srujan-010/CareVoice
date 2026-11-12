import { Types } from 'mongoose';
import { getLanguageMeta } from '../constants/languages';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { DoseInstance } from '../models/DoseInstance';
import { FamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';

export const MEDICAL_SAFETY_DIRECTIVES = [
  'You are CareVoice, a gentle multilingual family medicine reminder assistant.',
  'Never prescribe medicines, adjust dosages, suggest extra doses, or alter prescriptions.',
  'Never assume a medicine was taken simply because the patient answered the call.',
  'Never mark medicine as taken when the patient only confirms finishing a meal.',
  'If the patient reports feeling unwell or requests help, immediately escalate to family contacts.',
];

export interface ResolveDoseContextInput {
  familyMemberId: string;
  doseInstanceId: string;
  callLogId?: string;
  callScheduleId?: string;
  scopedFamilyId?: string; // present when invoked via caregiver JWT
  requireActiveCallBinding: boolean; // true when invoked via voice-agent service token
}

export async function resolveValidatedDoseContext(input: ResolveDoseContextInput) {
  if (!Types.ObjectId.isValid(input.familyMemberId) || !Types.ObjectId.isValid(input.doseInstanceId)) {
    throw new ValidationError('Invalid familyMemberId or doseInstanceId');
  }

  let verifiedFamilyId = input.scopedFamilyId;

  if (input.requireActiveCallBinding) {
    if (!input.callLogId && !input.callScheduleId) {
      throw new ForbiddenError(
        'Active callLogId or callScheduleId binding is required to access patient dose context'
      );
    }

    if (input.callLogId) {
      if (!Types.ObjectId.isValid(input.callLogId)) {
        throw new ValidationError('Invalid callLogId');
      }
      const callLog = await CallLog.findById(input.callLogId).lean();
      if (!callLog) throw new NotFoundError('Call log');
      if (
        String(callLog.familyMemberId) !== input.familyMemberId ||
        (callLog.doseInstanceId && String(callLog.doseInstanceId) !== input.doseInstanceId)
      ) {
        throw new ForbiddenError('Call log does not match the requested patient and dose');
      }
      verifiedFamilyId = String(callLog.familyId);
    }

    if (input.callScheduleId) {
      if (!Types.ObjectId.isValid(input.callScheduleId)) {
        throw new ValidationError('Invalid callScheduleId');
      }
      const callSchedule = await CallSchedule.findById(input.callScheduleId).lean();
      if (!callSchedule) throw new NotFoundError('Call schedule');
      if (
        String(callSchedule.familyMemberId) !== input.familyMemberId ||
        String(callSchedule.doseInstanceId) !== input.doseInstanceId
      ) {
        throw new ForbiddenError('Call schedule does not match the requested patient and dose');
      }
      verifiedFamilyId = String(callSchedule.familyId);
    }
  }

  const doseQuery: Record<string, unknown> = {
    _id: new Types.ObjectId(input.doseInstanceId),
    familyMemberId: new Types.ObjectId(input.familyMemberId),
  };
  if (verifiedFamilyId) {
    doseQuery.familyId = new Types.ObjectId(verifiedFamilyId);
  }

  const dose = await DoseInstance.findOne(doseQuery).lean();
  if (!dose) {
    throw new NotFoundError('Dose instance for the specified patient');
  }

  const [member, medicine] = await Promise.all([
    FamilyMember.findOne({
      _id: dose.familyMemberId,
      familyId: dose.familyId,
    }).lean(),
    Medicine.findOne({
      _id: dose.medicineId,
      familyId: dose.familyId,
    }).lean(),
  ]);

  if (!member) throw new NotFoundError('Family member');
  if (!medicine) throw new NotFoundError('Medicine');

  if (!member.isActive) {
    throw new ForbiddenError('Family member profile is inactive');
  }

  const langMeta = getLanguageMeta(member.preferredLanguage);

  return {
    familyId: String(dose.familyId),
    patient: {
      id: String(member._id),
      fullName: member.fullName,
      phoneNumber: member.phoneNumber,
      preferredLanguage: langMeta.code,
      languageName: langMeta.name,
      languageBcp47: langMeta.bcp47,
      timezone: member.timezone,
      recordingConsentStatus: member.recordingConsentStatus,
      transcriptConsentStatus: member.transcriptConsentStatus ?? 'PENDING',
      voiceCallingConsentStatus: member.voiceCallingConsentStatus,
      voiceGender: member.callingPreferences?.preferredVoiceGender ?? 'FEMALE',
    },
    medicine: {
      id: String(medicine._id),
      name: medicine.name,
      dosage: medicine.dosage,
      prescribedInstructions: medicine.prescribedInstructions,
      foodInstruction: dose.foodInstruction,
      customFoodInstruction: dose.customFoodInstruction,
      associatedMeal: dose.associatedMeal,
      customMealName: dose.customMealName,
      isActive: medicine.isActive,
    },
    dose: {
      id: String(dose._id),
      scheduledDateLocal: dose.scheduledDateLocal,
      slotLabel: dose.slotLabel,
      scheduledAt: dose.scheduledAt,
      mealStatus: dose.mealStatus,
      status: dose.status,
    },
    safetyDirectives: MEDICAL_SAFETY_DIRECTIVES,
  };
}

