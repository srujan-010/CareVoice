import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { DOSE_STATUSES } from '../constants/statuses';
import { CallLog } from '../models/CallLog';
import { Callback } from '../models/Callback';
import { DoseInstance } from '../models/DoseInstance';
import { Family } from '../models/Family';
import { FamilyMember } from '../models/FamilyMember';
import { Medicine } from '../models/Medicine';
import { getLocalDateString } from '../utils/timezone';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

export async function generateAdherenceReport(
  familyId: string,
  options: { period?: ReportPeriod; familyMemberId?: string } = {}
) {
  const familyObjectId = new Types.ObjectId(familyId);
  const period: ReportPeriod = options.period ?? 'weekly';
  const daysBack = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;

  const family = await Family.findById(familyObjectId).lean();
  const timezone = family?.timezone ?? 'Asia/Kolkata';

  const now = new Date();
  const startUtc = DateTime.fromJSDate(now, { zone: timezone })
    .minus({ days: daysBack - 1 })
    .startOf('day')
    .toUTC()
    .toJSDate();

  const doseQuery: Record<string, unknown> = {
    familyId: familyObjectId,
    scheduledAt: { $gte: startUtc, $lte: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  };
  const callQuery: Record<string, unknown> = {
    familyId: familyObjectId,
    createdAt: { $gte: startUtc },
  };
  const callbackQuery: Record<string, unknown> = {
    familyId: familyObjectId,
    createdAt: { $gte: startUtc },
  };

  if (options.familyMemberId) {
    const memberObjId = new Types.ObjectId(options.familyMemberId);
    doseQuery.familyMemberId = memberObjId;
    callQuery.familyMemberId = memberObjId;
    callbackQuery.familyMemberId = memberObjId;
  }

  const [doses, calls, callbacks, members, medicines] = await Promise.all([
    DoseInstance.find(doseQuery).sort({ scheduledAt: -1 }).lean(),
    CallLog.find(callQuery).lean(),
    Callback.find(callbackQuery).lean(),
    FamilyMember.find({ familyId: familyObjectId }).lean(),
    Medicine.find({ familyId: familyObjectId }).lean(),
  ]);

  const statusBreakdown: Record<string, number> = {};
  for (const st of DOSE_STATUSES) {
    statusBreakdown[st] = 0;
  }
  for (const dose of doses) {
    statusBreakdown[dose.status] = (statusBreakdown[dose.status] ?? 0) + 1;
  }

  const resolvedDenominator =
    statusBreakdown.PATIENT_REPORTED_TAKEN +
    statusBreakdown.PATIENT_REPORTED_NOT_TAKEN +
    statusBreakdown.UNCONFIRMED +
    statusBreakdown.ESCALATED;

  const overallAdherencePct =
    resolvedDenominator > 0
      ? Math.round((statusBreakdown.PATIENT_REPORTED_TAKEN / resolvedDenominator) * 100)
      : null;

  // Timeline points
  const dayBuckets = Array.from({ length: daysBack }, (_, i) =>
    DateTime.fromJSDate(now, { zone: timezone }).minus({ days: daysBack - 1 - i })
  );

  const timeline = dayBuckets.map((dt) => {
    const dateKey = dt.toISODate() ?? '';
    const dayDoses = doses.filter((d) => d.scheduledDateLocal === dateKey);
    const counts: Record<string, number> = {};
    for (const st of DOSE_STATUSES) counts[st] = 0;
    for (const d of dayDoses) counts[d.status] = (counts[d.status] ?? 0) + 1;

    return {
      date: dateKey,
      label: period === 'monthly' ? dt.toFormat('dd LLL') : dt.toFormat('ccc dd'),
      ...counts,
      total: dayDoses.length,
    };
  });

  // Medicine-wise breakdown
  const medicineMap = new Map(medicines.map((m) => [String(m._id), m]));
  const medStatsMap = new Map<
    string,
    {
      medicineId: string;
      name: string;
      dosage: string;
      taken: number;
      notTaken: number;
      unconfirmed: number;
      pending: number;
      escalated: number;
      callbackRequested: number;
      total: number;
    }
  >();

  for (const d of doses) {
    const mId = String(d.medicineId);
    const med = medicineMap.get(mId);
    const row = medStatsMap.get(mId) ?? {
      medicineId: mId,
      name: med?.name || 'Unknown Medicine',
      dosage: med?.dosage || '',
      taken: 0,
      notTaken: 0,
      unconfirmed: 0,
      pending: 0,
      escalated: 0,
      callbackRequested: 0,
      total: 0,
    };
    row.total++;
    if (d.status === 'PATIENT_REPORTED_TAKEN') row.taken++;
    else if (d.status === 'PATIENT_REPORTED_NOT_TAKEN') row.notTaken++;
    else if (d.status === 'UNCONFIRMED') row.unconfirmed++;
    else if (d.status === 'PENDING') row.pending++;
    else if (d.status === 'ESCALATED') row.escalated++;
    else if (d.status === 'CALLBACK_REQUESTED') row.callbackRequested++;
    medStatsMap.set(mId, row);
  }

  // Family-member-wise breakdown
  const memberMap = new Map(members.map((m) => [String(m._id), m]));
  const memberStatsMap = new Map<
    string,
    {
      familyMemberId: string;
      fullName: string;
      preferredLanguage: string;
      taken: number;
      notTaken: number;
      unconfirmed: number;
      escalated: number;
      totalDoses: number;
      callsTotal: number;
      callsAnsweredOrCompleted: number;
    }
  >();

  for (const m of members) {
    memberStatsMap.set(String(m._id), {
      familyMemberId: String(m._id),
      fullName: m.fullName,
      preferredLanguage: m.preferredLanguage,
      taken: 0,
      notTaken: 0,
      unconfirmed: 0,
      escalated: 0,
      totalDoses: 0,
      callsTotal: 0,
      callsAnsweredOrCompleted: 0,
    });
  }

  for (const d of doses) {
    const key = String(d.familyMemberId);
    const row = memberStatsMap.get(key);
    if (!row) continue;
    row.totalDoses++;
    if (d.status === 'PATIENT_REPORTED_TAKEN') row.taken++;
    else if (d.status === 'PATIENT_REPORTED_NOT_TAKEN') row.notTaken++;
    else if (d.status === 'UNCONFIRMED') row.unconfirmed++;
    else if (d.status === 'ESCALATED') row.escalated++;
  }

  for (const c of calls) {
    const row = memberStatsMap.get(String(c.familyMemberId));
    if (!row) continue;
    row.callsTotal++;
    if (c.outcome === 'COMPLETED' || c.outcome === 'ANSWERED') {
      row.callsAnsweredOrCompleted++;
    }
  }

  // Missed & unconfirmed dose details
  const missedDoses = doses
    .filter((d) =>
      ['PATIENT_REPORTED_NOT_TAKEN', 'UNCONFIRMED', 'ESCALATED'].includes(d.status)
    )
    .slice(0, 40)
    .map((d) => ({
      id: String(d._id),
      patientName: memberMap.get(String(d.familyMemberId))?.fullName || 'Patient',
      medicineName: medicineMap.get(String(d.medicineId))?.name || 'Medicine',
      dosage: medicineMap.get(String(d.medicineId))?.dosage || '',
      slotLabel: d.slotLabel,
      scheduledDateLocal: d.scheduledDateLocal,
      scheduledAt: d.scheduledAt,
      status: d.status,
      mealStatus: d.mealStatus,
    }));

  // Callback performance
  const callbackPerformance = {
    total: callbacks.length,
    completed: callbacks.filter((c) => c.status === 'COMPLETED').length,
    scheduledOrPending: callbacks.filter((c) =>
      ['REQUESTED', 'CONFIRMED', 'SCHEDULED'].includes(c.status)
    ).length,
    failed: callbacks.filter((c) => c.status === 'FAILED').length,
    cancelled: callbacks.filter((c) => c.status === 'CANCELLED').length,
  };

  // Call success rate
  const completedCalls = calls.filter(
    (c) => c.outcome === 'COMPLETED' || c.outcome === 'ANSWERED'
  ).length;
  const callSuccessRate =
    calls.length > 0 ? Math.round((completedCalls / calls.length) * 100) : null;

  return {
    period,
    generatedAt: new Date().toISOString(),
    localDateReference: getLocalDateString(now, timezone),
    summary: {
      totalDoses: doses.length,
      overallAdherencePct,
      statusBreakdown,
      totalCalls: calls.length,
      completedCalls,
      callSuccessRate,
      callbackPerformance,
    },
    timeline,
    medicineBreakdown: Array.from(medStatsMap.values()),
    memberBreakdown: Array.from(memberStatsMap.values()),
    missedDoses,
  };
}

