'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Globe2,
  Loader2,
  Mic,
  PhoneForwarded,
  PhoneOff,
  RefreshCw,
  ShieldAlert,
  User,
  Volume2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { API_BASE, apiRequest, getStoredToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getCallLifecycleBadgeVariant, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type { CallLifecycleStatus, LanguageStatus, TranscriptStatus } from '@/types';

interface CallDetailPayload {
  callLog: {
    _id: string;
    familyMemberId?: {
      _id: string;
      fullName: string;
      phoneNumber: string;
      preferredLanguage: string;
      timezone: string;
      recordingConsentStatus: string;
      transcriptConsentStatus?: string;
      voiceCallingConsentStatus?: string;
    };
    medicineId?: {
      name: string;
      dosage: string;
      prescribedInstructions: string;
    };
    doseInstanceId?: {
      _id: string;
      slotLabel: string;
      status: string;
      mealStatus: string;
      scheduledAt: string;
    };
    mode: 'mock' | 'live';
    isMock?: boolean;
    isTestCall?: boolean;
    callPurpose?: string;
    callStatus?: CallLifecycleStatus;
    statusHistory?: Array<{
      status: CallLifecycleStatus;
      timestamp: string;
      source: string;
      note?: string;
    }>;
    webhookEvents?: Array<{
      eventId: string;
      receivedAt: string;
      source: 'WEBHOOK' | 'ANALYTICS_API';
      rawStatus: string;
      mappedStatus?: CallLifecycleStatus;
      sanitizedPayload?: Record<string, unknown>;
    }>;
    voiceCallingConsentGranted?: boolean;
    recordingConsentGranted?: boolean;
    audioRecordingConsentGranted?: boolean;
    transcriptConsentGranted?: boolean;
    provider: string;
    attemptId?: string;
    interactionId?: string;
    sarvamStatus?: string;
    providerStatusRaw?: string;
    failureReason?: string;
    providerResponseMeta?: Record<string, unknown>;
    callType: string;
    language: string;
    requestedLanguage?: string;
    actualLanguageUsed?: string;
    fallbackLanguage?: string;
    languageStatus?: LanguageStatus;
    outcome: string;
    durationSeconds: number;
    recordingStatus: string;
    recordingNote?: string;
    transcriptAvailable: boolean;
    transcriptStatus?: TranscriptStatus;
    transcriptSource?: 'WEBHOOK' | 'ANALYTICS_API' | 'MOCK';
    mealConfirmed: boolean | null;
    medicineConfirmed: string;
    aiSummary?: string;
    queuedAt?: string;
    initiatingAt?: string;
    ringingAt?: string;
    answeredAt?: string;
    startedAt?: string;
    endedAt?: string;
    lastStatusUpdateAt?: string;
    lastReconciledAt?: string;
    providerUpdatedAt?: string;
  };
  conversation?: {
    turns: Array<{
      speaker: 'AI' | 'PATIENT';
      text: string;
      translatedText?: string;
      timestamp: string;
      language?: string;
      turnId?: string;
      intent?: string;
    }>;
    patientResponses: {
      mealFinished: boolean | null;
      delayMinutes?: number;
      medicineTaken: boolean | null;
      feelingUnwell: boolean;
      requestedHelp: boolean;
    };
    finalAgentVariables?: Record<string, unknown>;
    aiSummary: string;
    safetyFlags: string[];
    actualLanguageUsed?: string;
    transcriptSource?: 'WEBHOOK' | 'ANALYTICS_API' | 'MOCK';
  };
  recording?: {
    id: string;
    mimeType: string;
    durationSeconds: number;
    consentVerified: boolean;
    provider?: string;
  } | null;
  escalations: Array<{
    _id: string;
    reason: string;
    severity: string;
    status: string;
    description: string;
  }>;
  callbacks: Array<{
    _id: string;
    requestedDelayMinutes: number;
    scheduledFor: string;
    status: string;
    reason: string;
  }>;
}

const ACTIVE_STATUSES: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'ANSWERED',
  'IN_PROGRESS',
];

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const callId = params?.id;
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [detail, setDetail] = useState<CallDetailPayload | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [recordingFetchNote, setRecordingFetchNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (silent = false, reconcile = false) => {
      if (!callId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const suffix = reconcile ? '?reconcile=true' : '';
        const data = await apiRequest<CallDetailPayload>(`/calls/${callId}${suffix}`);
        setDetail(data);

        const audioConsentAllowed =
          (data.callLog.audioRecordingConsentGranted ?? data.callLog.recordingConsentGranted) !==
            false && data.callLog.recordingStatus !== 'CONSENT_DENIED';

        if (
          audioConsentAllowed &&
          (data.recording?.consentVerified || data.callLog.recordingStatus === 'AVAILABLE')
        ) {
          const token = getStoredToken();
          const res = await fetch(`${API_BASE}/calls/${callId}/recording`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: 'include',
          });
          if (res.ok && res.headers.get('content-type')?.includes('audio')) {
            const blob = await res.blob();
            setAudioUrl(URL.createObjectURL(blob));
            setRecordingFetchNote(null);
          } else {
            setAudioUrl(null);
            if (!res.ok) {
              const maybeErr = await res.json().catch(() => null);
              if (maybeErr?.error?.message) {
                setRecordingFetchNote(String(maybeErr.error.message));
              }
            }
          }
        } else {
          setAudioUrl(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load call details');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [callId]
  );

  useEffect(() => {
    loadDetail();
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDetail]);

  const currentLifecycle = detail?.callLog.callStatus;
  const isCallActive = Boolean(
    currentLifecycle && ACTIVE_STATUSES.includes(currentLifecycle)
  );
  const isRecentLiveAsyncPending = Boolean(
    detail?.callLog.mode === 'live' &&
      !detail.callLog.isMock &&
      detail.callLog.provider === 'sarvam' &&
      detail.callLog.callStatus === 'COMPLETED' &&
      ((detail.callLog.transcriptConsentGranted &&
        !detail.callLog.transcriptAvailable &&
        detail.callLog.transcriptStatus === 'PENDING') ||
        (detail.callLog.audioRecordingConsentGranted !== false &&
          detail.callLog.recordingConsentGranted !== false &&
          detail.callLog.recordingStatus === 'PROCESSING')) &&
      (!detail.callLog.endedAt ||
        Date.now() - new Date(detail.callLog.endedAt).getTime() < 180_000)
  );

  useEffect(() => {
    if (!isCallActive && !isRecentLiveAsyncPending) return;
    const timer = setInterval(() => {
      loadDetail(true, true);
    }, 4000);
    return () => clearInterval(timer);
  }, [isCallActive, isRecentLiveAsyncPending, loadDetail]);

  const handleManualSync = async () => {
    if (!callId) return;
    setSyncing(true);
    try {
      const updated = await apiRequest<CallDetailPayload>(`/voice-calls/${callId}/reconcile`, {
        method: 'POST',
      });
      setDetail(updated);
      await loadDetail(true, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reconcile with Sarvam Analytics');
    } finally {
      setSyncing(false);
    }
  };

  const handleCancelCall = async () => {
    if (!callId) return;
    setCancelling(true);
    try {
      await apiRequest(`/voice-calls/${callId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Manually cancelled by Admin from Call Detail page',
        }),
      });
      await loadDetail(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel active call');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-rose-700">{error || 'Call log not found'}</p>
          <Button asChild variant="outline">
            <Link href="/calls">Back to Call Logs</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { callLog, conversation, recording, escalations, callbacks } = detail;
  const isMockCall = callLog.isMock ?? callLog.mode === 'mock';
  const lifecycleStatus = callLog.callStatus ?? 'COMPLETED';
  const requestedLang = callLog.requestedLanguage || callLog.language;
  const actualLang = callLog.actualLanguageUsed || conversation?.actualLanguageUsed;
  const transcriptAllowed =
    callLog.transcriptConsentGranted !== false &&
    callLog.transcriptStatus !== 'CONSENT_DENIED' &&
    callLog.familyMemberId?.transcriptConsentStatus !== 'DENIED' &&
    callLog.familyMemberId?.transcriptConsentStatus !== 'REVOKED';
  const audioConsentGranted =
    (callLog.audioRecordingConsentGranted ?? callLog.recordingConsentGranted) !== false &&
    callLog.recordingStatus !== 'CONSENT_DENIED';

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link href="/calls">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                {callLog.familyMemberId?.fullName || 'Patient'} — Voice Call Detail
              </h1>
              <Badge variant={isMockCall ? 'warning' : 'success'}>
                {isMockCall ? 'MOCK SANDBOX' : 'LIVE SARVAM'}
              </Badge>
              {callLog.isTestCall ? <Badge variant="default">TEST CALL</Badge> : null}
              <Badge variant={getCallLifecycleBadgeVariant(lifecycleStatus)}>
                {isCallActive ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {lifecycleStatus}
              </Badge>
              <Badge variant="neutral">Outcome: {callLog.outcome}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {callLog.medicineId?.name} ({callLog.medicineId?.dosage}) •{' '}
              {callLog.doseInstanceId?.slotLabel} • {getLanguageLabel(requestedLang)}
              {callLog.callPurpose ? ` • ${callLog.callPurpose}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isMockCall && callLog.provider === 'sarvam' ? (
            <Button variant="outline" size="sm" onClick={handleManualSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing Sarvam...' : 'Sync with Sarvam'}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadDetail(false, !isMockCall && callLog.provider === 'sarvam')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {isAdmin && isCallActive ? (
            <Button
              variant="softDestructive"
              size="sm"
              onClick={handleCancelCall}
              disabled={cancelling}
            >
              <PhoneOff className="h-3.5 w-3.5" />
              {cancelling ? 'Cancelling...' : 'Mark Cancelled'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* 3 Independent Consents + Language Verification Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-sky-200 bg-sky-50/50 px-4 py-3 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-800">
            Independent Call Permissions
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={callLog.voiceCallingConsentGranted !== false ? 'success' : 'danger'}
            >
              Automated Calls: {callLog.voiceCallingConsentGranted !== false ? 'GRANTED' : 'BLOCKED'}
            </Badge>
            <Badge variant={transcriptAllowed ? 'success' : 'warning'}>
              Transcript Storage:{' '}
              {transcriptAllowed
                ? 'GRANTED'
                : callLog.familyMemberId?.transcriptConsentStatus || 'DENIED'}
            </Badge>
            <Badge variant={audioConsentGranted ? 'success' : 'warning'}>
              Audio Recording:{' '}
              {audioConsentGranted
                ? 'GRANTED'
                : callLog.familyMemberId?.recordingConsentStatus || 'DENIED'}
            </Badge>
          </div>
          <p className="text-[11px] text-slate-600">
            Calling, Transcript Storage, and Audio Recording are strictly independent. Denying
            recording never hides an authorized transcript, and revoking transcript or recording
            purges saved records.
          </p>
        </div>

        <div
          className={`rounded-2xl border px-4 py-3 space-y-1.5 ${
            callLog.languageStatus === 'LANGUAGE_MISMATCH' ||
            callLog.languageStatus === 'LANGUAGE_UNAVAILABLE'
              ? 'border-rose-200 bg-rose-50/70'
              : callLog.languageStatus === 'FALLBACK_AUTHORIZED' ||
                  callLog.languageStatus === 'LANGUAGE_FALLBACK_REQUIRED'
                ? 'border-amber-200 bg-amber-50/70'
                : 'border-sky-200 bg-sky-50/50'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-800 flex items-center gap-1.5">
              <Globe2 className="h-3.5 w-3.5 text-blue-600" />
              Language Enforcement & Verification
            </p>
            {callLog.languageStatus ? (
              <Badge
                variant={
                  callLog.languageStatus === 'MATCHED'
                    ? 'success'
                    : callLog.languageStatus === 'LANGUAGE_MISMATCH' ||
                        callLog.languageStatus === 'LANGUAGE_UNAVAILABLE'
                      ? 'danger'
                      : 'warning'
                }
              >
                {callLog.languageStatus.replace(/_/g, ' ')}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>
              <strong>Requested:</strong> {getLanguageLabel(requestedLang)}
            </span>
            <span>
              <strong>Actual Spoken (Sarvam):</strong>{' '}
              {actualLang ? getLanguageLabel(actualLang) : 'Awaiting provider metadata'}
            </span>
            {callLog.fallbackLanguage ? (
              <span>
                <strong>Authorized Fallback:</strong> {getLanguageLabel(callLog.fallbackLanguage)}
              </span>
            ) : null}
          </div>
          {callLog.languageStatus === 'LANGUAGE_MISMATCH' ? (
            <p className="text-[11px] font-semibold text-rose-800">
              Mismatch detected: Sarvam reported speaking {getLanguageLabel(actualLang || '')} instead
              of {getLanguageLabel(requestedLang)}. Check that {getLanguageLabel(requestedLang)} and a
              matching voice are enabled in Sarvam Canvas → Language personalisation.
            </p>
          ) : null}
        </div>
      </div>

      {/* Confirmation Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Meal Confirmation</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant={
                callLog.mealConfirmed === true
                  ? 'success'
                  : callLog.mealConfirmed === false
                    ? 'warning'
                    : 'neutral'
              }
            >
              {callLog.mealConfirmed === true
                ? 'Meal Finished'
                : callLog.mealConfirmed === false
                  ? 'Meal Not Finished Yet'
                  : 'Not Confirmed'}
            </Badge>
            <p className="mt-2 text-xs text-slate-500">
              Meal responses never automatically mark medicine as taken.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Medicine Confirmation</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge
              variant={
                callLog.medicineConfirmed === 'TAKEN'
                  ? 'success'
                  : callLog.medicineConfirmed === 'NOT_TAKEN'
                    ? 'danger'
                    : 'warning'
              }
            >
              {callLog.medicineConfirmed}
            </Badge>
            <p className="mt-2 text-xs text-slate-500">
              Dose record status: {callLog.doseInstanceId?.status || '—'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Call Telemetry & Provider State</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 space-y-1">
            <p>
              <strong>Started:</strong>{' '}
              {formatDateTimeInTz(callLog.startedAt, callLog.familyMemberId?.timezone)}
            </p>
            <p>
              <strong>Answered:</strong>{' '}
              {callLog.answeredAt
                ? formatDateTimeInTz(callLog.answeredAt, callLog.familyMemberId?.timezone)
                : 'Not answered'}
            </p>
            <p>
              <strong>Ended:</strong>{' '}
              {callLog.endedAt
                ? formatDateTimeInTz(callLog.endedAt, callLog.familyMemberId?.timezone)
                : 'Awaiting completion'}
            </p>
            <p>
              <strong>Duration:</strong> {callLog.durationSeconds} seconds
            </p>
            {callLog.lastStatusUpdateAt ? (
              <p>
                <strong>Last Status Update:</strong>{' '}
                {formatDateTimeInTz(callLog.lastStatusUpdateAt, callLog.familyMemberId?.timezone)}
              </p>
            ) : null}
            {callLog.lastReconciledAt ? (
              <p>
                <strong>Last Sarvam Sync:</strong>{' '}
                {formatDateTimeInTz(callLog.lastReconciledAt, callLog.familyMemberId?.timezone)}
              </p>
            ) : null}
            {callLog.attemptId ? (
              <p className="truncate">
                <strong>Sarvam Attempt ID:</strong> {callLog.attemptId}
              </p>
            ) : null}
            {callLog.sarvamStatus || callLog.providerStatusRaw ? (
              <p>
                <strong>Sarvam Provider Status:</strong>{' '}
                {callLog.sarvamStatus || callLog.providerStatusRaw}
              </p>
            ) : null}
            {callLog.interactionId ? (
              <p className="truncate">
                <strong>Interaction ID:</strong> {callLog.interactionId}
              </p>
            ) : null}
            {callLog.failureReason ? (
              <p className="text-rose-700">
                <strong>Failure / Cancel Reason:</strong> {callLog.failureReason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Call Lifecycle Timeline & Webhook Events */}
      {(callLog.statusHistory && callLog.statusHistory.length > 0) ||
      (callLog.webhookEvents && callLog.webhookEvents.length > 0) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {callLog.statusHistory && callLog.statusHistory.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock3 className="h-4 w-4 text-blue-600" />
                  Call Lifecycle Timeline
                </CardTitle>
                <CardDescription>
                  Audit trail across QUEUED, INITIATING, RINGING, ANSWERED, IN_PROGRESS, and
                  terminal outcomes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {callLog.statusHistory.map((evt, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/40 px-4 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={getCallLifecycleBadgeVariant(evt.status)}>{evt.status}</Badge>
                      <Badge variant="neutral">{evt.source}</Badge>
                      {evt.note ? <span className="text-slate-700">{evt.note}</span> : null}
                    </div>
                    <span className="text-slate-500 shrink-0">
                      {formatDateTimeInTz(evt.timestamp, callLog.familyMemberId?.timezone)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {callLog.webhookEvents && callLog.webhookEvents.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="h-4 w-4 text-blue-600" />
                  Provider Webhook & Analytics Events
                </CardTitle>
                <CardDescription>
                  Sanitized status deliveries from Sarvam webhook and Analytics API reconciliation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {callLog.webhookEvents.map((wEvt, idx) => (
                  <div
                    key={`${wEvt.eventId}-${idx}`}
                    className="rounded-xl border border-sky-100 bg-sky-50/40 px-4 py-2.5 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">{wEvt.source}</Badge>
                        <Badge variant={getCallLifecycleBadgeVariant(wEvt.mappedStatus)}>
                          raw: {wEvt.rawStatus} → {wEvt.mappedStatus || '—'}
                        </Badge>
                      </div>
                      <span className="text-slate-500">
                        {formatDateTimeInTz(wEvt.receivedAt, callLog.familyMemberId?.timezone)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* AI Summary & Audio Recording Player */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              AI Call Summary
            </CardTitle>
            <CardDescription>Automated factual summary & safety flags</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 text-sm text-slate-700 leading-relaxed">
              {conversation?.aiSummary || callLog.aiSummary || 'No summary generated.'}
            </p>
            {transcriptAllowed &&
            conversation?.finalAgentVariables &&
            Object.keys(conversation.finalAgentVariables).length > 0 ? (
              <div className="rounded-xl border border-sky-100 bg-white p-3 text-xs text-slate-700 space-y-1">
                <p className="font-bold text-blue-700">Final Agent Variables</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(conversation.finalAgentVariables).map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="font-semibold">{k}:</span> {String(v)}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {conversation?.safetyFlags && conversation.safetyFlags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {conversation.safetyFlags.map((flag) => (
                  <Badge key={flag} variant="default">
                    {flag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-blue-600" />
              Authorized Audio Recording
            </CardTitle>
            <CardDescription>
              Protected by family JWT isolation & patient CALL_RECORDING consent
            </CardDescription>
          </CardHeader>
          <CardContent>
            {audioUrl && audioConsentGranted ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold text-blue-700">
                    Recording verified ({recording?.durationSeconds ?? callLog.durationSeconds}s)
                  </span>
                  <Badge variant="success">CALL_RECORDING Granted</Badge>
                </div>
                <audio controls src={audioUrl} className="w-full" />
              </div>
            ) : (
              <EmptyState
                icon={callLog.recordingStatus === 'CONSENT_DENIED' ? ShieldAlert : Mic}
                title={
                  callLog.recordingStatus === 'CONSENT_DENIED'
                    ? 'Audio recording withheld (CALL_RECORDING consent not granted)'
                    : callLog.recordingStatus === 'PROCESSING'
                      ? 'Audio recording pending on Sarvam Analytics'
                      : 'Audio recording unavailable'
                }
                description={
                  callLog.recordingStatus === 'CONSENT_DENIED'
                    ? 'CALL_RECORDING consent is not GRANTED or was revoked. Audio is blocked/deleted while authorized transcripts remain unaffected.'
                    : recordingFetchNote ||
                      callLog.recordingNote ||
                      (callLog.recordingStatus === 'PROCESSING'
                        ? 'Sarvam Analytics can take up to ~60 seconds to archive call audio. Click Sync with Sarvam to check again.'
                        : 'No audio recording is available from Sarvam Analytics for this call.')
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversation Transcript */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Conversation Transcript</CardTitle>
            <CardDescription>
              Turn-by-turn dialogue in {getLanguageLabel(actualLang || requestedLang)} with
              caregiver notes
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {(callLog.transcriptSource || conversation?.transcriptSource) ? (
              <Badge variant="neutral">
                Source: {callLog.transcriptSource || conversation?.transcriptSource}
              </Badge>
            ) : null}
            {callLog.transcriptStatus ? (
              <Badge
                variant={
                  callLog.transcriptStatus === 'AVAILABLE'
                    ? 'success'
                    : callLog.transcriptStatus === 'CONSENT_DENIED'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {callLog.transcriptStatus}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {!transcriptAllowed || callLog.transcriptStatus === 'CONSENT_DENIED' ? (
            <EmptyState
              icon={ShieldAlert}
              title="Transcript withheld — CALL_TRANSCRIPT consent not granted"
              description="Patient CALL_TRANSCRIPT consent is denied, pending, or revoked. Grant CALL_TRANSCRIPT on the family member profile to store and inspect future call transcripts (independent from CALL_RECORDING)."
            />
          ) : !conversation || conversation.turns.length === 0 ? (
            <EmptyState
              icon={Bot}
              title={
                callLog.transcriptStatus === 'PENDING'
                  ? 'Waiting for Sarvam transcript sync'
                  : 'No conversation turns recorded'
              }
              description={
                callLog.transcriptStatus === 'PENDING'
                  ? 'Live Sarvam Analytics transcripts typically appear within ~60 seconds of call completion. Click Sync with Sarvam to fetch now.'
                  : 'Unanswered, busy, rejected, not-connected, or still-dialing calls do not have spoken dialogue, or the provider returned no dialogue turns.'
              }
            />
          ) : (
            <div className="space-y-3">
              {conversation.turns.map((turn, idx) => (
                <div
                  key={turn.turnId || idx}
                  className={`flex gap-3 rounded-2xl border p-4 ${
                    turn.speaker === 'AI'
                      ? 'border-sky-100 bg-sky-50/50'
                      : 'border-blue-200 bg-white'
                  }`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      turn.speaker === 'AI'
                        ? 'bg-blue-600 text-white'
                        : 'bg-sky-100 text-blue-700'
                    }`}
                  >
                    {turn.speaker === 'AI' ? (
                      <Bot className="h-4 w-4" />
                    ) : (
                      <User className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          {turn.speaker === 'AI' ? 'CareVoice AI Assistant' : 'Patient'}
                        </span>
                        {turn.language ? (
                          <Badge variant="neutral">{getLanguageLabel(turn.language)}</Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {turn.intent ? <Badge variant="neutral">{turn.intent}</Badge> : null}
                        {turn.timestamp ? (
                          <span className="text-[11px] text-slate-400">
                            {formatDateTimeInTz(turn.timestamp, callLog.familyMemberId?.timezone)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-sm text-slate-900">{turn.text}</p>
                    {turn.translatedText ? (
                      <p className="text-xs text-slate-500">
                        Caregiver note / translation: {turn.translatedText}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Callbacks & Escalations */}
      {(callbacks.length > 0 || escalations.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {callbacks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneForwarded className="h-4 w-4 text-blue-600" />
                  Callbacks Created From This Call
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {callbacks.map((cb) => (
                  <div
                    key={cb._id}
                    className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span>+{cb.requestedDelayMinutes} minutes</span>
                      <Badge variant="indigo">{cb.status}</Badge>
                    </div>
                    <p className="mt-1 text-slate-600">{cb.reason}</p>
                    <p className="mt-1 text-slate-500">
                      Scheduled: {formatDateTimeInTz(cb.scheduledFor, callLog.familyMemberId?.timezone)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {escalations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  Safety Escalations Triggered
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {escalations.map((esc) => (
                  <div
                    key={esc._id}
                    className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between font-bold text-rose-900">
                      <span>{esc.reason.replace(/_/g, ' ')}</span>
                      <Badge variant="danger">{esc.severity}</Badge>
                    </div>
                    <p className="mt-1 text-rose-700">{esc.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
