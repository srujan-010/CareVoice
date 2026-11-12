import { DateTime } from 'luxon';
import mongoose, { Types } from 'mongoose';
import { getSarvamWebhookReadiness, isMockSimulationAllowed, isTelephonyReady } from '../config/env';
import { Family } from '../models/Family';
import { FamilyMember } from '../models/FamilyMember';
import { getLocalDateRangeUtc, getLocalDateString } from '../utils/timezone';

export async function getDashboardOverview(familyId: string) {
  const familyObjectId = new Types.ObjectId(familyId);
  const family = await Family.findById(familyObjectId).lean();
  const timezone = family?.timezone ?? 'Asia/Kolkata';

  const now = new Date();
  const todayLocal = getLocalDateString(now, timezone);
  const { startUtc: todayStart, endUtc: todayEnd } = getLocalDateRangeUtc(todayLocal, timezone);
  const sevenDaysAgo = DateTime.fromJSDate(now, { zone: timezone })
    .minus({ days: 6 })
    .startOf('day')
    .toUTC()
    .toJSDate();

  const members = await FamilyMember.find({ familyId: familyObjectId })
    .sort({ createdAt: -1 })
    .lean();

  const MedicineModel = mongoose.models.Medicine;
  const DoseInstanceModel = mongoose.models.DoseInstance;
  const CallScheduleModel = mongoose.models.CallSchedule;
  const CallLogModel = mongoose.models.CallLog;
  const CallbackModel = mongoose.models.Callback;
  const EscalationModel = mongoose.models.Escalation;

  const [
    activeMedicines,
    callsScheduledToday,
    callsCompletedToday,
    todaysDoses,
    pendingCallbacks,
    todaysUpcomingCalls,
    recentCallHistory,
    pendingEscalations,
    missedDoses,
    weeklyDoses,
    weeklyCalls,
  ] = await Promise.all([
    MedicineModel
      ? MedicineModel.countDocuments({ familyId: familyObjectId, isActive: true })
      : Promise.resolve(0),
    CallScheduleModel
      ? CallScheduleModel.countDocuments({
          familyId: familyObjectId,
          scheduledFor: { $gte: todayStart, $lte: todayEnd },
          status: { $in: ['QUEUED', 'DISPATCHED', 'COMPLETED'] },
        })
      : Promise.resolve(0),
    CallLogModel
      ? CallLogModel.countDocuments({
          familyId: familyObjectId,
          createdAt: { $gte: todayStart, $lte: todayEnd },
          outcome: { $in: ['COMPLETED', 'ANSWERED'] },
        })
      : Promise.resolve(0),
    DoseInstanceModel
      ? DoseInstanceModel.find({
          familyId: familyObjectId,
          scheduledAt: { $gte: todayStart, $lte: todayEnd },
        }).lean()
      : Promise.resolve([]),
    CallbackModel
      ? CallbackModel.countDocuments({
          familyId: familyObjectId,
          status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
        })
      : Promise.resolve(0),
    CallScheduleModel
      ? CallScheduleModel.find({
          familyId: familyObjectId,
          scheduledFor: { $gte: now, $lte: todayEnd },
          status: 'QUEUED',
        })
          .populate('familyMemberId', 'fullName phoneNumber preferredLanguage')
          .populate('medicineId', 'name dosage')
          .sort({ scheduledFor: 1 })
          .limit(8)
          .lean()
      : Promise.resolve([]),
    CallLogModel
      ? CallLogModel.find({ familyId: familyObjectId })
          .populate('familyMemberId', 'fullName phoneNumber preferredLanguage')
          .populate('medicineId', 'name dosage')
          .sort({ createdAt: -1 })
          .limit(8)
          .lean()
      : Promise.resolve([]),
    EscalationModel
      ? EscalationModel.find({
          familyId: familyObjectId,
          status: { $in: ['OPEN', 'ACKNOWLEDGED'] },
        })
          .populate('familyMemberId', 'fullName phoneNumber relationship')
          .sort({ createdAt: -1 })
          .limit(8)
          .lean()
      : Promise.resolve([]),
    DoseInstanceModel
      ? DoseInstanceModel.find({
          familyId: familyObjectId,
          status: { $in: ['PATIENT_REPORTED_NOT_TAKEN', 'UNCONFIRMED', 'ESCALATED'] },
        })
          .populate('familyMemberId', 'fullName preferredLanguage')
          .populate('medicineId', 'name dosage')
          .sort({ scheduledAt: -1 })
          .limit(8)
          .lean()
      : Promise.resolve([]),
    DoseInstanceModel
      ? DoseInstanceModel.find({
          familyId: familyObjectId,
          scheduledAt: { $gte: sevenDaysAgo, $lte: todayEnd },
        }).lean()
      : Promise.resolve([]),
    CallLogModel
      ? CallLogModel.find({
          familyId: familyObjectId,
          createdAt: { $gte: sevenDaysAgo, $lte: todayEnd },
        }).lean()
      : Promise.resolve([]),
  ]);

  let medicinesReportedTaken = 0;
  let medicinesNotTaken = 0;
  let unconfirmedDoses = 0;

  for (const d of todaysDoses as Array<{ status?: string }>) {
    if (d.status === 'PATIENT_REPORTED_TAKEN') medicinesReportedTaken++;
    else if (d.status === 'PATIENT_REPORTED_NOT_TAKEN') medicinesNotTaken++;
    else if (d.status === 'UNCONFIRMED' || d.status === 'ESCALATED') unconfirmedDoses++;
  }

  // Build 7-day charts strictly from MongoDB records
  const days = Array.from({ length: 7 }, (_, i) =>
    DateTime.fromJSDate(now, { zone: timezone }).minus({ days: 6 - i })
  );

  const dailyAdherence = days.map((dt) => {
    const dateKey = dt.toISODate() ?? '';
    const dayLabel = dt.toFormat('ccc');
    const dayDoses = (weeklyDoses as Array<{ scheduledDateLocal?: string; status?: string }>).filter(
      (d) => d.scheduledDateLocal === dateKey
    );

    const taken = dayDoses.filter((d) => d.status === 'PATIENT_REPORTED_TAKEN').length;
    const notTaken = dayDoses.filter((d) => d.status === 'PATIENT_REPORTED_NOT_TAKEN').length;
    const unconfirmed = dayDoses.filter(
      (d) => d.status === 'UNCONFIRMED' || d.status === 'ESCALATED'
    ).length;
    const pending = dayDoses.filter(
      (d) => d.status === 'PENDING' || d.status === 'CALLBACK_REQUESTED'
    ).length;

    const denominator = taken + notTaken + unconfirmed;
    const adherencePct = denominator > 0 ? Math.round((taken / denominator) * 100) : 0;

    return {
      date: dateKey,
      label: dayLabel,
      adherencePct,
      taken,
      notTaken,
      unconfirmed,
      pending,
    };
  });

  const weeklyCallingActivity = days.map((dt) => {
    const dateKey = dt.toISODate() ?? '';
    const dayLabel = dt.toFormat('ccc');
    const dayCalls = (weeklyCalls as Array<{ createdAt?: Date; outcome?: string }>).filter((c) => {
      if (!c.createdAt) return false;
      return getLocalDateString(new Date(c.createdAt), timezone) === dateKey;
    });

    return {
      date: dateKey,
      label: dayLabel,
      total: dayCalls.length,
      completed: dayCalls.filter(
        (c) => c.outcome === 'COMPLETED' || c.outcome === 'ANSWERED'
      ).length,
      missed: dayCalls.filter(
        (c) =>
          c.outcome === 'NO_ANSWER' ||
          c.outcome === 'BUSY' ||
          c.outcome === 'REJECTED' ||
          c.outcome === 'FAILED'
      ).length,
      callbacks: dayCalls.filter((c) => c.outcome === 'CALLBACK_REQUESTED').length,
    };
  });

  const outcomeCounts = new Map<string, number>();
  for (const call of weeklyCalls as Array<{ outcome?: string }>) {
    const key = call.outcome ?? 'UNKNOWN';
    outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
  }
  const callOutcomeDistribution = Array.from(outcomeCounts.entries()).map(([outcome, count]) => ({
    outcome,
    count,
  }));

  const telephony = isTelephonyReady();
  const webhook = getSarvamWebhookReadiness();
  const mockSimulationAllowed = isMockSimulationAllowed();

  return {
    environment: {
      voiceMode: telephony.mode,
      telephonyReady: telephony.ready,
      missingTelephonyConfig: telephony.missingFields,
      webhookReady: webhook.ready,
      missingWebhookConfig: webhook.missingFields,
      devDemoModeAllowed: mockSimulationAllowed,
      mockSimulationAllowed,
    },
    statistics: {
      totalFamilyMembers: members.length,
      activeFamilyMembers: members.filter((m) => m.isActive).length,
      activeMedicines,
      callsScheduledToday,
      callsCompleted: callsCompletedToday,
      medicinesReportedTaken,
      medicinesNotTaken,
      unconfirmedDoses,
      pendingCallbacks,
    },
    charts: {
      dailyAdherence,
      weeklyCallingActivity,
      medicineConfirmationTrends: dailyAdherence.map((d) => ({
        label: d.label,
        taken: d.taken,
        notTaken: d.notTaken,
        unconfirmed: d.unconfirmed,
      })),
      callOutcomeDistribution,
    },
    sections: {
      todaysUpcomingCalls,
      recentCallHistory,
      familyMemberStatus: members.slice(0, 8).map((m) => ({
        id: String(m._id),
        fullName: m.fullName,
        relationship: m.relationship,
        preferredLanguage: m.preferredLanguage,
        timezone: m.timezone,
        isActive: m.isActive,
        recordingConsentStatus: m.recordingConsentStatus,
        voiceCallingConsentStatus: m.voiceCallingConsentStatus,
      })),
      pendingEscalations,
      missedMedicineConfirmations: missedDoses,
    },
  };
}

