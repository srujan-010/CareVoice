'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  PhoneCall,
  PhoneForwarded,
  Pill,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { AdherenceTrendChart } from '@/components/charts/AdherenceTrendChart';
import { CallOutcomePieChart } from '@/components/charts/CallOutcomePieChart';
import { ConfirmationTrendChart } from '@/components/charts/ConfirmationTrendChart';
import { WeeklyCallsChart } from '@/components/charts/WeeklyCallsChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { DOSE_STATUS_META, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type { DashboardOverviewData } from '@/types';

export default function DashboardOverviewPage() {
  const [data, setData] = useState<DashboardOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<DashboardOverviewData>('/dashboard/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <Skeleton key={idx} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
          <h3 className="text-base font-bold text-slate-900">Unable to load dashboard</h3>
          <p className="text-sm text-slate-500">{error || 'No overview data available'}</p>
          <Button onClick={loadOverview}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const stats = data.statistics;

  const kpis = [
    {
      label: 'Total Family Members',
      value: stats.totalFamilyMembers,
      sub: `${stats.activeFamilyMembers} active profiles`,
      icon: Users,
      accent: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Active Medicines',
      value: stats.activeMedicines,
      sub: 'Prescriptions tracked',
      icon: Pill,
      accent: 'bg-sky-50 text-sky-600',
    },
    {
      label: 'Calls Scheduled Today',
      value: stats.callsScheduledToday,
      sub: 'Meal, med & confirmation',
      icon: CalendarClock,
      accent: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Calls Completed',
      value: stats.callsCompleted,
      sub: 'Answered or finished today',
      icon: PhoneCall,
      accent: 'bg-cyan-50 text-cyan-600',
    },
    {
      label: 'Reported Taken',
      value: stats.medicinesReportedTaken,
      sub: 'Explicitly confirmed today',
      icon: CheckCircle2,
      accent: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Reported Not Taken',
      value: stats.medicinesNotTaken,
      sub: 'Patient missed or skipped',
      icon: XCircle,
      accent: 'bg-rose-50 text-rose-600',
    },
    {
      label: 'Unconfirmed Doses',
      value: stats.unconfirmedDoses,
      sub: 'Never assumed taken',
      icon: Clock3,
      accent: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'Pending Callbacks',
      value: stats.pendingCallbacks,
      sub: 'Meal-delay & retry queue',
      icon: PhoneForwarded,
      accent: 'bg-violet-50 text-violet-600',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Family Care Overview
          </h1>
          <p className="text-sm text-slate-500">
            Live medicine adherence, voice call status, and family alerts from MongoDB.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={loadOverview}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/family">
              <Plus className="h-3.5 w-3.5" />
              Manage Family
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/medicines">
              <Pill className="h-3.5 w-3.5" />
              Add Medicine
            </Link>
          </Button>
        </div>
      </div>

      {/* Voice provider mode banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-blue-50 px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <PhoneCall className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs sm:text-sm font-bold text-slate-900">
              Voice Integration Mode:{' '}
              <span className="text-blue-700 uppercase">{data.environment.voiceMode}</span>
            </p>
            <p className="text-xs text-slate-500">
              {data.environment.telephonyReady
                ? 'Sarvam Voice Telephony is configured and active.'
                : 'Real telephone dialing is safely disabled until Sarvam credentials and phone number are configured. Mock simulation is available for testing.'}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Configure Voice & Safety</Link>
        </Button>
      </div>

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="hover:shadow-card-hover">
              <CardContent className="p-5 flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500">{kpi.label}</p>
                  <p className="mt-2 text-2xl font-extrabold text-slate-900">{kpi.value}</p>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">{kpi.sub}</p>
                </div>
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${kpi.accent}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 4 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Daily Medicine Adherence (7 Days)</CardTitle>
            <CardDescription>
              Confirmed taken percentage over total resolved daily doses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdherenceTrendChart data={data.charts.dailyAdherence} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weekly Calling Activity</CardTitle>
            <CardDescription>Completed calls, callbacks, and missed attempts</CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyCallsChart data={data.charts.weeklyCallingActivity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Medicine Confirmation Trends</CardTitle>
            <CardDescription>
              Clear separation of Taken, Unconfirmed, and Not Taken doses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmationTrendChart data={data.charts.medicineConfirmationTrends} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Call Outcome Distribution</CardTitle>
            <CardDescription>7-day telephone interaction outcome breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            <CallOutcomePieChart data={data.charts.callOutcomeDistribution} />
          </CardContent>
        </Card>
      </div>

      {/* 5 Overview Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Family Member Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Family Member Status</CardTitle>
              <CardDescription>Language, timezone & consent readiness</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/family">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.sections.familyMemberStatus.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No family members added yet"
                description="Add parents or elders to start scheduling multilingual medicine reminders."
                action={
                  <Button asChild size="sm">
                    <Link href="/family">Add First Family Member</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {data.sections.familyMemberStatus.map((member) => (
                  <Link
                    key={member.id}
                    href={`/family/${member.id}`}
                    className="flex items-center justify-between rounded-xl border border-sky-100 bg-sky-50/35 px-4 py-3 transition-colors hover:bg-sky-50"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-900">{member.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {member.relationship} • {getLanguageLabel(member.preferredLanguage)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={member.isActive ? 'success' : 'neutral'}>
                        {member.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Upcoming Calls */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Today&apos;s Upcoming Calls</CardTitle>
              <CardDescription>Scheduled meal, medicine & confirmation calls</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/schedules">Schedules</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.sections.todaysUpcomingCalls.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="No upcoming calls queued today"
                description="Once medicines and schedules are configured, queued voice calls appear here."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/schedules">View Dose Schedules</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {data.sections.todaysUpcomingCalls.map((call) => {
                  const member = call.familyMemberId as { fullName?: string } | undefined;
                  const med = call.medicineId as { name?: string; dosage?: string } | undefined;
                  return (
                    <div
                      key={String(call._id)}
                      className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {member?.fullName || 'Patient'} — {med?.name || 'Medicine'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {String(call.callType).replace(/_/g, ' ')} •{' '}
                          {formatDateTimeInTz(call.scheduledFor as string)}
                        </p>
                      </div>
                      <Badge variant="default">Queued</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Call History */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent Call History</CardTitle>
              <CardDescription>Latest AI reminder calls and outcomes</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/calls">Call Logs</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.sections.recentCallHistory.length === 0 ? (
              <EmptyState
                icon={PhoneCall}
                title="No voice calls placed yet"
                description="Use the Voice Calls console to simulate or inspect AI reminder conversations."
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/calls">Open Voice Calls</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {data.sections.recentCallHistory.map((log) => {
                  const member = log.familyMemberId as { fullName?: string } | undefined;
                  const med = log.medicineId as { name?: string } | undefined;
                  return (
                    <Link
                      key={String(log._id)}
                      href={`/calls/${String(log._id)}`}
                      className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-4 py-3 hover:bg-sky-50/50 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {member?.fullName || 'Patient'} • {med?.name || 'Dose Call'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {getLanguageLabel(String(log.language || 'en'))} •{' '}
                          {formatDateTimeInTz(log.createdAt as string)}
                        </p>
                      </div>
                      <Badge variant="indigo">{String(log.outcome || 'UNKNOWN')}</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Escalations & Missed Confirmations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Pending Escalations & Missed Doses</CardTitle>
              <CardDescription>Unconfirmed, missed, or unwell alerts</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/notifications">View Alerts</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.sections.pendingEscalations.length === 0 &&
            data.sections.missedMedicineConfirmations.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title="All clear — no pending escalations"
                description="Repeated missed answers, unconfirmed doses, or help requests will appear here immediately."
              />
            ) : (
              <div className="space-y-2.5">
                {data.sections.pendingEscalations.map((esc) => {
                  const member = esc.familyMemberId as { fullName?: string } | undefined;
                  return (
                    <div
                      key={String(esc._id)}
                      className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-rose-900">
                          {member?.fullName || 'Patient'} —{' '}
                          {String(esc.reason || 'ESCALATION').replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-rose-700">{String(esc.description || '')}</p>
                      </div>
                      <Badge variant="danger">{String(esc.severity || 'HIGH')}</Badge>
                    </div>
                  );
                })}
                {data.sections.missedMedicineConfirmations.map((dose) => {
                  const member = dose.familyMemberId as { fullName?: string } | undefined;
                  const med = dose.medicineId as { name?: string; dosage?: string } | undefined;
                  const statusKey = String(dose.status || 'UNCONFIRMED');
                  const meta = DOSE_STATUS_META[statusKey];
                  return (
                    <div
                      key={String(dose._id)}
                      className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {member?.fullName || 'Patient'} • {med?.name || 'Medicine'}
                          {med?.dosage ? ` (${med.dosage})` : ''}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTimeInTz(dose.scheduledAt as string)}
                        </p>
                      </div>
                      <Badge variant="warning">{meta?.label || statusKey}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

