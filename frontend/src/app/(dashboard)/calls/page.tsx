'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { MockCallSimulatorDialog } from '@/components/calls/MockCallSimulatorDialog';
import { RealTestCallDialog } from '@/components/calls/RealTestCallDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getCallLifecycleBadgeVariant, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type {
  CallLifecycleStatus,
  FamilyMember,
  LanguageStatus,
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

export default function CallsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const canSimulateRole = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [preflight, setPreflight] = useState<VoiceCallPreflight | null>(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [simOpen, setSimOpen] = useState(false);
  const [realCallOpen, setRealCallOpen] = useState(false);

  const loadCalls = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (memberFilter) params.set('familyMemberId', memberFilter);
        if (statusFilter) params.set('callStatus', statusFilter);
        if (outcomeFilter) params.set('outcome', outcomeFilter);
        if (modeFilter) params.set('mode', modeFilter);
        const q = params.toString() ? `?${params.toString()}` : '';

        const [callList, memberList, preflightRes] = await Promise.all([
          apiRequest<CallLogRow[]>(`/calls${q}`),
          apiRequest<FamilyMember[]>('/family-members'),
          apiRequest<VoiceCallPreflight>('/voice-calls/preflight'),
        ]);
        setCalls(callList);
        setMembers(memberList);
        setPreflight(preflightRes);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [memberFilter, statusFilter, outcomeFilter, modeFilter]
  );

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  const hasActiveCall = useMemo(
    () =>
      calls.some(
        (c) => c.callStatus && ACTIVE_STATUSES.includes(c.callStatus)
      ),
    [calls]
  );

  // Auto-poll silently when any call is actively dialing/ringing/in-progress
  useEffect(() => {
    if (!hasActiveCall) return;
    const timer = setInterval(() => {
      loadCalls(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveCall, loadCalls]);

  const mockSimulationAllowed =
    canSimulateRole && (preflight?.mockSimulationAllowed ?? false);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Voice Call Management
          </h1>
          <p className="text-sm text-slate-500">
            Separate live Sarvam Vobiz outbound calling (Admin-only) from dev Mock Voice Sandbox
            testing, with live call lifecycle tracking and recordings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" onClick={() => loadCalls()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {mockSimulationAllowed ? (
            <Button variant="outline" onClick={() => setSimOpen(true)}>
              <Sparkles className="h-4 w-4 text-amber-600" />
              Simulate Mock Call
            </Button>
          ) : null}
          {isAdmin ? (
            <Button onClick={() => setRealCallOpen(true)}>
              <PhoneCall className="h-4 w-4" />
              Place Real Test Call
            </Button>
          ) : null}
        </div>
      </div>

      {/* Calling Mode & Readiness Banner */}
      {preflight ? (
        preflight.liveCallingAllowed ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-3.5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-bold text-emerald-900">
                  Live Sarvam Vobiz Outbound Telephony Enabled
                </p>
                <p className="text-emerald-800">
                  Caller ID: {preflight.callerIdMasked || 'Configured'} • Agent v
                  {preflight.agentVersion} • HTTPS Webhook Ready
                  {mockSimulationAllowed
                    ? ' • Dev Mock Sandbox also active (all simulated logs are tagged MOCK)'
                    : ' • Mock Sandbox locked'}
                </p>
              </div>
            </div>
            <Badge variant="success">LIVE TELEPHONY READY</Badge>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-5 py-3.5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-bold text-amber-900">
                  Real Outbound Calling Locked — Mock Voice Sandbox Mode
                </p>
                <p className="text-amber-800">
                  Missing backend flags/config:{' '}
                  {[
                    ...preflight.missingTelephonyFields,
                    ...preflight.missingWebhookFields,
                  ].join(', ') || 'None'}
                  . Admins can still run preflight deployment checks inside Place Real Test Call.
                </p>
              </div>
            </div>
            <Badge variant="warning">MOCK SANDBOX</Badge>
          </div>
        )
      ) : null}

      {/* Filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          <SelectNative
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
          >
            <option value="">All Modes (Mock & Live)</option>
            <option value="live">Live Sarvam Calls Only</option>
            <option value="mock">Mock Sandbox Only</option>
          </SelectNative>
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
            <option value="LANGUAGE_FALLBACK_REQUIRED">Language Fallback Required</option>
            <option value="LANGUAGE_UNAVAILABLE">Language Unavailable</option>
            <option value="FAILED">Failed</option>
          </SelectNative>
          <SelectNative
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
          >
            <option value="">All Outcomes</option>
            <option value="PENDING">Pending Webhook</option>
            <option value="COMPLETED">Completed</option>
            <option value="ANSWERED">Answered (Dose Unconfirmed)</option>
            <option value="CALLBACK_REQUESTED">Callback Requested</option>
            <option value="NO_ANSWER">No Answer</option>
            <option value="BUSY">Busy</option>
            <option value="REJECTED">Rejected</option>
            <option value="NOT_CONNECTED">Not Connected</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="FAILED">Failed</option>
            <option value="ESCALATED">Escalated</option>
          </SelectNative>
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
          title="No voice calls logged yet"
          description="Admins can initiate a preflight-verified real Sarvam test call, or caregivers can simulate sandbox dialogues when mock mode is enabled."
          action={
            isAdmin ? (
              <Button onClick={() => setRealCallOpen(true)}>
                <PhoneCall className="h-4 w-4" />
                Place Real Test Call
              </Button>
            ) : mockSimulationAllowed ? (
              <Button variant="outline" onClick={() => setSimOpen(true)}>
                <Sparkles className="h-4 w-4" />
                Simulate Mock Call
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-sky-100 bg-sky-50/60 text-xs font-bold text-slate-600">
                  <th className="px-4 py-3">Patient & Phone</th>
                  <th className="px-4 py-3">Medicine & Dose</th>
                  <th className="px-4 py-3">Type & Source</th>
                  <th className="px-4 py-3">Scheduled / Started</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Lifecycle & Outcome</th>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3">Media</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100">
                {calls.map((c) => {
                  const isMockRow = c.isMock ?? c.mode === 'mock';
                  const lifecycle = c.callStatus ?? 'COMPLETED';
                  return (
                    <tr key={c._id} className="hover:bg-sky-50/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">
                          {c.familyMemberId?.fullName || 'Patient'}
                        </p>
                        <p className="text-xs text-slate-500">{c.phoneNumber}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {c.medicineId?.name || 'Medicine'} ({c.medicineId?.dosage || ''})
                        </p>
                        <p className="text-xs text-slate-500">
                          {c.doseInstanceId?.slotLabel || 'Dose'}
                        </p>
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        <p className="text-xs font-semibold text-slate-700">
                          {c.callType.replace(/_/g, ' ')}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={isMockRow ? 'warning' : 'success'}>
                            {isMockRow ? 'MOCK' : 'LIVE SARVAM'}
                          </Badge>
                          {c.isTestCall ? <Badge variant="default">TEST</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>Sch: {formatDateTimeInTz(c.scheduledAt, c.familyMemberId?.timezone)}</p>
                        <p>Act: {formatDateTimeInTz(c.startedAt, c.familyMemberId?.timezone)}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {c.durationSeconds}s
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={getCallLifecycleBadgeVariant(lifecycle)}>
                            {lifecycle}
                          </Badge>
                          <span className="text-[11px] text-slate-500">
                            Outcome: {c.outcome}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 space-y-1">
                        <div>{getLanguageLabel(c.requestedLanguage || c.language)}</div>
                        {c.actualLanguageUsed &&
                        c.actualLanguageUsed !== (c.requestedLanguage || c.language) ? (
                          <Badge variant="warning">
                            Actual: {getLanguageLabel(c.actualLanguageUsed)}
                          </Badge>
                        ) : c.languageStatus === 'FALLBACK_AUTHORIZED' ? (
                          <Badge variant="default">Fallback Authorized</Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              c.recordingStatus === 'AVAILABLE'
                                ? 'success'
                                : c.recordingStatus === 'CONSENT_DENIED'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            <Mic className="h-3 w-3" />
                            {c.recordingStatus === 'AVAILABLE'
                              ? 'Audio'
                              : c.recordingStatus === 'CONSENT_DENIED'
                                ? 'No Audio Consent'
                                : c.recordingStatus}
                          </Badge>
                          {c.transcriptAvailable ? (
                            <Badge variant="success">
                              <FileText className="h-3 w-3" />
                              Transcript
                            </Badge>
                          ) : c.transcriptStatus === 'CONSENT_DENIED' ? (
                            <Badge variant="warning">
                              <FileText className="h-3 w-3" />
                              No Text Consent
                            </Badge>
                          ) : c.transcriptStatus === 'PENDING' ? (
                            <Badge variant="neutral">
                              <FileText className="h-3 w-3" />
                              Text Syncing
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
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
              Real outbound phone calls can only be initiated by an authorized ADMIN user.
            </div>
          ) : null}
        </Card>
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
