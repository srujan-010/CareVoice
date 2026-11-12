'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, PhoneCall, PhoneForwarded } from 'lucide-react';
import { ConfirmationTrendChart } from '@/components/charts/ConfirmationTrendChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { DOSE_STATUS_META, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type { FamilyMember } from '@/types';

interface ReportPayload {
  period: 'daily' | 'weekly' | 'monthly';
  summary: {
    totalDoses: number;
    overallAdherencePct: number | null;
    statusBreakdown: Record<string, number>;
    totalCalls: number;
    completedCalls: number;
    callSuccessRate: number | null;
    callbackPerformance: {
      total: number;
      completed: number;
      scheduledOrPending: number;
      failed: number;
      cancelled: number;
    };
  };
  timeline: Array<{
    date: string;
    label: string;
    PATIENT_REPORTED_TAKEN: number;
    PATIENT_REPORTED_NOT_TAKEN: number;
    UNCONFIRMED: number;
    PENDING: number;
    CALLBACK_REQUESTED: number;
    ESCALATED: number;
  }>;
  medicineBreakdown: Array<{
    medicineId: string;
    name: string;
    dosage: string;
    taken: number;
    notTaken: number;
    unconfirmed: number;
    pending: number;
    escalated: number;
    total: number;
  }>;
  memberBreakdown: Array<{
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
  }>;
  missedDoses: Array<{
    id: string;
    patientName: string;
    medicineName: string;
    dosage: string;
    slotLabel: string;
    scheduledAt: string;
    status: string;
    mealStatus: string;
  }>;
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [memberFilter, setMemberFilter] = useState('');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (memberFilter) params.set('familyMemberId', memberFilter);
      const [rep, memberList] = await Promise.all([
        apiRequest<ReportPayload>(`/reports?${params.toString()}`),
        apiRequest<FamilyMember[]>('/family-members'),
      ]);
      setReport(rep);
      setMembers(memberList);
    } finally {
      setLoading(false);
    }
  }, [period, memberFilter]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Adherence & Voice Analytics Reports
          </h1>
          <p className="text-sm text-slate-500">
            Strict separation of taken, not taken, unconfirmed, pending, callback-requested &
            escalated doses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Button>
          ))}
          <SelectNative
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="w-48"
          >
            <option value="">All Members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {loading || !report ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <>
          {/* Summary KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Confirmed Adherence Rate</p>
                  <p className="mt-1 text-2xl font-extrabold text-blue-700">
                    {report.summary.overallAdherencePct !== null
                      ? `${report.summary.overallAdherencePct}%`
                      : 'No resolved doses'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {report.summary.totalDoses} total tracked doses
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Call Success Rate</p>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900">
                    {report.summary.callSuccessRate !== null
                      ? `${report.summary.callSuccessRate}%`
                      : 'No calls'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {report.summary.completedCalls} of {report.summary.totalCalls} calls answered
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-blue-600">
                  <PhoneCall className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">Callback Performance</p>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900">
                    {report.summary.callbackPerformance.completed} /{' '}
                    {report.summary.callbackPerformance.total}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {report.summary.callbackPerformance.scheduledOrPending} pending •{' '}
                    {report.summary.callbackPerformance.failed} failed
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <PhoneForwarded className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Explicit 6-status separation */}
          <Card>
            <CardHeader>
              <CardTitle>Dose Status Breakdown (Safety-Compliant)</CardTitle>
              <CardDescription>
                Unconfirmed doses are never merged into Taken statistics
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {Object.entries(report.summary.statusBreakdown).map(([status, count]) => {
                const meta = DOSE_STATUS_META[status];
                return (
                  <div
                    key={status}
                    className={`rounded-xl border p-3.5 ${meta?.bg || 'bg-sky-50'} ${meta?.border || 'border-sky-200'}`}
                  >
                    <p className={`text-[11px] font-bold ${meta?.text || 'text-slate-700'}`}>
                      {meta?.label || status}
                    </p>
                    <p className="mt-1 text-xl font-extrabold text-slate-900">{count}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Trend chart */}
          <Card>
            <CardHeader>
              <CardTitle>Confirmation Trend ({period.toUpperCase()})</CardTitle>
              <CardDescription>Daily distribution across taken, unconfirmed & missed</CardDescription>
            </CardHeader>
            <CardContent>
              <ConfirmationTrendChart
                data={report.timeline.map((t) => ({
                  label: t.label,
                  taken: t.PATIENT_REPORTED_TAKEN,
                  notTaken: t.PATIENT_REPORTED_NOT_TAKEN,
                  unconfirmed: t.UNCONFIRMED + t.ESCALATED,
                }))}
              />
            </CardContent>
          </Card>

          {/* Medicine-wise & Member-wise tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Medicine-Wise Confirmation</CardTitle>
              </CardHeader>
              <CardContent>
                {report.medicineBreakdown.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="No medicine data in range"
                    description="Create medicines and generate dose schedules to see per-medicine adherence."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-sky-100 text-slate-500">
                          <th className="py-2">Medicine</th>
                          <th className="py-2">Taken</th>
                          <th className="py-2">Not Taken</th>
                          <th className="py-2">Unconfirmed</th>
                          <th className="py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-100">
                        {report.medicineBreakdown.map((m) => (
                          <tr key={m.medicineId}>
                            <td className="py-2.5 font-bold text-slate-900">
                              {m.name} ({m.dosage})
                            </td>
                            <td className="py-2.5 text-emerald-700 font-semibold">{m.taken}</td>
                            <td className="py-2.5 text-rose-700 font-semibold">{m.notTaken}</td>
                            <td className="py-2.5 text-amber-700 font-semibold">
                              {m.unconfirmed + m.escalated}
                            </td>
                            <td className="py-2.5 text-slate-700">{m.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Family-Member-Wise Report</CardTitle>
              </CardHeader>
              <CardContent>
                {report.memberBreakdown.length === 0 ? (
                  <EmptyState
                    icon={BarChart3}
                    title="No family member data"
                    description="Add family members to track individual adherence and call response rates."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-sky-100 text-slate-500">
                          <th className="py-2">Member</th>
                          <th className="py-2">Taken</th>
                          <th className="py-2">Not Taken</th>
                          <th className="py-2">Unconfirmed</th>
                          <th className="py-2">Calls Answered</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sky-100">
                        {report.memberBreakdown.map((m) => (
                          <tr key={m.familyMemberId}>
                            <td className="py-2.5">
                              <p className="font-bold text-slate-900">{m.fullName}</p>
                              <p className="text-[11px] text-slate-500">
                                {getLanguageLabel(m.preferredLanguage)}
                              </p>
                            </td>
                            <td className="py-2.5 text-emerald-700 font-semibold">{m.taken}</td>
                            <td className="py-2.5 text-rose-700 font-semibold">{m.notTaken}</td>
                            <td className="py-2.5 text-amber-700 font-semibold">
                              {m.unconfirmed + m.escalated}
                            </td>
                            <td className="py-2.5 text-slate-700">
                              {m.callsAnsweredOrCompleted}/{m.callsTotal}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Missed & Unconfirmed Doses */}
          <Card>
            <CardHeader>
              <CardTitle>Missed & Unconfirmed Dose Log</CardTitle>
              <CardDescription>
                Doses requiring caregiver attention or follow-up
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.missedDoses.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="No missed or unconfirmed doses in this period"
                  description="All tracked doses have been confirmed or are still pending."
                />
              ) : (
                <div className="space-y-2">
                  {report.missedDoses.map((d) => {
                    const meta = DOSE_STATUS_META[d.status];
                    return (
                      <div
                        key={d.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/35 px-4 py-3 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {d.patientName} — {d.medicineName} ({d.dosage})
                          </p>
                          <p className="text-slate-500">
                            {d.slotLabel} • {formatDateTimeInTz(d.scheduledAt)} • Meal:{' '}
                            {d.mealStatus}
                          </p>
                        </div>
                        <Badge
                          variant="default"
                          className={`${meta?.bg} ${meta?.text} ${meta?.border}`}
                        >
                          {meta?.label || d.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

