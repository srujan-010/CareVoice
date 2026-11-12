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
import {
  formatConfigFieldLabel,
  getCallLifecycleDisplay,
  getCallOutcomeDisplay,
  getPreflightCheckDisplayLabel,
  getRawServiceStatusDisplay,
  getVoiceModeHeaderLabel,
  sanitizeVoiceText,
  translateVoiceError,
} from '@/lib/voiceDisplay';
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
  'PROVIDER_UNAVAILABLE',
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
  const [purpose, setPurpose] = useState('Admin-authorized CareVoice supervised test call');
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
        translateVoiceError(
          err instanceof ApiClientError ? err.message : undefined,
          'Unable to load voice service readiness checks.'
        )
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
        // Keep polling gently until terminal state or modal close
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
    !preflight?.liveCallingAllowed ||
    (preflight?.deploymentCheck ? !preflight.deploymentCheck.instantOutboundReady : false);

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
        setError(translateVoiceError(err.message, 'Failed to place live test call.'));
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
        setError('Unable to initiate the CareVoice live call. Please check service status.');
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
        translateVoiceError(
          err instanceof ApiClientError ? err.message : undefined,
          'Unable to sync call status.'
        )
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
          reason: 'Cancelled by Admin from Place Real Test Call console',
        }),
      });
      const updated = await apiRequest<CallStatusSnapshot>(
        `/voice-calls/${activeCall._id}/status`
      );
      setActiveCall(updated);
      onCallStartedOrUpdated(updated._id);
    } catch (err) {
      setError(
        translateVoiceError(
          err instanceof ApiClientError ? err.message : undefined,
          'Unable to cancel active call.'
        )
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
            Place Real Test Call
          </DialogTitle>
          <DialogDescription>
            Administrator-authorized live call via CareVoice Voice Service. Verifies E.164 phone
            format, independent calling, transcript, and audio recording consents, and secure call
            event delivery before dialing.
          </DialogDescription>
        </DialogHeader>

        {/* System Readiness Card */}
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <span className="text-xs font-bold uppercase tracking-wide text-blue-800">
                CareVoice Voice Service Readiness
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
                  {getVoiceModeHeaderLabel(preflight.configuredMode)} •{' '}
                  {preflight.telephonyReady ? 'Live Service Enabled' : 'Safely Disabled'}
                </Badge>
                <Badge variant={preflight.webhookReady ? 'success' : 'danger'}>
                  Call Event Connection: {preflight.webhookReady ? 'Ready' : 'Not Configured'}
                </Badge>
                {preflight.callerIdMasked ? (
                  <Badge variant="default">
                    CareVoice Calling Number: {preflight.callerIdMasked}
                  </Badge>
                ) : null}
                <Badge variant="neutral">Voice Profile v{preflight.agentVersion}</Badge>
              </div>

              {preflight.deploymentCheck ? (
                <div
                  className={`rounded-xl border px-3 py-2.5 text-xs space-y-2.5 ${
                    preflight.deploymentCheck.verified
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : preflight.deploymentCheck.instantOutboundReady
                        ? 'border-amber-200 bg-amber-50/90 text-amber-950'
                        : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      Voice Service Preflight Status
                      {preflight.deploymentCheck.instantOutboundReady
                        ? ' — Ready for Outbound Calling'
                        : ' — Attention Required'}
                    </p>
                    <Badge
                      variant={
                        preflight.deploymentCheck.verified
                          ? 'success'
                          : preflight.deploymentCheck.instantOutboundReady
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {preflight.deploymentCheck.verified
                        ? 'Verified'
                        : preflight.deploymentCheck.instantOutboundReady
                          ? 'Ready'
                          : 'Unavailable'}
                    </Badge>
                  </div>

                  <p>{sanitizeVoiceText(preflight.deploymentCheck.message)}</p>

                  {preflight.deploymentCheck.checks ? (
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 space-y-1.5 text-slate-800">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                        Service Readiness Checks
                      </p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {[
                          {
                            key: 'auth',
                            check: preflight.deploymentCheck.checks.apiAuthentication,
                          },
                          {
                            key: 'profile',
                            check: preflight.deploymentCheck.checks.agentIdAndVersion,
                          },
                          {
                            key: 'connection',
                            check: preflight.deploymentCheck.checks.connectionIdValidity,
                          },
                          {
                            key: 'caller',
                            check: preflight.deploymentCheck.checks.callerNumberAvailability,
                          },
                          {
                            key: 'outbound',
                            check: preflight.deploymentCheck.checks.outboundCapability,
                          },
                          {
                            key: 'webhook',
                            check: preflight.deploymentCheck.checks.webhookReadiness,
                          },
                          {
                            key: 'vars',
                            check: preflight.deploymentCheck.checks.dynamicVariableCompatibility,
                          },
                        ].map(({ key, check }) => {
                          const badgeVariant =
                            check.status === 'VERIFIED' || check.status === 'READY'
                              ? 'success'
                              : check.status === 'CONNECTION_VERIFICATION_UNAVAILABLE' ||
                                  check.status === 'UNVERIFIED'
                                ? 'warning'
                                : 'danger';
                          const statusText =
                            check.status === 'VERIFIED'
                              ? 'Verified'
                              : check.status === 'READY'
                                ? 'Ready'
                                : check.status === 'CONNECTION_VERIFICATION_UNAVAILABLE' ||
                                    check.status === 'UNVERIFIED'
                                  ? 'Limited Telemetry'
                                  : 'Action Needed';
                          return (
                            <div
                              key={key}
                              className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-2.5 py-1.5 flex flex-col gap-0.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="font-semibold text-[11px] text-slate-900">
                                  {getPreflightCheckDisplayLabel(check.label)}
                                </span>
                                <Badge variant={badgeVariant}>{statusText}</Badge>
                              </div>
                              <p className="text-[10.5px] text-slate-600">
                                {sanitizeVoiceText(check.detail)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {preflight.deploymentCheck.diagnosticHint ? (
                    <p
                      className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                        preflight.deploymentCheck.instantOutboundReady
                          ? 'border-amber-200/80 bg-white/80 text-amber-900'
                          : 'border-rose-200/80 bg-white/80 text-rose-900'
                      }`}
                    >
                      <strong>
                        {preflight.deploymentCheck.instantOutboundReady ? 'Service Note:' : 'Action Needed:'}
                      </strong>{' '}
                      {sanitizeVoiceText(preflight.deploymentCheck.diagnosticHint)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!preflight.liveCallingAllowed &&
              (preflight.missingTelephonyFields.length > 0 ||
                preflight.missingWebhookFields.length > 0) ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-bold">Live calling is currently locked in server settings:</p>
                  <p>
                    Missing:{' '}
                    {[...preflight.missingTelephonyFields, ...preflight.missingWebhookFields]
                      .map(formatConfigFieldLabel)
                      .join(', ')}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking CareVoice Voice Service
              readiness...
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
                Inspect Call Record
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
                  <p className="text-xs text-slate-500 break-all">
                    Reference ID:{' '}
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
                  Sync Call Status
                </Button>
                <Badge variant={getCallLifecycleBadgeVariant(activeCall.callStatus)}>
                  {getCallLifecycleDisplay(activeCall.callStatus).label}
                </Badge>
              </div>
            </div>

            {/* Lifecycle Step Bar */}
            <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
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
                    {getCallLifecycleDisplay(step).label}
                  </div>
                );
              })}
            </div>

            {isTerminal && activeCall.callStatus !== 'COMPLETED' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                <strong>Call Status:</strong> {getCallLifecycleDisplay(activeCall.callStatus).label} — Dose
                remains <strong>{activeCall.medicineConfirmed}</strong>.
              </div>
            ) : !isTerminal ? (
              <p className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-[11px] text-slate-600">
                CareVoice updates status automatically via Call Event Connection and background
                reconciliation while the call is active.
              </p>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Voice Service Status</p>
                <p className="font-bold text-slate-800">
                  {getRawServiceStatusDisplay(
                    activeCall.sarvamStatus || activeCall.providerStatusRaw
                  )}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Outcome / Dose</p>
                <p className="font-bold text-slate-800">
                  {getCallOutcomeDisplay(activeCall.outcome).label} • {activeCall.medicineConfirmed}
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
                  Transcript: {activeCall.transcriptConsentGranted ? 'Granted' : 'Withheld'} •
                  Audio:{' '}
                  {(activeCall.audioRecordingConsentGranted ?? activeCall.recordingConsentGranted)
                    ? 'Granted'
                    : 'Withheld'}
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
                <strong>Voice Service Error:</strong>{' '}
                {translateVoiceError(activeCall.failureReason)}
              </p>
            ) : null}

            <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end gap-2">
              {!isTerminal ? (
                <Button
                  type="button"
                  variant="softDestructive"
                  size="sm"
                  onClick={handleCancelCall}
                  disabled={cancelling}
                  className="w-full sm:w-auto"
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
                className="w-full sm:w-auto"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Inspect Full Call Detail
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
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
                  <option value="CONFIRMATION_CALL">Dose Confirmation</option>
                  <option value="CALLBACK">Scheduled Callback</option>
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
                {fallbackRequiredInfo || selectedLangOption?.sarvamSupported === false ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-amber-950">
                    <p className="font-bold text-amber-900">
                      Language Unavailable — Explicit Fallback Permission Required
                    </p>
                    <p className="text-[11px]">
                      Requested language ({getLanguageLabel(selectedMember.preferredLanguage)}) is not
                      natively enabled for live calling. CareVoice will never silently fall back to
                      another language.
                    </p>
                    <label className="flex items-start gap-2 cursor-pointer font-semibold text-xs">
                      <input
                        type="checkbox"
                        checked={allowLanguageFallback}
                        onChange={(e) => setAllowLanguageFallback(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-amber-400 text-blue-600"
                      />
                      <span>Authorize explicit fallback language for this call:</span>
                    </label>
                    {allowLanguageFallback ? (
                      <SelectNative
                        value={fallbackLanguage}
                        onChange={(e) => setFallbackLanguage(e.target.value)}
                      >
                        {(
                          fallbackRequiredInfo?.availableFallbackLanguages ??
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
                Medicine Schedule &amp; Dose Context *
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
                  I confirm placing ONE real CareVoice voice call to{' '}
                  {selectedMember?.phoneNumber || 'the registered E.164 number'}. Dose intake
                  will remain UNCONFIRMED unless explicitly confirmed by the patient.
                </span>
              </label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 sm:gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
                <PhoneCall className="h-4 w-4" />
                {submitting ? 'Initiating Call...' : 'Place Real Test Call'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
