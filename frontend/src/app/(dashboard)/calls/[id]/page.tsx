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
import { getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type { CallLifecycleStatus } from '@/types';

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
    recordingConsentGranted?: boolean;
    transcriptConsentGranted?: boolean;
    provider: string;
    attemptId?: string;
    interactionId?: string;
    sarvamStatus?: string;
    failureReason?: string;
    providerResponseMeta?: Record<string, unknown>;
    callType: string;
    language: string;
    outcome: string;
    durationSeconds: number;
    recordingStatus: string;
    transcriptAvailable: boolean;
    mealConfirmed: boolean | null;
    medicineConfirmed: string;
    aiSummary?: string;
    queuedAt?: string;
    initiatingAt?: string;
    ringingAt?: string;
    answeredAt?: string;
    startedAt?: string;
    endedAt?: string;
  };
  conversation?: {
    turns: Array<{
      speaker: 'AI' | 'PATIENT';
      text: string;
      translatedText?: string;
      timestamp: string;
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
  'IN_PROGRESS',
];

export default function CallDetailPage() {
  const params = useParams<{ id: string }>();
  const callId = params?.id;
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [detail, setDetail] = useState<CallDetailPayload | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!callId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await apiRequest<CallDetailPayload>(`/calls/${callId}`);
        setDetail(data);

        if (
          data.recording?.consentVerified ||
          (data.callLog.recordingConsentGranted &&
            data.callLog.recordingStatus === 'AVAILABLE')
        ) {
          const token = getStoredToken();
          const res = await fetch(`${API_BASE}/calls/${callId}/recording`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: 'include',
          });
          if (res.ok && res.headers.get('content-type')?.includes('audio')) {
            const blob = await res.blob();
            setAudioUrl(URL.createObjectURL(blob));
          }
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

  useEffect(() => {
    if (!isCallActive) return;
    const timer = setInterval(() => {
      loadDetail(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [isCallActive, loadDetail]);

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
              <Badge
                variant={
                  lifecycleStatus === 'COMPLETED'
                    ? 'success'
                    : lifecycleStatus === 'FAILED' || lifecycleStatus === 'REJECTED'
                      ? 'danger'
                      : lifecycleStatus === 'NO_ANSWER' ||
                          lifecycleStatus === 'BUSY' ||
                          lifecycleStatus === 'CANCELLED'
                        ? 'warning'
                        : 'indigo'
                }
              >
                {isCallActive ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {lifecycleStatus}
              </Badge>
              <Badge variant="neutral">Outcome: {callLog.outcome}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {callLog.medicineId?.name} ({callLog.medicineId?.dosage}) •{' '}
              {callLog.doseInstanceId?.slotLabel} • {getLanguageLabel(callLog.language)}
              {callLog.callPurpose ? ` • ${callLog.callPurpose}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadDetail()}>
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
              <strong>Ended:</strong>{' '}
              {callLog.endedAt
                ? formatDateTimeInTz(callLog.endedAt, callLog.familyMemberId?.timezone)
                : 'Awaiting completion'}
            </p>
            <p>
              <strong>Duration:</strong> {callLog.durationSeconds} seconds
            </p>
            <p>
              <strong>Recording Consent:</strong>{' '}
              {callLog.recordingConsentGranted ? 'GRANTED' : 'NOT GRANTED'} (Member setting:{' '}
              {callLog.familyMemberId?.recordingConsentStatus})
            </p>
            {callLog.attemptId ? (
              <p className="truncate">
                <strong>Sarvam Attempt ID:</strong> {callLog.attemptId}
              </p>
            ) : null}
            {callLog.sarvamStatus ? (
              <p>
                <strong>Sarvam Webhook Status:</strong> {callLog.sarvamStatus}
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

      {/* Call Lifecycle Timeline */}
      {callLog.statusHistory && callLog.statusHistory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-blue-600" />
              Real-Time Call Lifecycle Timeline
            </CardTitle>
            <CardDescription>
              Audit trail of transitions across QUEUED, INITIATING, RINGING, IN_PROGRESS, and
              terminal events
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {callLog.statusHistory.map((evt, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/40 px-4 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{evt.status}</Badge>
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
            {conversation?.finalAgentVariables &&
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
              Protected by family JWT isolation & patient recording consent
            </CardDescription>
          </CardHeader>
          <CardContent>
            {audioUrl && (recording?.consentVerified || callLog.recordingConsentGranted) ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold text-blue-700">
                    Recording verified ({recording?.durationSeconds ?? callLog.durationSeconds}s)
                  </span>
                  <Badge variant="success">Consent Granted</Badge>
                </div>
                <audio controls src={audioUrl} className="w-full" />
              </div>
            ) : (
              <EmptyState
                icon={callLog.recordingStatus === 'CONSENT_DENIED' ? ShieldAlert : Mic}
                title={
                  callLog.recordingStatus === 'CONSENT_DENIED'
                    ? 'Recording & Verbatim Transcript Withheld'
                    : 'Recording unavailable'
                }
                description={
                  callLog.recordingStatus === 'CONSENT_DENIED'
                    ? 'Patient allowed automated voice calling, but CALL_RECORDING consent is not GRANTED. Audio and verbatim transcripts are withheld.'
                    : 'No audio recording is available yet for this call.'
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversation Transcript */}
      <Card>
        <CardHeader>
          <CardTitle>Conversation Transcript</CardTitle>
          <CardDescription>
            Turn-by-turn dialogue in {getLanguageLabel(callLog.language)} with caregiver notes
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!conversation || conversation.turns.length === 0 ? (
            <EmptyState
              icon={callLog.recordingStatus === 'CONSENT_DENIED' ? ShieldAlert : Bot}
              title={
                callLog.recordingStatus === 'CONSENT_DENIED'
                  ? 'Transcript withheld — recording consent not granted'
                  : 'No conversation turns recorded'
              }
              description={
                callLog.recordingStatus === 'CONSENT_DENIED'
                  ? 'Grant CALL_RECORDING consent for this family member if verbatim call transcripts and recordings should be stored.'
                  : 'Unanswered, busy, rejected, or still-dialing calls do not have spoken dialogue.'
              }
            />
          ) : (
            <div className="space-y-3">
              {conversation.turns.map((turn, idx) => (
                <div
                  key={idx}
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
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        {turn.speaker === 'AI' ? 'CareVoice AI Assistant' : 'Patient'}
                      </span>
                      {turn.intent ? <Badge variant="neutral">{turn.intent}</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-900">{turn.text}</p>
                    {turn.translatedText ? (
                      <p className="text-xs text-slate-500">
                        Caregiver note: {turn.translatedText}
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
