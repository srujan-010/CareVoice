import { DateTime } from 'luxon';
import { ClientSession, Types } from 'mongoose';
import { CallType } from '../constants/statuses';
import { CallSchedule } from '../models/CallSchedule';
import { Callback } from '../models/Callback';
import { DoseInstance, IDoseInstance } from '../models/DoseInstance';
import { FamilyMember, IFamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { IMedicineSchedule, MedicineSchedule } from '../models/MedicineSchedule';
import { enqueueCallJob, removeCallJob } from '../queues/queueManager';
import { logger } from '../utils/logger';
import {
  addMinutesUtc,
  getLocalDateString,
  isValidTimezone,
  localDateTimeToUtc,
} from '../utils/timezone';

export interface ComputedDoseTimes {
  scheduledAt: Date;
  mealReminderAt?: Date;
  medicineReminderAt: Date;
  confirmationCallAt?: Date;
}

function extractBoundaryCalendarDate(
  date: Date,
  zone: string,
  boundary: 'start' | 'end'
): string | null {
  const utcDt = DateTime.fromJSDate(date, { zone: 'utc' });
  if (!utcDt.isValid) return null;

  const isUtcStartOfDay =
    utcDt.hour === 0 && utcDt.minute === 0 && utcDt.second === 0 && utcDt.millisecond === 0;
  const isUtcEndOfDay = utcDt.hour === 23 && utcDt.minute === 59 && utcDt.second === 59;

  if ((boundary === 'start' && isUtcStartOfDay) || (boundary === 'end' && isUtcEndOfDay)) {
    return utcDt.toISODate();
  }

  return DateTime.fromJSDate(date, { zone }).toISODate();
}

/**
 * Pure function determining whether a MedicineSchedule applies to a specific calendar date
 * in the patient's timezone (handling expiry, weekly schedules, and alternate-day intervals).
 */
export function shouldGenerateDoseForDate(
  schedule: Pick<
    IMedicineSchedule,
    'isActive' | 'effectiveFrom' | 'effectiveTo' | 'frequency' | 'daysOfWeek' | 'intervalDays' | 'timezone'
  >,
  localDateStr: string
): boolean {
  if (!schedule.isActive) return false;

  const zone = isValidTimezone(schedule.timezone) ? schedule.timezone : 'Asia/Kolkata';
  const targetDay = DateTime.fromISO(localDateStr, { zone }).startOf('day');
  if (!targetDay.isValid) return false;

  const startCalendarDate = extractBoundaryCalendarDate(schedule.effectiveFrom, zone, 'start');
  if (!startCalendarDate || localDateStr < startCalendarDate) return false;

  if (schedule.effectiveTo) {
    const endCalendarDate = extractBoundaryCalendarDate(schedule.effectiveTo, zone, 'end');
    if (endCalendarDate && localDateStr > endCalendarDate) return false;
  }

  const startDay = DateTime.fromISO(startCalendarDate, { zone }).startOf('day');

  if (schedule.frequency === 'WEEKLY') {
    const dayIndex = targetDay.weekday % 7; // 0=Sun..6=Sat
    const allowed = schedule.daysOfWeek && schedule.daysOfWeek.length > 0 ? schedule.daysOfWeek : [startDay.weekday % 7];
    return allowed.includes(dayIndex);
  }

  if (schedule.frequency === 'ALTERNATE_DAYS') {
    const diffDays = Math.floor(targetDay.diff(startDay, 'days').days);
    return diffDays >= 0 && diffDays % 2 === 0;
  }

  if (schedule.frequency === 'CUSTOM') {
    if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
      return schedule.daysOfWeek.includes(targetDay.weekday % 7);
    }
    if (schedule.intervalDays && schedule.intervalDays > 1) {
      const diffDays = Math.floor(targetDay.diff(startDay, 'days').days);
      return diffDays >= 0 && diffDays % schedule.intervalDays === 0;
    }
  }

  return true;
}

/**
 * Computes exact UTC timestamps for a single dose slot's meal reminder,
 * medicine reminder, and confirmation follow-up call, respecting DST via Luxon.
 */
export function computeDoseCallTimes(
  schedule: Pick<
    IMedicineSchedule,
    | 'timeOfDay'
    | 'timezone'
    | 'foodInstruction'
    | 'mealReminderOffsetMinutes'
    | 'medicineReminderOffsetMinutes'
    | 'confirmationOffsetMinutes'
  >,
  localDateStr: string,
  preferences?: {
    allowMealReminders?: boolean;
    allowConfirmationCalls?: boolean;
  }
): ComputedDoseTimes {
  const scheduledAt = localDateTimeToUtc(localDateStr, schedule.timeOfDay, schedule.timezone);

  const allowMeal = preferences?.allowMealReminders ?? true;
  const allowConfirm = preferences?.allowConfirmationCalls ?? true;

  let mealReminderAt: Date | undefined;
  if (
    allowMeal &&
    schedule.mealReminderOffsetMinutes !== null &&
    schedule.mealReminderOffsetMinutes !== undefined &&
    schedule.foodInstruction !== 'NO_FOOD_RESTRICTION'
  ) {
    mealReminderAt = addMinutesUtc(scheduledAt, schedule.mealReminderOffsetMinutes);
  }

  const medicineReminderAt = addMinutesUtc(
    scheduledAt,
    schedule.medicineReminderOffsetMinutes ?? 0
  );

  let confirmationCallAt: Date | undefined;
  if (
    allowConfirm &&
    schedule.confirmationOffsetMinutes !== null &&
    schedule.confirmationOffsetMinutes !== undefined
  ) {
    confirmationCallAt = addMinutesUtc(scheduledAt, schedule.confirmationOffsetMinutes);
  }

  return {
    scheduledAt,
    mealReminderAt,
    medicineReminderAt,
    confirmationCallAt,
  };
}

export function buildCallJobKey(
  doseInstanceId: string | Types.ObjectId,
  callType: CallType,
  attemptNumber = 1
): string {
  return `dose:${String(doseInstanceId)}:type:${callType}:attempt:${attemptNumber}`;
}

async function createCallJobIfEligible(
  params: {
    familyId: Types.ObjectId;
    familyMemberId: Types.ObjectId;
    medicineId: Types.ObjectId;
    doseInstanceId: Types.ObjectId;
    callType: CallType;
    scheduledFor: Date;
    maxAttempts: number;
  },
  session?: ClientSession
): Promise<void> {
  // Do not schedule jobs far in the past (more than 15 minutes old)
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  if (params.scheduledFor.getTime() < fifteenMinutesAgo) {
    return;
  }

  const jobKey = buildCallJobKey(params.doseInstanceId, params.callType, 1);

  try {
    const existing = await CallSchedule.findOne({ jobKey }, null, session ? { session } : undefined);
    if (existing) {
      if (
        existing.status === 'CANCELLED' &&
        existing.failureReason === 'Medicine schedule updated' &&
        params.callType !== 'CALLBACK'
      ) {
        existing.status = 'QUEUED';
        existing.scheduledFor = params.scheduledFor;
        existing.failureReason = undefined;
        await existing.save(session ? { session } : undefined);
        if (!session) {
          await enqueueCallJob(
            {
              callScheduleId: String(existing._id),
              jobKey: existing.jobKey,
              familyId: String(params.familyId),
              callType: params.callType,
            },
            existing.scheduledFor
          );
        }
      }
      return;
    }

    const [created] = await CallSchedule.create(
      [
        {
          familyId: params.familyId,
          familyMemberId: params.familyMemberId,
          medicineId: params.medicineId,
          doseInstanceId: params.doseInstanceId,
          callType: params.callType,
          scheduledFor: params.scheduledFor,
          status: 'QUEUED',
          jobKey,
          attemptNumber: 1,
          maxAttempts: params.maxAttempts,
        },
      ],
      session ? { session } : undefined
    );

    if (!session) {
      await enqueueCallJob(
        {
          callScheduleId: String(created._id),
          jobKey: created.jobKey,
          familyId: String(params.familyId),
          callType: params.callType,
        },
        created.scheduledFor
      );
    }
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: number }).code
        : undefined;
    if (code === 11000) {
      // Duplicate jobKey prevented safely
      return;
    }
    throw err;
  }
}

export async function generateDosesForSchedule(
  schedule: IMedicineSchedule,
  member: IFamilyMember,
  options: { horizonDays?: number; session?: ClientSession } = {}
): Promise<IDoseInstance[]> {
  if (!schedule.isActive || !member.isActive) {
    return [];
  }

  const horizonDays = options.horizonDays ?? 2;
  const zone = isValidTimezone(member.timezone) ? member.timezone : schedule.timezone;
  const todayLocal = getLocalDateString(new Date(), zone);
  const startDt = DateTime.fromISO(todayLocal, { zone });

  const generated: IDoseInstance[] = [];

  for (let offset = 0; offset <= horizonDays; offset++) {
    const targetLocalDate = startDt.plus({ days: offset }).toISODate();
    if (!targetLocalDate) continue;

    if (!shouldGenerateDoseForDate(schedule, targetLocalDate)) {
      continue;
    }

    const times = computeDoseCallTimes(schedule, targetLocalDate, {
      allowMealReminders: member.callingPreferences?.allowMealReminders ?? true,
      allowConfirmationCalls: member.callingPreferences?.allowConfirmationCalls ?? true,
    });

    const dose = await DoseInstance.findOneAndUpdate(
      {
        medicineScheduleId: schedule._id,
        scheduledDateLocal: targetLocalDate,
      },
      {
        $setOnInsert: {
          familyId: schedule.familyId,
          familyMemberId: schedule.familyMemberId,
          medicineId: schedule.medicineId,
          medicineScheduleId: schedule._id,
          scheduledDateLocal: targetLocalDate,
          slotIndex: schedule.slotIndex,
          slotLabel: schedule.slotLabel,
          scheduledAt: times.scheduledAt,
          mealReminderAt: times.mealReminderAt,
          medicineReminderAt: times.medicineReminderAt,
          confirmationCallAt: times.confirmationCallAt,
          timezone: zone,
          associatedMeal: schedule.associatedMeal,
          customMealName: schedule.customMealName,
          foodInstruction: schedule.foodInstruction,
          customFoodInstruction: schedule.customFoodInstruction,
          mealStatus: 'PENDING',
          status: 'PENDING',
        },
      },
      {
        upsert: true,
        new: true,
        session: options.session,
      }
    );

    generated.push(dose);

    // Only enqueue voice call jobs when patient has voice calling consent granted and dose is not yet confirmed
    if (
      member.voiceCallingConsentStatus === 'GRANTED' &&
      dose.status !== 'PATIENT_REPORTED_TAKEN' &&
      dose.status !== 'PATIENT_REPORTED_NOT_TAKEN'
    ) {
      const maxAttempts = Math.max(1, (member.callingPreferences?.maxRetries ?? 2) + 1);

      if (times.mealReminderAt) {
        await createCallJobIfEligible(
          {
            familyId: schedule.familyId,
            familyMemberId: schedule.familyMemberId,
            medicineId: schedule.medicineId,
            doseInstanceId: dose._id as Types.ObjectId,
            callType: 'MEAL_REMINDER',
            scheduledFor: times.mealReminderAt,
            maxAttempts,
          },
          options.session
        );
      }

      await createCallJobIfEligible(
        {
          familyId: schedule.familyId,
          familyMemberId: schedule.familyMemberId,
          medicineId: schedule.medicineId,
          doseInstanceId: dose._id as Types.ObjectId,
          callType: 'MEDICINE_REMINDER',
          scheduledFor: times.medicineReminderAt,
          maxAttempts,
        },
        options.session
      );

      if (times.confirmationCallAt) {
        await createCallJobIfEligible(
          {
            familyId: schedule.familyId,
            familyMemberId: schedule.familyMemberId,
            medicineId: schedule.medicineId,
            doseInstanceId: dose._id as Types.ObjectId,
            callType: 'CONFIRMATION_CALL',
            scheduledFor: times.confirmationCallAt,
            maxAttempts,
          },
          options.session
        );
      }
    }
  }

  return generated;
}

export async function generateDosesForFamily(familyId: string, horizonDays = 2) {
  const schedules = await MedicineSchedule.find({
    familyId: new Types.ObjectId(familyId),
    isActive: true,
  });

  if (schedules.length === 0) return { generatedCount: 0 };

  const memberIds = Array.from(new Set(schedules.map((s) => String(s.familyMemberId))));
  const members = await FamilyMember.find({
    _id: { $in: memberIds.map((id) => new Types.ObjectId(id)) },
    isActive: true,
  });
  const memberMap = new Map(members.map((m) => [String(m._id), m]));

  const medicines = await Medicine.find({
    familyId: new Types.ObjectId(familyId),
    isActive: true,
  }).lean();
  const activeMedSet = new Set(medicines.map((m) => String(m._id)));

  let total = 0;
  for (const schedule of schedules) {
    if (!activeMedSet.has(String(schedule.medicineId))) continue;
    const member = memberMap.get(String(schedule.familyMemberId));
    if (!member) continue;
    const doses = await generateDosesForSchedule(schedule, member, { horizonDays });
    total += doses.length;
  }

  return { generatedCount: total };
}

export async function generateDosesAllFamilies(horizonDays = 2): Promise<number> {
  const activeMembers = await FamilyMember.find({ isActive: true });
  const memberMap = new Map(activeMembers.map((m) => [String(m._id), m]));

  const activeMedicines = await Medicine.find({ isActive: true }).lean();
  const activeMedSet = new Set(activeMedicines.map((m) => String(m._id)));

  const schedules = await MedicineSchedule.find({ isActive: true });
  let count = 0;

  for (const schedule of schedules) {
    if (!activeMedSet.has(String(schedule.medicineId))) continue;
    const member = memberMap.get(String(schedule.familyMemberId));
    if (!member) continue;
    const doses = await generateDosesForSchedule(schedule, member, { horizonDays });
    count += doses.length;
  }

  return count;
}

export async function cancelQueuedJobsForMedicine(
  medicineId: string | Types.ObjectId,
  reason: string,
  session?: ClientSession,
  options?: { excludeCallbacks?: boolean }
): Promise<number> {
  const jobs = await CallSchedule.find(
    {
      medicineId: new Types.ObjectId(String(medicineId)),
      status: 'QUEUED',
      ...(options?.excludeCallbacks ? { callType: { $ne: 'CALLBACK' } } : {}),
    },
    null,
    session ? { session } : undefined
  );

  for (const job of jobs) {
    job.status = 'CANCELLED';
    job.failureReason = reason;
    await job.save(session ? { session } : undefined);
    await removeCallJob(job.jobKey);
  }

  return jobs.length;
}

export async function cancelQueuedJobsForDose(
  doseInstanceId: string | Types.ObjectId,
  reason: string,
  session?: ClientSession
): Promise<number> {
  const jobs = await CallSchedule.find(
    {
      doseInstanceId: new Types.ObjectId(String(doseInstanceId)),
      status: 'QUEUED',
    },
    null,
    session ? { session } : undefined
  );

  for (const job of jobs) {
    job.status = 'CANCELLED';
    job.failureReason = reason;
    await job.save(session ? { session } : undefined);
    await removeCallJob(job.jobKey);
  }

  return jobs.length;
}

export async function cancelQueuedJobsForMember(
  familyMemberId: string | Types.ObjectId,
  reason: string,
  session?: ClientSession
): Promise<number> {
  const jobs = await CallSchedule.find(
    {
      familyMemberId: new Types.ObjectId(String(familyMemberId)),
      status: 'QUEUED',
    },
    null,
    session ? { session } : undefined
  );

  for (const job of jobs) {
    job.status = 'CANCELLED';
    job.failureReason = reason;
    await job.save(session ? { session } : undefined);
    await removeCallJob(job.jobKey);
  }

  return jobs.length;
}

/**
 * Recovers pending QUEUED jobs after a server restart, expires stale jobs,
 * and ensures all active upcoming call schedules are loaded into the queue.
 */
export async function recoverPendingCallJobs(): Promise<{
  recovered: number;
  expired: number;
}> {
  const now = new Date();
  const catchUpCutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h catch-up window

  const staleCallbackJobs = await CallSchedule.find(
    {
      status: 'QUEUED',
      scheduledFor: { $lt: catchUpCutoff },
      callbackId: { $ne: null },
    },
    { callbackId: 1 }
  ).lean();

  if (staleCallbackJobs.length > 0) {
    const staleCallbackIds = staleCallbackJobs
      .map((j) => j.callbackId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    if (staleCallbackIds.length > 0) {
      await Callback.updateMany(
        {
          _id: { $in: staleCallbackIds },
          status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
        },
        {
          $set: {
            status: 'FAILED',
            validationNotes: 'Expired past 2-hour catch-up threshold',
          },
        }
      );
    }
  }

  // Mark jobs older than 2 hours as SKIPPED so stale reminders don't blast late
  const staleResult = await CallSchedule.updateMany(
    {
      status: 'QUEUED',
      scheduledFor: { $lt: catchUpCutoff },
    },
    {
      $set: {
        status: 'SKIPPED',
        failureReason: 'Missed scheduling window beyond 2-hour catch-up threshold',
      },
    }
  );

  const pendingJobs = await CallSchedule.find({
    status: 'QUEUED',
    scheduledFor: { $gte: catchUpCutoff },
  }).lean();

  let recovered = 0;
  for (const job of pendingJobs) {
    await enqueueCallJob(
      {
        callScheduleId: String(job._id),
        jobKey: job.jobKey,
        familyId: String(job.familyId),
        callType: job.callType,
      },
      job.scheduledFor
    );
    recovered++;
  }

  logger.info('Call job recovery completed', {
    recovered,
    expired: staleResult.modifiedCount,
  });

  return {
    recovered,
    expired: staleResult.modifiedCount,
  };
}
