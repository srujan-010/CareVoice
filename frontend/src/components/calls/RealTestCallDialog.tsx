'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, SelectNative } from '@/components/ui/input';
import { ApiClientError, apiRequest } from '@/lib/api';
import {
  getCallLifecycleBadgeVariant,
  getLanguageLabel,
  SUPPORTED_LANGUAGES,
} from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type {
  CallLifecycleStatus,
  CallType,
  FamilyMember,
  LanguageStatus,
  TranscriptStatus,
  VoiceCallPreflight,
} from '@/types';

interface DoseOption {
  id: string;
  slotLabel: string;
  scheduledDateLocal: string;
  scheduledAt: string;
  status: string;
  mealStatus: string;
  familyMemberId?: { _id: string; fullName: string; preferredLanguage?: string };
  medicineId?: { _id: string; name: string; dosage: string };
}

interface RealTestCallResponse {
  callLog: {
    _id: string;
    callStatus: CallLifecycleStatus;
    outcome: string;
    attemptId?: string;
    sarvamStatus?: string;
    providerStatusRaw?: string;
    recordingConsentGranted: boolean;
    audioRecordingConsentGranted?: boolean;
    transcriptConsentGranted?: boolean;
    phoneNumber: string;
    language: string;
    requestedLanguage?: string;
    fallbackLanguage?: string;
    languageStatus?: LanguageStatus;
    failureReason?: string;
  };
  providerResponse: {
    accepted: boolean;
    attemptId: string;
    rawStatus: string;
    httpStatus: number;
  };
  deploymentCheck: VoiceCallPreflight['deploymentCheck'];
}

interface CallStatusSnapshot {
  _id: string;
  callStatus: CallLifecycleStatus;
  outcome: string;
  sarvamStatus?: string;
  providerStatusRaw?: string;
  attemptId?: string;
  interactionId?: string;
  failureReason?: string;
  queuedAt?: string;
  initiatingAt?: string;
  startedAt?: string;
  ringingAt?: string;
  answeredAt?: string;
  endedAt?: string;
  lastStatusUpdateAt?: string;
  lastReconciledAt?: string;
  providerUpdatedAt?: string;
  durationSeconds: number;
  mealConfirmed: boolean | null;
  medicineConfirmed: string;
  recordingStatus: string;
  recordingNote?: string;
  recordingConsentGranted: boolean;
  audioRecordingConsentGranted?: boolean;
  transcriptConsentGranted?: boolean;
  transcriptAvailable?: boolean;
  transcriptStatus?: TranscriptStatus;
  language?: string;
  requestedLanguage?: string;
  actualLanguageUsed?: string;
  fallbackLanguage?: string;
  languageStatus?: LanguageStatus;
  statusHistory?: Array<{
    status: CallLifecycleStatus;
    timestamp: string;
    source: string;
    note?: string;
  }>;
}

const TERMINAL_CALL_STATUSES: CallLifecycleStatus[] = [
  'COMPLETED',
  'FAILED',
  'NO_ANSWER',
  'BUSY',
  'REJECTED',
  'NOT_CONNECTED',
  'CANCELLED',
  'LANGUAGE_UNAVAILABLE',
  'LANGUAGE_FALLBACK_REQUIRED',
];

const LIFECYCLE_STEPS: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'ANSWERED',
  'IN_PROGRESS',
  'COMPLETED',
];

interface RealTestCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCallStartedOrUpdated: (callLogId?: string) => void;
  onInspectCall: (callLogId: string) => void;
}

export function RealTestCallDialog({
  open,
  onOpenChange,
  onCallStartedOrUpdated,
  onInspectCall,
}: RealTestCallDialogProps) {
  const [preflight, setPreflight] = useState<VoiceCallPreflight | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [doses, setDoses] = useState<DoseOption[]>([]);
  const [loadingInit, setLoadingInit] = useState(false);

  const [familyMemberId, setFamilyMemberId] = useState('');
  const [doseInstanceId, setDoseInstanceId] = useState('');
  const [callType, setCallType] = useState<CallType>('MEDICINE_REMINDER');
  const [purpose, setPurpose] = useState('Admin-authorized Sarvam Vobiz supervised test call');
  const [overrideQuietHours, setOverrideQuietHours] = useState(false);
  const [confirmedByAdmin, setConfirmedByAdmin] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [syncingStatus, setSyncingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedCallLogId, setFailedCallLogId] = useState<string | null>(null);
  const [fallbackRequiredInfo, setFallbackRequiredInfo] = useState<{
    requestedLanguage: string;
    availableFallbackLanguages: string[];
  } | null>(null);
  const [allowLanguageFallback, setAllowLanguageFallback] = useState(false);
  const [fallbackLanguage, setFallbackLanguage] = useState('en');

  const [activeCall, setActiveCall] = useState<CallStatusSnapshot | null>(null);
  const [providerAcceptInfo, setProviderAcceptInfo] = useState<
    RealTestCallResponse['providerResponse'] | null
  >(null);

  const loadPreflightAndContext = useCallback(async () => {
    setLoadingInit(true);
    setError(null);
    try {
      const [preflightRes, memberList, doseRes] = await Promise.all([
        apiRequest<VoiceCallPreflight>('/voice-calls/preflight?verifyDeployment=true'),
        apiRequest<FamilyMember[]>('/family-members'),
        apiRequest<{ doses: DoseOption[] }>('/schedules/doses'),
      ]);
      setPreflight(preflightRes);
      setMembers(memberList);
      setDoses(doseRes.doses || []);

      if (memberList.length > 0 && !familyMemberId) {
        setFamilyMemberId(memberList[0].id);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to load real-call preflight data.'
      );
    } finally {
      setLoadingInit(false);
    }
  }, [familyMemberId]);

  useEffect(() => {
    if (!open) {
      setActiveCall(null);
      setProviderAcceptInfo(null);
      setConfirmedByAdmin(false);
      setFailedCallLogId(null);
      setFallbackRequiredInfo(null);
      setAllowLanguageFallback(false);
      setFallbackLanguage('en');
      setError(null);
      return;
    }
    loadPreflightAndContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedMember = useMemo(
    () => members.find((m) => m.id === familyMemberId) ?? null,
    [members, familyMemberId]
  );

  const selectedLangOption = useMemo(
    () => SUPPORTED_LANGUAGES.find((l) => l.code === selectedMember?.preferredLanguage) ?? null,
    [selectedMember?.preferredLanguage]
  );

  useEffect(() => {
    setFallbackRequiredInfo(null);
    setAllowLanguageFallback(false);
  }, [familyMemberId]);

  const memberDoses = useMemo(() => {
    if (!familyMemberId) return doses;
    return doses.filter((d) => d.familyMemberId?._id === familyMemberId);
  }, [doses, familyMemberId]);

  useEffect(() => {
    if (memberDoses.length === 0) {
      setDoseInstanceId('');
      return;
    }
    const stillValid = memberDoses.some((d) => d.id === doseInstanceId);
    if (!stillValid) {
      const preferred =
        memberDoses.find((d) => d.status !== 'PATIENT_REPORTED_TAKEN') ?? memberDoses[0];
      setDoseInstanceId(preferred.id);
    }
  }, [memberDoses, doseInstanceId]);

  // Live poll GET /api/voice-calls/:id/status?reconcile=true until terminal state
  useEffect(() => {
    if (!open || !activeCall) return;
    if (TERMINAL_CALL_STATUSES.includes(activeCall.callStatus)) return;

    const timer = setInterval(async () => {
      try {
        const snapshot = await apiRequest<CallStatusSnapshot>(
          `/voice-calls/${activeCall._id}/status?reconcile=true`
        );
        setActiveCall(snapshot);
        if (TERMINAL_CALL_STATUSES.includes(snapshot.callStatus)) {
          onCallStartedOrUpdated(snapshot._id);
        }
      } catch {
        // Keep polling gently unless modal closes
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [open, activeCall, onCallStartedOrUpdated]);

  const permissionBlockedReason = useMemo(() => {
    if (!selectedMember) return 'Select a family member.';
    if (!selectedMember.isActive) return 'Selected family member profile is inactive.';
    if (!/^\+[1-9]\d{7,14}$/.test(selectedMember.phoneNumber.trim())) {
      return `Phone number "${selectedMember.phoneNumber}" is not in strict E.164 format (+countrycode...).`;
    }
    if (selectedMember.voiceCallingConsentStatus !== 'GRANTED') {
      return `Voice calling consent is ${selectedMember.voiceCallingConsentStatus}. Patient must grant VOICE_CALLING consent before calling.`;
    }
    if (
      callType === 'MEAL_REMINDER' &&
      selectedMember.callingPreferences?.allowMealReminders === false
    ) {
      return 'Patient calling preferences disable meal reminder calls.';
    }
    if (
      callType === 'MEDICINE_REMINDER' &&
      selectedMember.callingPreferences?.allowMedicineReminders === false
    ) {
      return 'Patient calling preferences disable medicine reminder calls.';
    }
    if (
      callType === 'CONFIRMATION_CALL' &&
      selectedMember.callingPreferences?.allowConfirmationCalls === false
    ) {
      return 'Patient calling preferences disable confirmation calls.';
    }
    return null;
  }, [selectedMember, callType]);

  const systemBlocked =
    !preflight?.liveCallingAllowed || !preflight?.deploymentCheck?.verified;

  const canSubmit =
    !submitting &&
    !loadingInit &&
    !systemBlocked &&
    !permissionBlockedReason &&
    Boolean(familyMemberId) &&
    Boolean(doseInstanceId) &&
    confirmedByAdmin &&
    (!fallbackRequiredInfo || (allowLanguageFallback && Boolean(fallbackLanguage)));

  const handlePlaceRealCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFailedCallLogId(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<RealTestCallResponse>('/voice-calls/real-test', {
        method: 'POST',
        body: JSON.stringify({
          familyMemberId,
          doseInstanceId,
          callType,
          purpose: purpose.trim() || undefined,
          overrideQuietHours,
          confirmedByAdmin: true,
          ...(allowLanguageFallback
            ? { allowLanguageFallback: true, fallbackLanguage }
            : {}),
        }),
      });
      setFallbackRequiredInfo(null);
      setProviderAcceptInfo(res.providerResponse);
      setActiveCall({
        _id: res.callLog._id,
        callStatus: res.callLog.callStatus,
        outcome: res.callLog.outcome,
        sarvamStatus: res.callLog.sarvamStatus,
        providerStatusRaw: res.callLog.providerStatusRaw ?? res.callLog.sarvamStatus,
        attemptId: res.callLog.attemptId,
        failureReason: res.callLog.failureReason,
        durationSeconds: 0,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        recordingStatus: res.callLog.recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
        recordingConsentGranted: res.callLog.recordingConsentGranted,
        audioRecordingConsentGranted:
          res.callLog.audioRecordingConsentGranted ?? res.callLog.recordingConsentGranted,
        transcriptConsentGranted: res.callLog.transcriptConsentGranted,
        language: res.callLog.language,
        requestedLanguage: res.callLog.requestedLanguage,
        fallbackLanguage: res.callLog.fallbackLanguage,
        languageStatus: res.callLog.languageStatus,
      });
      onCallStartedOrUpdated(res.callLog._id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        const maybeDetails = err.details as
          | {
              callLogId?: string;
              requestedLanguage?: string;
              availableFallbackLanguages?: string[];
              requiresFallbackPermission?: boolean;
            }
          | undefined;
        if (maybeDetails?.callLogId) {
          setFailedCallLogId(maybeDetails.callLogId);
          onCallStartedOrUpdated(maybeDetails.callLogId);
        }
        if (err.code === 'LANGUAGE_FALLBACK_REQUIRED' && maybeDetails?.requiresFallbackPermission) {
          const allowedList = maybeDetails.availableFallbackLanguages ?? ['en', 'te', 'hi'];
          setFallbackRequiredInfo({
            requestedLanguage:
              maybeDetails.requestedLanguage || selectedMember?.preferredLanguage || 'unknown',
            availableFallbackLanguages: allowedList,
          });
          if (!allowedList.includes(fallbackLanguage) && allowedList.length > 0) {
            setFallbackLanguage(allowedList[0]);
          }
        }
      } else {
        setError('Failed to place real Sarvam outbound call.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncStatus = async () => {
    if (!activeCall) return;
    setSyncingStatus(true);
    try {
      const detailRes = await apiRequest<{ callLog: CallStatusSnapshot }>(
        `/voice-calls/${activeCall._id}/reconcile`,
        { method: 'POST' }
      );
      if (detailRes?.callLog) {
        setActiveCall(detailRes.callLog);
        onCallStartedOrUpdated(detailRes.callLog._id);
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to sync call status from Sarvam.'
      );
    } finally {
      setSyncingStatus(false);
    }
  };

  const handleCancelCall = async () => {
    if (!activeCall) return;
    setCancelling(true);
    try {
      await apiRequest(`/voice-calls/${activeCall._id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Cancelled by Admin from Real Test Call dialog',
        }),
      });
      const updated = await apiRequest<CallStatusSnapshot>(
        `/voice-calls/${activeCall._id}/status`
      );
      setActiveCall(updated);
      onCallStartedOrUpdated(updated._id);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to cancel active call.'
      );
    } finally {
      setCancelling(false);
    }
  };

  const isTerminal = activeCall ? TERMINAL_CALL_STATUSES.includes(activeCall.callStatus) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <PhoneCall className="h-5 w-5 text-blue-600" />
            Place Real Outbound Call (Sarvam + Vobiz)
          </DialogTitle>
          <DialogDescription>
            ADMIN-only live outbound call via Sarvam Instant Outbound API. Verifies E.164 phone
            number, automated calling consent, separate recording consent, and HTTPS webhooks before
            dialing.
          </DialogDescription>
        </DialogHeader>

        {/* System Readiness Card */}
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-bold uppercase tracking-wide text-blue-800">
                Sarvam Live Preflight Check
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadPreflightAndContext}
              disabled={loadingInit}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingInit ? 'animate-spin' : ''}`} />
              Re-check
            </Button>
          </div>

          {preflight ? (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-2">
                <Badge variant={preflight.telephonyReady ? 'success' : 'warning'}>
                  Mode: {preflight.configuredMode.toUpperCase()} / Telephony:{' '}
                  {preflight.telephonyReady ? 'ENABLED' : 'LOCKED'}
                </Badge>
                <Badge variant={preflight.webhookReady ? 'success' : 'danger'}>
                  HTTPS Webhook: {preflight.webhookReady ? 'Ready' : 'Not Ready'}
                </Badge>
                {preflight.callerIdMasked ? (
                  <Badge variant="default">Caller ID: {preflight.callerIdMasked}</Badge>
                ) : null}
                <Badge variant="neutral">Agent v{preflight.agentVersion}</Badge>
              </div>

              {preflight.deploymentCheck ? (
                <div
                  className={`rounded-xl border px-3 py-2.5 text-xs space-y-1.5 ${
                    preflight.deploymentCheck.verified
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      Sarvam Preflight Status ({preflight.deploymentCheck.status.toUpperCase()}
                      {preflight.deploymentCheck.upstreamStatus
                        ? ` • HTTP ${preflight.deploymentCheck.upstreamStatus}`
                        : ''}
                      ):
                    </p>
                    {preflight.deploymentCheck.authCategory &&
                    preflight.deploymentCheck.authCategory !== 'VERIFIED' ? (
                      <Badge variant="danger">
                        {preflight.deploymentCheck.authCategory.replace(/_/g, ' ')}
                      </Badge>
                    ) : null}
                  </div>
                  <p>{preflight.deploymentCheck.message}</p>
                  {preflight.deploymentCheck.diagnosticHint ? (
                    <p className="rounded-lg border border-rose-200/80 bg-white/80 px-2.5 py-1.5 text-[11px] text-rose-900">
                      <strong>Fix Action:</strong> {preflight.deploymentCheck.diagnosticHint}
                    </p>
                  ) : null}
                  {preflight.deploymentCheck.credentialsSharedWithOutbound ? (
                    <p className="text-[11px] opacity-85">
                      Auth header: <code>{preflight.deploymentCheck.authHeader || 'X-API-Key'}</code>{' '}
                      (read-only GET verification with same workspace credentials used by Sarvam
                      Outbound API; live dialing stays locked until verified).
                    </p>
                  ) : null}

                  {preflight.deploymentCheck.workspaceDiscovery ? (
                    <div className="mt-2 rounded-xl border border-sky-200 bg-white/95 p-3 text-[11px] text-slate-700 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900">
                          Read-Only Workspace Discovery (No Outbound Dialing / No Logs Viewer)
                        </span>
                        <Badge variant="neutral">
                          {preflight.deploymentCheck.workspaceDiscovery.discoveredApps.length} App(s) Found
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] bg-sky-50/60 border border-sky-100 rounded-lg p-2">
                        <p>
                          <span className="text-slate-500">Org ID:</span>{' '}
                          <code className="font-mono text-slate-900">
                            {preflight.deploymentCheck.workspaceDiscovery.orgId}
                          </code>
                        </p>
                        <p>
                          <span className="text-slate-500">Workspace ID:</span>{' '}
                          <code className="font-mono text-slate-900">
                            {preflight.deploymentCheck.workspaceDiscovery.workspaceId}
                          </code>
                        </p>
                        <p>
                          <span className="text-slate-500">Configured App ID:</span>{' '}
                          <code className="font-mono text-slate-900">
                            {preflight.deploymentCheck.workspaceDiscovery.configuredAgentId}
                          </code>
                        </p>
                        <p>
                          <span className="text-slate-500">Expected Version / Caller:</span>{' '}
                          <code className="font-mono text-slate-900">
                            v{preflight.deploymentCheck.workspaceDiscovery.configuredAgentVersion} •{' '}
                            {preflight.deploymentCheck.workspaceDiscovery.configuredPhoneMasked}
                          </code>
                        </p>
                        <p className="sm:col-span-2">
                          <span className="text-slate-500">Configured Connection ID:</span>{' '}
                          <code className="font-mono text-slate-900">
                            {preflight.deploymentCheck.workspaceDiscovery.configuredConnectionId}
                          </code>
                        </p>
                        <p className="sm:col-span-2">
                          <span className="text-slate-500">Analytics Interactions Probe:</span>{' '}
                          <span className="font-semibold text-slate-900">
                            {preflight.deploymentCheck.workspaceDiscovery.analyticsAppCheckStatus
                              ? `HTTP ${preflight.deploymentCheck.workspaceDiscovery.analyticsAppCheckStatus}`
                              : 'Not reached'}
                          </span>
                          {preflight.deploymentCheck.workspaceDiscovery.analyticsAppCheckDetail
                            ? ` — ${preflight.deploymentCheck.workspaceDiscovery.analyticsAppCheckDetail}`
                            : ''}
                        </p>
                      </div>

                      {preflight.deploymentCheck.workspaceDiscovery.discoveredApps.length > 0 ? (
                        <div className="space-y-1.5">
                          <p className="font-semibold text-slate-800">
                            Discovered Agents in This Workspace:
                          </p>
                          {preflight.deploymentCheck.workspaceDiscovery.discoveredApps.map((appItem) => (
                            <div
                              key={appItem.appId}
                              className="rounded-lg border border-sky-100 bg-sky-50/40 px-2.5 py-2 space-y-1"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <code className="font-mono font-bold text-slate-900">
                                  {appItem.appId}
                                </code>
                                <div className="flex flex-wrap gap-1">
                                  <Badge
                                    variant={appItem.matchesConfiguredAppId ? 'success' : 'warning'}
                                  >
                                    {appItem.matchesConfiguredAppId
                                      ? 'Matches Configured App ID'
                                      : 'Different App ID Found'}
                                  </Badge>
                                  {appItem.sources.map((src) => (
                                    <Badge key={src} variant="neutral">
                                      {src}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-600">
                                <span>
                                  Versions:{' '}
                                  <strong>
                                    {appItem.versions.length > 0
                                      ? appItem.versions.map((v) => `v${v}`).join(', ')
                                      : 'None surfaced'}
                                  </strong>
                                </span>
                                {appItem.statuses.length > 0 ? (
                                  <span>
                                    Status: <strong>{appItem.statuses.join(', ')}</strong>
                                  </span>
                                ) : null}
                                {appItem.connectionIds.length > 0 ? (
                                  <span>
                                    Connections:{' '}
                                    <code className="font-mono">
                                      {appItem.connectionIds.join(', ')}
                                    </code>
                                  </span>
                                ) : null}
                                {appItem.phoneNumbersMasked.length > 0 ? (
                                  <span>
                                    Phones:{' '}
                                    <strong>{appItem.phoneNumbersMasked.join(', ')}</strong>
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-amber-900">
                          No existing Deployments, Campaigns, Experiments, or Test Suites surfaced any{' '}
                          <code>app_id</code> under this Org/Workspace. Open the agent in{' '}
                          <strong>apps.sarvam.ai</strong>, verify the Org & Workspace IDs match the
                          workspace URL, commit a non-Draft version, copy the exact ID from{' '}
                          <code>··· → Copy agent ID</code>, and link it to a Deployment or Campaign.
                        </div>
                      )}

                      {preflight.deploymentCheck.workspaceDiscovery.discoveredConnections.length > 0 ? (
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-800">
                            Discovered Telephony Connections:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {preflight.deploymentCheck.workspaceDiscovery.discoveredConnections.map(
                              (conn) => (
                                <div
                                  key={`${conn.source}-${conn.connectionId}`}
                                  className="rounded-md border border-sky-100 bg-white px-2 py-1 text-[10px]"
                                >
                                  <code className="font-mono text-slate-900">
                                    {conn.connectionId}
                                  </code>{' '}
                                  ({conn.source}
                                  {conn.phoneNumbersMasked.length > 0
                                    ? ` • ${conn.phoneNumbersMasked.join(', ')}`
                                    : ''}
                                  )
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!preflight.liveCallingAllowed &&
              (preflight.missingTelephonyFields.length > 0 ||
                preflight.missingWebhookFields.length > 0) ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-bold">Real calling is currently locked on backend:</p>
                  <p>
                    Missing:{' '}
                    {[...preflight.missingTelephonyFields, ...preflight.missingWebhookFields].join(
                      ', '
                    )}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Sarvam credentials &
              deployment status...
            </p>
          )}
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-800 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{error}</span>
            </div>
            {failedCallLogId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onInspectCall(failedCallLogId);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Inspect Failed Call Log
              </Button>
            ) : null}
          </div>
        ) : null}

        {activeCall ? (
          <div className="rounded-2xl border border-sky-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  {!isTerminal ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  ) : activeCall.callStatus === 'COMPLETED' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  Live Call Tracker
                </h4>
                {providerAcceptInfo ? (
                  <p className="text-xs text-slate-500">
                    Sarvam HTTP {providerAcceptInfo.httpStatus} • Attempt ID:{' '}
                    <code className="font-mono text-slate-700">{providerAcceptInfo.attemptId}</code>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSyncStatus}
                  disabled={syncingStatus}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingStatus ? 'animate-spin' : ''}`} />
                  Sync Status Now
                </Button>
                <Badge variant={getCallLifecycleBadgeVariant(activeCall.callStatus)}>
                  {activeCall.callStatus}
                </Badge>
              </div>
            </div>

            {/* Lifecycle Step Bar */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
              {LIFECYCLE_STEPS.map((step) => {
                const currentIdx = LIFECYCLE_STEPS.indexOf(activeCall.callStatus);
                const stepIdx = LIFECYCLE_STEPS.indexOf(step);
                const reached = currentIdx >= stepIdx && currentIdx !== -1;
                return (
                  <div
                    key={step}
                    className={`rounded-lg border px-1.5 py-2 text-[10px] font-bold ${
                      reached
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {step}
                  </div>
                );
              })}
            </div>

            {isTerminal && activeCall.callStatus !== 'COMPLETED' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                <strong>Terminal Call Outcome:</strong> {activeCall.callStatus} (Provider:{' '}
                {activeCall.sarvamStatus || activeCall.providerStatusRaw || 'unknown'}) — Dose remains{' '}
                <strong>{activeCall.medicineConfirmed}</strong>.
              </div>
            ) : !isTerminal ? (
              <p className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-[11px] text-slate-600">
                Sarvam Instant Outbound sends its post-call webhook once the call finishes or fails to
                connect (Analytics reconciliation also checks every ~4s with up to ~60s archival delay).
              </p>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Sarvam Provider Status</p>
                <p className="font-bold text-slate-800">
                  {activeCall.sarvamStatus || activeCall.providerStatusRaw || 'initiating'}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Outcome / Dose</p>
                <p className="font-bold text-slate-800">
                  {activeCall.outcome} • {activeCall.medicineConfirmed}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Duration</p>
                <p className="font-bold text-slate-800">{activeCall.durationSeconds}s</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Language (Req / Actual)</p>
                <p className="font-bold text-slate-800">
                  {getLanguageLabel(activeCall.requestedLanguage || activeCall.language || 'te')}
                  {activeCall.actualLanguageUsed
                    ? ` → ${getLanguageLabel(activeCall.actualLanguageUsed)}`
                    : ''}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Answered / Ended</p>
                <p className="font-semibold text-slate-800">
                  {activeCall.answeredAt
                    ? formatDateTimeInTz(activeCall.answeredAt, selectedMember?.timezone)
                    : 'Not answered'}{' '}
                  /{' '}
                  {activeCall.endedAt
                    ? formatDateTimeInTz(activeCall.endedAt, selectedMember?.timezone)
                    : 'Active'}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Last Update / Consents</p>
                <p className="font-semibold text-slate-800">
                  T:{activeCall.transcriptConsentGranted ? 'Yes' : 'No'} • R:
                  {(activeCall.audioRecordingConsentGranted ?? activeCall.recordingConsentGranted)
                    ? 'Yes'
                    : 'No'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {activeCall.lastStatusUpdateAt
                    ? formatDateTimeInTz(activeCall.lastStatusUpdateAt, selectedMember?.timezone)
                    : 'Awaiting update'}
                </p>
              </div>
            </div>

            {activeCall.failureReason ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <strong>Failure / Cancel Reason:</strong> {activeCall.failureReason}
              </p>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              {!isTerminal ? (
                <Button
                  type="button"
                  variant="softDestructive"
                  size="sm"
                  onClick={handleCancelCall}
                  disabled={cancelling}
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  {cancelling ? 'Cancelling...' : 'Mark Call Cancelled'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onInspectCall(activeCall._id);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Inspect Full Call Detail
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePlaceRealCall} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Target Family Member *
                </label>
                <SelectNative
                  required
                  value={familyMemberId}
                  onChange={(e) => setFamilyMemberId(e.target.value)}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.phoneNumber})
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Call Purpose Type *
                </label>
                <SelectNative
                  value={callType}
                  onChange={(e) => setCallType(e.target.value as CallType)}
                >
                  <option value="MEDICINE_REMINDER">Medicine Reminder</option>
                  <option value="MEAL_REMINDER">Meal Reminder</option>
                  <option value="CONFIRMATION_CALL">Confirmation Call</option>
                  <option value="CALLBACK">Smart Callback</option>
                </SelectNative>
              </div>
            </div>

            {selectedMember ? (
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3 space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">Phone: {selectedMember.phoneNumber}</Badge>
                  <Badge variant="neutral">
                    Lang: {getLanguageLabel(selectedMember.preferredLanguage)}
                  </Badge>
                  <Badge
                    variant={
                      selectedMember.voiceCallingConsentStatus === 'GRANTED' ? 'success' : 'danger'
                    }
                  >
                    Calling: {selectedMember.voiceCallingConsentStatus}
                  </Badge>
                  <Badge
                    variant={
                      (selectedMember.transcriptConsentStatus ?? 'PENDING') === 'GRANTED'
                        ? 'success'
                        : 'warning'
                    }
                  >
                    Transcript: {selectedMember.transcriptConsentStatus ?? 'PENDING'}
                  </Badge>
                  <Badge
                    variant={
                      selectedMember.recordingConsentStatus === 'GRANTED' ? 'success' : 'warning'
                    }
                  >
                    Audio Recording: {selectedMember.recordingConsentStatus}
                  </Badge>
                </div>
                {(selectedMember.transcriptConsentStatus ?? 'PENDING') !== 'GRANTED' ||
                selectedMember.recordingConsentStatus !== 'GRANTED' ? (
                  <p className="text-[11px] text-amber-800">
                    Consents are independent:
                    {(selectedMember.transcriptConsentStatus ?? 'PENDING') !== 'GRANTED'
                      ? ' Transcripts will be withheld unless CALL_TRANSCRIPT is GRANTED.'
                      : ''}
                    {selectedMember.recordingConsentStatus !== 'GRANTED'
                      ? ' Audio recordings will be withheld unless CALL_RECORDING is GRANTED.'
                      : ''}
                  </p>
                ) : null}
                {(fallbackRequiredInfo || selectedLangOption?.sarvamSupported === false) ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-amber-950">
                    <p className="font-bold text-amber-900">
                      Language Unavailable on Sarvam — Explicit Fallback Permission Required
                    </p>
                    <p className="text-[11px]">
                      Requested language ({getLanguageLabel(selectedMember.preferredLanguage)}) is not
                      natively enabled on Sarvam. CareVoice will never silently fall back to Hindi.
                    </p>
                    <label className="flex items-start gap-2 cursor-pointer font-semibold text-xs">
                      <input
                        type="checkbox"
                        checked={allowLanguageFallback}
                        onChange={(e) => setAllowLanguageFallback(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-amber-400 text-blue-600"
                      />
                      <span>Authorize explicit fallback language for this outbound call:</span>
                    </label>
                    {allowLanguageFallback ? (
                      <SelectNative
                        value={fallbackLanguage}
                        onChange={(e) => setFallbackLanguage(e.target.value)}
                      >
                        {(fallbackRequiredInfo?.availableFallbackLanguages ??
                          SUPPORTED_LANGUAGES.filter((l) => l.sarvamSupported).map((l) => l.code)
                        ).map((code) => (
                          <option key={code} value={code}>
                            {getLanguageLabel(code)}
                          </option>
                        ))}
                      </SelectNative>
                    ) : null}
                  </div>
                ) : null}
                {permissionBlockedReason ? (
                  <p className="text-rose-700 font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    {permissionBlockedReason}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Medicine Schedule & Dose Context *
              </label>
              {memberDoses.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  No dose instances exist for this family member yet. Create an active medicine with
                  a schedule first before placing a real call.
                </div>
              ) : (
                <SelectNative
                  required
                  value={doseInstanceId}
                  onChange={(e) => setDoseInstanceId(e.target.value)}
                >
                  {memberDoses.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.medicineId?.name} ({d.medicineId?.dosage}) — {d.slotLabel} [
                      {d.scheduledDateLocal}] • {d.status}
                    </option>
                  ))}
                </SelectNative>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Call Purpose Note
              </label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={200}
                placeholder="Reason for Admin test call"
              />
            </div>

            <div className="space-y-2 rounded-xl border border-sky-100 bg-white p-3 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer text-slate-700">
                <input
                  type="checkbox"
                  checked={overrideQuietHours}
                  onChange={(e) => setOverrideQuietHours(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-sky-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  Override quiet hours ({selectedMember?.callingPreferences?.quietHoursStart ?? '22:00'}
                  –{selectedMember?.callingPreferences?.quietHoursEnd ?? '06:30'}) for this
                  supervised Admin test call
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer font-semibold text-slate-900">
                <input
                  type="checkbox"
                  checked={confirmedByAdmin}
                  onChange={(e) => setConfirmedByAdmin(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-sky-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  I confirm placing ONE real Sarvam Vobiz outbound phone call to{' '}
                  {selectedMember?.phoneNumber || 'the registered E.164 number'}. Dose intake
                  will remain UNCONFIRMED unless explicitly confirmed by the patient.
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                <PhoneCall className="h-4 w-4" />
                {submitting ? 'Dialing Sarvam Vobiz...' : 'Place Real Test Call'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

