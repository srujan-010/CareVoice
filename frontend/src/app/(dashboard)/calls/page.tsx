'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Mic,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { CallSummaryCard } from '@/components/calls/CallSummaryCard';
import { MockCallSimulatorDialog } from '@/components/calls/MockCallSimulatorDialog';
import { RealTestCallDialog } from '@/components/calls/RealTestCallDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getCallLifecycleBadgeVariant, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import {
  formatConfigFieldLabel,
  getCallLifecycleDisplay,
  getCallModeDisplay,
  getCallOutcomeDisplay,
  getCallTypeDisplay,
  getRecordingStatusDisplay,
  getTranscriptStatusDisplay,
  translateVoiceError,
} from '@/lib/voiceDisplay';
import type {
  CallLifecycleStatus,
  FamilyMember,
  LanguageStatus,
  TodayLiveCallStats,
  TranscriptStatus,
  VoiceCallPreflight,
} from '@/types';

interface CallLogRow {
  _id: string;
  familyMemberId?: { _id: string; fullName: string; phoneNumber: string; timezone?: string };
  medicineId?: { _id: string; name: string; dosage: string };
  doseInstanceId?: { _id: string; slotLabel: string; scheduledAt: string };
  callType: string;
  phoneNumber: string;
  language: string;
  requestedLanguage?: string;
  actualLanguageUsed?: string;
  languageStatus?: LanguageStatus;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  durationSeconds: number;
  callStatus?: CallLifecycleStatus;
  outcome: string;
  recordingStatus: string;
  transcriptAvailable: boolean;
  transcriptStatus?: TranscriptStatus;
  audioRecordingConsentGranted?: boolean;
  transcriptConsentGranted?: boolean;
  mealConfirmed: boolean | null;
  medicineConfirmed: string;
  mode: 'mock' | 'live';
  isMock?: boolean;
  isTestCall?: boolean;
  callPurpose?: string;
  attemptId?: string;
}

const ACTIVE_STATUSES: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'ANSWERED',
  'IN_PROGRESS',
];

function getLocalDateKey(isoOrDate: string | Date | undefined, timezone: string): string {
  if (!isoOrDate) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate);
  } catch {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
}

function computeFallbackTodayStats(
  allCalls: CallLogRow[],
  callbacks: Array<{ status?: string }>,
  timezone: string
): TodayLiveCallStats {
  const dateLocal = getLocalDateKey(new Date(), timezone) || new Date().toISOString().slice(0, 10);
  let totalCalls = 0;
  let successfullyConnected = 0;
  let noAnswer = 0;
  let failedCalls = 0;
  let mockCallsToday = 0;

  for (const call of allCalls) {
    const refTs = call.createdAt || call.scheduledAt;
    if (getLocalDateKey(refTs, timezone) !== dateLocal) continue;

    if (call.isMock || call.mode === 'mock') {
      mockCallsToday += 1;
      continue;
    }

    totalCalls += 1;
    const status = String(call.callStatus || '').toUpperCase();
    const outcome = String(call.outcome || '').toUpperCase();

    if (
      status === 'COMPLETED' ||
      status === 'ANSWERED' ||
      outcome === 'COMPLETED' ||
      outcome === 'ANSWERED' ||
      outcome === 'CALLBACK_REQUESTED'
    ) {
      successfullyConnected += 1;
    } else if (
      status === 'NO_ANSWER' ||
      status === 'BUSY' ||
      status === 'REJECTED' ||
      outcome === 'NO_ANSWER' ||
      outcome === 'BUSY' ||
      outcome === 'REJECTED'
    ) {
      noAnswer += 1;
    } else if (
      status === 'FAILED' ||
      status === 'NOT_CONNECTED' ||
      status === 'PROVIDER_UNAVAILABLE' ||
      status === 'LANGUAGE_UNAVAILABLE' ||
      status === 'LANGUAGE_FALLBACK_REQUIRED' ||
      outcome === 'FAILED' ||
      outcome === 'NOT_CONNECTED'
    ) {
      failedCalls += 1;
    }
  }

  const pendingCallbacks = callbacks.filter((cb) => {
    const st = String(cb.status || '').toUpperCase();
    return st === 'SCHEDULED' || st === 'PENDING';
  }).length;

  return {
    dateLocal,
    timezone,
    totalCalls,
    successfullyConnected,
    noAnswer,
    failedCalls,
    pendingCallbacks,
    mockCallsToday,
  };
}

export default function CallsPage() {
  const router = useRouter();
  const { user, family } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const canSimulateRole = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';
  const workspaceTimezone = family?.timezone || 'Asia/Kolkata';

  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [todayStats, setTodayStats] = useState<TodayLiveCallStats | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [preflight, setPreflight] = useState<VoiceCallPreflight | null>(null);

  const [memberFilter, setMemberFilter] = useState('');
  const [callTypeFilter, setCallTypeFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [realCallOpen, setRealCallOpen] = useState(false);
  const pollInFlightRef = useRef(false);
  const statsEndpointUnavailableRef = useRef(false);

  const loadTodayStatsSafe = useCallback(
    async (prefetchedUnfilteredCalls?: CallLogRow[]): Promise<TodayLiveCallStats | null> => {
      if (!statsEndpointUnavailableRef.current) {
        try {
          return await apiRequest<TodayLiveCallStats>('/calls/stats/today');
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 404) {
            statsEndpointUnavailableRef.current = true;
          } else {
            return null;
          }
        }
      }

      try {
        const [allCalls, callbacks] = await Promise.all([
          prefetchedUnfilteredCalls
            ? Promise.resolve(prefetchedUnfilteredCalls)
            : apiRequest<CallLogRow[]>('/calls'),
          apiRequest<Array<{ status?: string }>>('/callbacks').catch(() => []),
        ]);
        return computeFallbackTodayStats(allCalls, callbacks, workspaceTimezone);
      } catch {
        return null;
      }
    },
    [workspaceTimezone]
  );

  const loadCalls = useCallback(
    async (silent = false) => {
      if (silent && pollInFlightRef.current) return;
      if (silent) {
        pollInFlightRef.current = true;
      } else {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const params = new URLSearchParams();
        if (memberFilter) params.set('familyMemberId', memberFilter);
        if (callTypeFilter) params.set('callType', callTypeFilter);
        if (modeFilter) params.set('mode', modeFilter);
        if (statusFilter) params.set('callStatus', statusFilter);
        if (outcomeFilter) params.set('outcome', outcomeFilter);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        const queryString = params.toString();
        const q = queryString ? `?${queryString}` : '';
        const isUnfiltered = !queryString;

        if (silent) {
          const callList = await apiRequest<CallLogRow[]>(`/calls${q}`);
          setCalls(callList);
          const statsRes = await loadTodayStatsSafe(isUnfiltered ? callList : undefined);
          if (statsRes) setTodayStats(statsRes);
          setPollWarning(null);
        } else {
          const [callList, memberList, preflightRes] = await Promise.all([
            apiRequest<CallLogRow[]>(`/calls${q}`),
            apiRequest<FamilyMember[]>('/family-members'),
            apiRequest<VoiceCallPreflight>('/voice-calls/preflight'),
          ]);
          setCalls(callList);
          setMembers(memberList);
          setPreflight(preflightRes);
          const statsRes = await loadTodayStatsSafe(isUnfiltered ? callList : undefined);
          if (statsRes) setTodayStats(statsRes);
          setLoadError(null);
          setPollWarning(null);
        }
      } catch (err) {
        const message = translateVoiceError(
          err instanceof Error ? err.message : undefined,
          'Unable to reach CareVoice API. Retrying automatically.'
        );
        if (silent) {
          setPollWarning(message);
        } else {
          setLoadError(message);
        }
      } finally {
        if (silent) {
          pollInFlightRef.current = false;
        } else {
          setLoading(false);
        }
      }
    },
    [
      memberFilter,
      callTypeFilter,
      modeFilter,
      statusFilter,
      outcomeFilter,
      dateFrom,
      dateTo,
      loadTodayStatsSafe,
    ]
  );

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  const hasActiveCall = useMemo(
    () => calls.some((c) => c.callStatus && ACTIVE_STATUSES.includes(c.callStatus)),
    [calls]
  );

  useEffect(() => {
    if (!hasActiveCall) return;
    const timer = setInterval(() => {
      loadCalls(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveCall, loadCalls]);

  const mockSimulationAllowed =
    canSimulateRole && (preflight?.mockSimulationAllowed ?? false);

  const hasActiveFilters = Boolean(
    memberFilter || callTypeFilter || modeFilter || statusFilter || outcomeFilter || dateFrom || dateTo
  );

  const handleResetFilters = () => {
    setMemberFilter('');
    setCallTypeFilter('');
    setModeFilter('');
    setStatusFilter('');
    setOutcomeFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const kpiCards = [
    {
      label: 'Total Calls',
      value: todayStats?.totalCalls ?? 0,
      sub: 'Live calls placed today',
      icon: PhoneCall,
      accent: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Successfully Connected',
      value: todayStats?.successfullyConnected ?? 0,
      sub: 'Answered or completed',
      icon: CheckCircle2,
      accent: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'No Answer',
      value: todayStats?.noAnswer ?? 0,
      sub: 'Unanswered / busy / declined',
      icon: PhoneMissed,
      accent: 'bg-amber-50 text-amber-600',
    },
    {
      label: 'Failed Calls',
      value: todayStats?.failedCalls ?? 0,
      sub: 'Delivery or service errors',
      icon: PhoneOff,
      accent: 'bg-rose-50 text-rose-600',
    },
    {
      label: 'Pending Callbacks',
      value: todayStats?.pendingCallbacks ?? 0,
      sub: 'Scheduled retry queue',
      icon: PhoneForwarded,
      accent: 'bg-indigo-50 text-indigo-600',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Voice Call Management
          </h1>
          <p className="text-sm text-slate-500">
            Manage patient reminders, conversations and call activity.
          </p>
        </div>

        <div className="flex flex-col min-[420px]:flex-row min-[420px]:flex-wrap items-stretch min-[420px]:items-center gap-2.5">
          <Button variant="outline" onClick={() => loadCalls()} className="w-full min-[420px]:w-auto">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {mockSimulationAllowed ? (
            <Button
              variant="outline"
              onClick={() => setSimOpen(true)}
              className="w-full min-[420px]:w-auto"
            >
              <Sparkles className="h-4 w-4 text-amber-600" />
              Simulate Test Call
            </Button>
          ) : null}
          {isAdmin ? (
            <Button onClick={() => setRealCallOpen(true)} className="w-full min-[420px]:w-auto">
              <PhoneCall className="h-4 w-4" />
              Place Real Test Call
            </Button>
          ) : null}
        </div>
      </div>

      {/* Network / API Error Banner */}
      {loadError || pollWarning ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-xs sm:text-sm text-rose-800">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <span>{loadError || `Live refresh paused briefly: ${pollWarning}`}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadCalls(false)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : null}

      {/* Today's Live Call Statistics (Strictly excludes Test Environment simulations) */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-3.5">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label} className="hover:shadow-card-hover">
                <CardContent className="p-3.5 sm:p-4 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-slate-500">{card.label}</p>
                    <p className="mt-1.5 text-xl sm:text-2xl font-extrabold text-slate-900">
                      {todayStats ? card.value : '—'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{card.sub}</p>
                  </div>
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${card.accent}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {todayStats ? (
          <p className="text-[11px] text-slate-500">
            Today&apos;s Call Statistics reflect real patient calls only ({todayStats.dateLocal} •{' '}
            {todayStats.timezone}). Test Environment simulations
            {(todayStats.mockCallsToday ?? 0) > 0
              ? ` (${todayStats.mockCallsToday} run today)`
              : ''}{' '}
            are strictly excluded from patient metrics.
          </p>
        ) : null}
      </div>

      {/* Calling Mode & Readiness Banner */}
      {preflight ? (
        preflight.liveCallingAllowed ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-3.5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-bold text-emerald-900">CareVoice Voice Service Active</p>
                <p className="text-emerald-800">
                  CareVoice Calling Number: {preflight.callerIdMasked || 'Configured'} • Voice Profile
                  v{preflight.agentVersion} • Call Event Connection Ready
                  {mockSimulationAllowed
                    ? ' • Test Environment simulation also available (tagged TEST)'
                    : ''}
                </p>
              </div>
            </div>
            <Badge variant="success" className="shrink-0 whitespace-nowrap">
              LIVE VOICE READY
            </Badge>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-5 py-3.5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-bold text-amber-900">
                  Live Voice Calling Disabled — Test Environment Active
                </p>
                <p className="text-amber-800">
                  Missing server configuration:{' '}
                  {[
                    ...preflight.missingTelephonyFields,
                    ...preflight.missingWebhookFields,
                  ]
                    .map(formatConfigFieldLabel)
                    .join(', ') || 'None'}
                  . Admins can verify CareVoice Voice Service readiness inside Place Real Test Call.
                </p>
              </div>
            </div>
            <Badge variant="warning" className="shrink-0 whitespace-nowrap">
              TEST ENVIRONMENT
            </Badge>
          </div>
        )
      ) : null}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Family Member
              </label>
              <SelectNative
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
              >
                <option value="">All Family Members</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </SelectNative>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Call Type
              </label>
              <SelectNative
                value={callTypeFilter}
                onChange={(e) => setCallTypeFilter(e.target.value)}
              >
                <option value="">All Call Types</option>
                <option value="MEAL_REMINDER">Meal Reminder</option>
                <option value="MEDICINE_REMINDER">Medicine Reminder</option>
                <option value="CONFIRMATION_CALL">Dose Confirmation</option>
                <option value="CALLBACK">Scheduled Callback</option>
                <option value="ADMIN_TEST_CALL">Admin Test Call</option>
              </SelectNative>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Call Mode
              </label>
              <SelectNative
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
              >
                <option value="">All Modes (Live &amp; Test)</option>
                <option value="live">Live Calls</option>
                <option value="mock">Test Environment</option>
              </SelectNative>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Call Lifecycle
              </label>
              <SelectNative
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Lifecycle Stages</option>
                <option value="QUEUED">Queued</option>
                <option value="INITIATING">Initiating</option>
                <option value="RINGING">Ringing</option>
                <option value="ANSWERED">Answered</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="NO_ANSWER">No Answer</option>
                <option value="BUSY">Busy</option>
                <option value="REJECTED">Rejected</option>
                <option value="NOT_CONNECTED">Not Connected</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="PROVIDER_UNAVAILABLE">Service Unavailable</option>
                <option value="LANGUAGE_FALLBACK_REQUIRED">Language Fallback Required</option>
                <option value="LANGUAGE_UNAVAILABLE">Language Unavailable</option>
                <option value="FAILED">Failed</option>
              </SelectNative>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Outcome
              </label>
              <SelectNative
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
              >
                <option value="">All Outcomes</option>
                <option value="PENDING">Awaiting Update</option>
                <option value="COMPLETED">Completed</option>
                <option value="ANSWERED">Answered</option>
                <option value="CALLBACK_REQUESTED">Callback Requested</option>
                <option value="NO_ANSWER">No Answer</option>
                <option value="BUSY">Line Busy</option>
                <option value="REJECTED">Declined</option>
                <option value="NOT_CONNECTED">Not Connected</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="FAILED">Failed</option>
                <option value="ESCALATED">Escalated</option>
              </SelectNative>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-1">
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3 w-full sm:w-auto">
              <div className="min-w-0">
                <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                  Date From
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                  Date To
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
            </div>

            {hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="w-full sm:w-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Filters
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : calls.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title={hasActiveFilters ? 'No calls match the selected filters' : 'No voice calls logged yet'}
          description={
            hasActiveFilters
              ? 'Try clearing or adjusting your filter criteria to see more call records.'
              : 'Administrators can place a supervised test call when live calling is ready, or run Test Environment simulations during development.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={handleResetFilters}>
                <RotateCcw className="h-4 w-4" />
                Clear Filters
              </Button>
            ) : isAdmin ? (
              <Button onClick={() => setRealCallOpen(true)}>
                <PhoneCall className="h-4 w-4" />
                Place Real Test Call
              </Button>
            ) : mockSimulationAllowed ? (
              <Button variant="outline" onClick={() => setSimOpen(true)}>
                <Sparkles className="h-4 w-4" />
                Simulate Test Call
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile (<768px): Structured Call Summary Cards */}
          <div className="space-y-3 md:hidden">
            {calls.map((c) => (
              <CallSummaryCard key={c._id} call={c} />
            ))}
            {!isAdmin ? (
              <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-[11px] text-slate-600 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                Live test phone calls can only be initiated by an authorized ADMIN user.
              </div>
            ) : null}
          </div>

          {/* Tablet (md+) & Desktop (lg+): Responsive Data Table */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs xl:text-sm">
                <thead>
                  <tr className="border-b border-sky-100 bg-sky-50/60 text-[11px] xl:text-xs font-bold text-slate-600">
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Patient &amp; Phone</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Medicine &amp; Dose</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Call Type &amp; Mode</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Scheduled / Started</th>
                    <th className="hidden xl:table-cell px-4 py-3">Duration</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Lifecycle &amp; Outcome</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Language</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3">Media &amp; Transcript</th>
                    <th className="px-2.5 xl:px-4 py-2.5 xl:py-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sky-100">
                  {calls.map((c) => {
                    const isMockRow = c.isMock ?? c.mode === 'mock';
                    const lifecycleDisplay = getCallLifecycleDisplay(c.callStatus);
                    const outcomeDisplay = getCallOutcomeDisplay(c.outcome);
                    const modeDisplay = getCallModeDisplay(isMockRow);
                    const recDisplay = getRecordingStatusDisplay(c.recordingStatus);
                    const txDisplay = getTranscriptStatusDisplay(
                      c.transcriptStatus ?? (c.transcriptAvailable ? 'AVAILABLE' : undefined)
                    );
                    return (
                      <tr key={c._id} className="hover:bg-sky-50/40 transition-colors">
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3">
                          <p className="font-bold text-slate-900">
                            {c.familyMemberId?.fullName || 'Patient'}
                          </p>
                          <p className="text-[11px] xl:text-xs text-slate-500 whitespace-nowrap">
                            {c.phoneNumber}
                          </p>
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3">
                          <p className="font-semibold text-slate-800">
                            {c.medicineId?.name || 'Medicine'}
                            {c.medicineId?.dosage ? ` (${c.medicineId.dosage})` : ''}
                          </p>
                          <p className="text-[11px] xl:text-xs text-slate-500">
                            {c.doseInstanceId?.slotLabel || 'Dose'}
                          </p>
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3 space-y-1">
                          <p className="text-[11px] xl:text-xs font-semibold text-slate-700">
                            {getCallTypeDisplay(c.callType)}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={modeDisplay.badgeVariant}>{modeDisplay.shortLabel}</Badge>
                            {c.isTestCall ? <Badge variant="default">ADMIN TEST</Badge> : null}
                          </div>
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3 text-[11px] xl:text-xs text-slate-600">
                          <p>Sch: {formatDateTimeInTz(c.scheduledAt, c.familyMemberId?.timezone)}</p>
                          <p>Act: {formatDateTimeInTz(c.startedAt, c.familyMemberId?.timezone)}</p>
                        </td>
                        <td className="hidden xl:table-cell px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                          {c.durationSeconds}s
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3">
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={getCallLifecycleBadgeVariant(c.callStatus)}>
                              {lifecycleDisplay.label}
                            </Badge>
                            <span className="text-[11px] text-slate-500">
                              {outcomeDisplay.label}
                              <span className="xl:hidden"> • {c.durationSeconds}s</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3 text-[11px] xl:text-xs text-slate-700 space-y-1">
                          <div>{getLanguageLabel(c.requestedLanguage || c.language)}</div>
                          {c.actualLanguageUsed &&
                          c.actualLanguageUsed !== (c.requestedLanguage || c.language) ? (
                            <Badge variant="warning">
                              Spoken: {getLanguageLabel(c.actualLanguageUsed)}
                            </Badge>
                          ) : c.languageStatus === 'FALLBACK_AUTHORIZED' ? (
                            <Badge variant="default">Fallback Authorized</Badge>
                          ) : null}
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={recDisplay.badgeVariant}>
                              <Mic className="h-3 w-3 shrink-0" />
                              {recDisplay.label}
                            </Badge>
                            <Badge variant={txDisplay.badgeVariant}>
                              <FileText className="h-3 w-3 shrink-0" />
                              {txDisplay.label}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-2.5 xl:px-4 py-2.5 xl:py-3 text-right">
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/calls/${c._id}`}>Inspect</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!isAdmin ? (
              <div className="border-t border-sky-100 bg-sky-50/40 px-4 py-2.5 text-[11px] text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                Live test phone calls can only be initiated by an authorized ADMIN user.
              </div>
            ) : null}
          </Card>
        </>
      )}

      <MockCallSimulatorDialog
        open={simOpen}
        onOpenChange={setSimOpen}
        onSimulated={(newId) => {
          loadCalls();
          if (newId) router.push(`/calls/${newId}`);
        }}
      />

      <RealTestCallDialog
        open={realCallOpen}
        onOpenChange={setRealCallOpen}
        onCallStartedOrUpdated={() => {
          loadCalls(true);
        }}
        onInspectCall={(id) => router.push(`/calls/${id}`)}
      />
    </div>
  );
}
