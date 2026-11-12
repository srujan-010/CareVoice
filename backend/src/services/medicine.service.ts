import { Types } from 'mongoose';
import { withOptionalTransaction } from '../config/database';
import {
  AssociatedMeal,
  DoseStatus,
  FoodInstruction,
  MealStatus,
  MedicineFrequency,
} from '../constants/statuses';
import { CallLog } from '../models/CallLog';
import { CallSchedule } from '../models/CallSchedule';
import { Callback } from '../models/Callback';
import { DoseInstance } from '../models/DoseInstance';
import { FamilyMember } from '../models/FamilyMember';
import { IScheduledTimeSlot, Medicine } from '../models/Medicine';
import { MedicineSchedule } from '../models/MedicineSchedule';
import { enqueueCallJob } from '../queues/queueManager';
import { NotFoundError, ValidationError } from '../utils/errors';
import { getLocalDateString } from '../utils/timezone';
import { recordAudit } from './audit.service';
import {
  cancelQueuedJobsForDose,
  cancelQueuedJobsForMedicine,
  generateDosesForFamily,
  generateDosesForSchedule,
} from './scheduleEngine.service';

export interface CreateMedicineInput {
  familyMemberId: string;
  name: string;
  dosage: string;
  prescribedInstructions: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  startDate: string;
  endDate?: string;
  frequency: MedicineFrequency;
  scheduledTimes: IScheduledTimeSlot[];
  prescribingDoctor?: string;
  notes?: string;
  isActive?: boolean;
}

export type UpdateMedicineInput = Omit<Partial<CreateMedicineInput>, 'endDate'> & {
  endDate?: string | null;
};

async function enqueueQueuedCallsForMedicine(medicineId: Types.ObjectId) {
  const jobs = await CallSchedule.find({
    medicineId,
    status: 'QUEUED',
  }).lean();

  for (const job of jobs) {
    await enqueueCallJob(
      {
        callScheduleId: String(job._id),
        jobKey: job.jobKey,
        familyId: String(job.familyId),
        callType: job.callType,
      },
      job.scheduledFor
    );
  }
}

export async function listMedicines(
  familyId: string,
  filters?: { familyMemberId?: string; isActive?: boolean; search?: string }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.familyMemberId) {
    query.familyMemberId = new Types.ObjectId(filters.familyMemberId);
  }
  if (filters?.isActive !== undefined) {
    query.isActive = filters.isActive;
  }
  if (filters?.search?.trim()) {
    const regex = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { dosage: regex }, { prescribingDoctor: regex }];
  }

  const medicines = await Medicine.find(query)
    .populate('familyMemberId', 'fullName preferredLanguage timezone relationship')
    .sort({ isActive: -1, createdAt: -1 })
    .lean();

  return medicines.map((m) => ({
    ...m,
    id: String(m._id),
  }));
}

export async function getMedicineById(familyId: string, medicineId: string) {
  const medicine = await Medicine.findOne({
    _id: new Types.ObjectId(medicineId),
    familyId: new Types.ObjectId(familyId),
  })
    .populate('familyMemberId', 'fullName preferredLanguage timezone relationship')
    .lean();

  if (!medicine) throw new NotFoundError('Medicine');

  const schedules = await MedicineSchedule.find({
    medicineId: medicine._id,
    familyId: new Types.ObjectId(familyId),
  })
    .sort({ slotIndex: 1 })
    .lean();

  return {
    ...medicine,
    id: String(medicine._id),
    schedules,
  };
}

export async function createMedicine(
  familyId: string,
  actorUserId: string,
  input: CreateMedicineInput,
  ipAddress?: string
) {
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(input.familyMemberId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!member) throw new NotFoundError('Family member');

  const startDate = new Date(input.startDate);
  const endDate = input.endDate ? new Date(input.endDate) : undefined;
  if (Number.isNaN(startDate.getTime())) {
    throw new ValidationError('Invalid startDate');
  }
  if (endDate && (Number.isNaN(endDate.getTime()) || endDate < startDate)) {
    throw new ValidationError('endDate must be on or after startDate');
  }

  const createdMedicine = await withOptionalTransaction(async (session) => {
    const [med] = await Medicine.create(
      [
        {
          familyId: new Types.ObjectId(familyId),
          familyMemberId: member._id,
          name: input.name.trim(),
          dosage: input.dosage.trim(),
          prescribedInstructions: input.prescribedInstructions.trim(),
          foodInstruction: input.foodInstruction,
          customFoodInstruction: input.customFoodInstruction?.trim(),
          associatedMeal: input.associatedMeal,
          customMealName: input.customMealName?.trim(),
          startDate,
          endDate,
          frequency: input.frequency,
          scheduledTimes: input.scheduledTimes,
          prescribingDoctor: input.prescribingDoctor?.trim(),
          notes: input.notes?.trim(),
          isActive: input.isActive ?? true,
        },
      ],
      session ? { session } : undefined
    );

    const scheduleDocs = input.scheduledTimes.map((slot, idx) => ({
      familyId: new Types.ObjectId(familyId),
      familyMemberId: member._id,
      medicineId: med._id,
      slotIndex: idx,
      slotLabel: slot.slotLabel,
      timeOfDay: slot.timeOfDay,
      associatedMeal: slot.associatedMeal ?? input.associatedMeal,
      customMealName: slot.customMealName ?? input.customMealName,
      foodInstruction: slot.foodInstruction ?? input.foodInstruction,
      customFoodInstruction: slot.customFoodInstruction ?? input.customFoodInstruction,
      frequency: input.frequency,
      mealReminderOffsetMinutes: slot.mealReminderOffsetMinutes,
      medicineReminderOffsetMinutes: slot.medicineReminderOffsetMinutes ?? 0,
      confirmationOffsetMinutes: slot.confirmationOffsetMinutes,
      daysOfWeek: slot.daysOfWeek,
      intervalDays: slot.intervalDays,
      timezone: member.timezone,
      effectiveFrom: startDate,
      effectiveTo: endDate,
      isActive: med.isActive,
    }));

    const insertedSchedules = await MedicineSchedule.insertMany(
      scheduleDocs,
      session ? { session } : {}
    );

    for (const sch of insertedSchedules) {
      await generateDosesForSchedule(sch, member, { horizonDays: 2, session });
    }

    return med;
  });

  await enqueueQueuedCallsForMedicine(createdMedicine._id as Types.ObjectId);

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'MEDICINE_CREATED',
    resourceType: 'Medicine',
    resourceId: String(createdMedicine._id),
    ipAddress,
    metadata: {
      name: createdMedicine.name,
      slotsCount: createdMedicine.scheduledTimes.length,
    },
  });

  return getMedicineById(familyId, String(createdMedicine._id));
}

export async function updateMedicine(
  familyId: string,
  medicineId: string,
  actorUserId: string,
  input: UpdateMedicineInput,
  ipAddress?: string
) {
  const med = await Medicine.findOne({
    _id: new Types.ObjectId(medicineId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!med) throw new NotFoundError('Medicine');

  const memberId = input.familyMemberId ?? String(med.familyMemberId);
  const member = await FamilyMember.findOne({
    _id: new Types.ObjectId(memberId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!member) throw new NotFoundError('Family member');

  if (input.startDate !== undefined) {
    const parsedStart = new Date(input.startDate);
    if (Number.isNaN(parsedStart.getTime())) {
      throw new ValidationError('Invalid startDate');
    }
  }
  if (input.endDate !== undefined && input.endDate !== null && input.endDate !== '') {
    const parsedEnd = new Date(input.endDate);
    if (Number.isNaN(parsedEnd.getTime())) {
      throw new ValidationError('Invalid endDate');
    }
  }

  await withOptionalTransaction(async (session) => {
    if (input.name !== undefined) med.name = input.name.trim();
    if (input.dosage !== undefined) med.dosage = input.dosage.trim();
    if (input.prescribedInstructions !== undefined) {
      med.prescribedInstructions = input.prescribedInstructions.trim();
    }
    if (input.foodInstruction !== undefined) med.foodInstruction = input.foodInstruction;
    if (input.customFoodInstruction !== undefined) {
      med.customFoodInstruction = input.customFoodInstruction.trim();
    }
    if (input.associatedMeal !== undefined) med.associatedMeal = input.associatedMeal;
    if (input.customMealName !== undefined) med.customMealName = input.customMealName.trim();
    if (input.startDate !== undefined) med.startDate = new Date(input.startDate);
    if (input.endDate !== undefined) {
      med.endDate =
        input.endDate === null || input.endDate === '' ? undefined : new Date(input.endDate);
    }
    if (med.endDate && med.endDate < med.startDate) {
      throw new ValidationError('endDate must be on or after startDate');
    }
    if (input.frequency !== undefined) med.frequency = input.frequency;
    if (input.prescribingDoctor !== undefined) {
      med.prescribingDoctor = input.prescribingDoctor.trim();
    }
    if (input.notes !== undefined) med.notes = input.notes.trim();
    if (input.isActive !== undefined) med.isActive = input.isActive;
    if (input.familyMemberId !== undefined) med.familyMemberId = member._id as Types.ObjectId;
    if (input.scheduledTimes !== undefined) med.scheduledTimes = input.scheduledTimes;

    await med.save(session ? { session } : undefined);

    const shouldCancelCallbacks = !med.isActive || Boolean(med.endDate && med.endDate < new Date());

    // Cancel future queued jobs before rebuilding schedule slots (preserve active callbacks if medicine stays active & unexpired)
    await cancelQueuedJobsForMedicine(
      med._id as Types.ObjectId,
      'Medicine schedule updated',
      session,
      { excludeCallbacks: !shouldCancelCallbacks }
    );

    if (shouldCancelCallbacks) {
      await Callback.updateMany(
        {
          medicineId: med._id,
          status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
        },
        {
          $set: {
            status: 'CANCELLED',
            validationNotes: 'Medicine prescription deactivated or expired',
          },
        },
        session ? { session } : undefined
      );
    }

    // Remove untouched future PENDING doses before regenerating updated slots/dates
    const todayLocal = getLocalDateString(new Date(), member.timezone);
    const [loggedDoseIds, callbackDoseIds, activeJobDoseIds] = await Promise.all([
      CallLog.distinct('doseInstanceId', { medicineId: med._id }).session(session ?? null),
      Callback.distinct('doseInstanceId', { medicineId: med._id }).session(session ?? null),
      CallSchedule.distinct('doseInstanceId', {
        medicineId: med._id,
        status: { $in: ['DISPATCHED', 'COMPLETED', 'FAILED'] },
      }).session(session ?? null),
    ]);

    const protectedDoseIds = [
      ...loggedDoseIds.filter(Boolean),
      ...callbackDoseIds.filter(Boolean),
      ...activeJobDoseIds.filter(Boolean),
    ];

    const removableDoses = await DoseInstance.find(
      {
        medicineId: med._id,
        scheduledDateLocal: { $gte: todayLocal },
        status: 'PENDING',
        mealStatus: 'PENDING',
        ...(protectedDoseIds.length > 0 ? { _id: { $nin: protectedDoseIds } } : {}),
      },
      { _id: 1 },
      session ? { session } : undefined
    ).lean();

    if (removableDoses.length > 0) {
      const removableIds = removableDoses.map((d) => d._id);
      await CallSchedule.deleteMany(
        { doseInstanceId: { $in: removableIds }, status: { $in: ['QUEUED', 'CANCELLED'] } },
        session ? { session } : undefined
      );
      await DoseInstance.deleteMany(
        { _id: { $in: removableIds } },
        session ? { session } : undefined
      );
    }

    await MedicineSchedule.updateMany(
      { medicineId: med._id },
      { isActive: false },
      session ? { session } : undefined
    );

    for (let idx = 0; idx < med.scheduledTimes.length; idx++) {
      const slot = med.scheduledTimes[idx];
      const sch = await MedicineSchedule.findOneAndUpdate(
        { medicineId: med._id, slotIndex: idx },
        {
          familyId: med.familyId,
          familyMemberId: med.familyMemberId,
          medicineId: med._id,
          slotIndex: idx,
          slotLabel: slot.slotLabel,
          timeOfDay: slot.timeOfDay,
          associatedMeal: slot.associatedMeal ?? med.associatedMeal,
          customMealName: slot.customMealName ?? med.customMealName,
          foodInstruction: slot.foodInstruction ?? med.foodInstruction,
          customFoodInstruction: slot.customFoodInstruction ?? med.customFoodInstruction,
          frequency: med.frequency,
          mealReminderOffsetMinutes: slot.mealReminderOffsetMinutes,
          medicineReminderOffsetMinutes: slot.medicineReminderOffsetMinutes ?? 0,
          confirmationOffsetMinutes: slot.confirmationOffsetMinutes,
          daysOfWeek: slot.daysOfWeek,
          intervalDays: slot.intervalDays,
          timezone: member.timezone,
          effectiveFrom: med.startDate,
          effectiveTo: med.endDate,
          isActive: med.isActive,
        },
        { upsert: true, new: true, session }
      );

      if (med.isActive) {
        await generateDosesForSchedule(sch, member, { horizonDays: 2, session });
      }
    }
  });

  if (med.isActive) {
    await enqueueQueuedCallsForMedicine(med._id as Types.ObjectId);
  }

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'MEDICINE_UPDATED',
    resourceType: 'Medicine',
    resourceId: medicineId,
    ipAddress,
  });

  return getMedicineById(familyId, medicineId);
}

export async function deleteMedicine(
  familyId: string,
  medicineId: string,
  actorUserId: string,
  ipAddress?: string
) {
  const med = await Medicine.findOne({
    _id: new Types.ObjectId(medicineId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!med) throw new NotFoundError('Medicine');

  await withOptionalTransaction(async (session) => {
    await cancelQueuedJobsForMedicine(med._id as Types.ObjectId, 'Medicine deleted', session);
    await Callback.updateMany(
      {
        medicineId: med._id,
        status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
      },
      {
        $set: {
          status: 'CANCELLED',
          validationNotes: 'Medicine deleted by caregiver',
        },
      },
      session ? { session } : undefined
    );
    await MedicineSchedule.deleteMany(
      { medicineId: med._id },
      session ? { session } : undefined
    );
    await med.deleteOne(session ? { session } : undefined);
  });

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'MEDICINE_DELETED',
    resourceType: 'Medicine',
    resourceId: medicineId,
    ipAddress,
    metadata: { name: med.name },
  });

  return { deleted: true, id: medicineId };
}

export async function listDoses(
  familyId: string,
  filters?: {
    familyMemberId?: string;
    date?: string;
    status?: DoseStatus;
    limit?: number;
  }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.familyMemberId) {
    query.familyMemberId = new Types.ObjectId(filters.familyMemberId);
  }
  if (filters?.date) {
    query.scheduledDateLocal = filters.date;
  }
  if (filters?.status) {
    query.status = filters.status;
  }

  const doses = await DoseInstance.find(query)
    .populate('familyMemberId', 'fullName phoneNumber preferredLanguage timezone relationship')
    .populate('medicineId', 'name dosage prescribedInstructions foodInstruction associatedMeal')
    .sort({ scheduledAt: 1 })
    .limit(filters?.limit ?? 100)
    .lean();

  const doseIds = doses.map((d) => d._id);
  const callJobs = await CallSchedule.find({
    familyId: new Types.ObjectId(familyId),
    doseInstanceId: { $in: doseIds },
  })
    .sort({ scheduledFor: 1 })
    .lean();

  const jobsByDose = new Map<string, typeof callJobs>();
  for (const job of callJobs) {
    const key = String(job.doseInstanceId);
    const list = jobsByDose.get(key) ?? [];
    list.push(job);
    jobsByDose.set(key, list);
  }

  return doses.map((d) => ({
    ...d,
    id: String(d._id),
    callJobs: jobsByDose.get(String(d._id)) ?? [],
  }));
}

export async function updateDoseStatusByCaregiver(
  familyId: string,
  doseId: string,
  actorUserId: string,
  payload: { status?: DoseStatus; mealStatus?: MealStatus; notes?: string }
) {
  const dose = await DoseInstance.findOne({
    _id: new Types.ObjectId(doseId),
    familyId: new Types.ObjectId(familyId),
  });
  if (!dose) throw new NotFoundError('Dose instance');

  if (payload.mealStatus) dose.mealStatus = payload.mealStatus;
  if (payload.status) {
    dose.status = payload.status;
    if (
      payload.status === 'PATIENT_REPORTED_TAKEN' ||
      payload.status === 'PATIENT_REPORTED_NOT_TAKEN'
    ) {
      dose.confirmedAt = new Date();
    }
  }
  if (payload.notes !== undefined) dose.notes = payload.notes;
  await dose.save();

  if (payload.status === 'PATIENT_REPORTED_TAKEN') {
    await cancelQueuedJobsForDose(dose._id as Types.ObjectId, 'Dose marked taken by caregiver');
    await Callback.updateMany(
      {
        doseInstanceId: dose._id,
        status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
      },
      {
        $set: {
          status: 'CANCELLED',
          validationNotes: 'Auto-cancelled: dose marked taken by caregiver',
        },
      }
    );
  }

  await recordAudit({
    familyId,
    actorType: 'USER',
    actorId: actorUserId,
    action: 'DOSE_STATUS_UPDATED_BY_CAREGIVER',
    resourceType: 'DoseInstance',
    resourceId: doseId,
    metadata: { status: dose.status, mealStatus: dose.mealStatus },
  });

  return dose;
}

export async function triggerScheduleGenerationForFamily(
  familyId: string,
  horizonDays = 2
) {
  return generateDosesForFamily(familyId, horizonDays);
}

