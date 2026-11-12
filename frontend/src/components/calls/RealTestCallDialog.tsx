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
import { getLanguageLabel } from '@/lib/constants';
import type {
  CallLifecycleStatus,
  CallType,
  FamilyMember,
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
    recordingConsentGranted: boolean;
    phoneNumber: string;
    language: string;
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
  attemptId?: string;
  interactionId?: string;
  failureReason?: string;
  durationSeconds: number;
  mealConfirmed: boolean | null;
  medicineConfirmed: string;
  recordingStatus: string;
  recordingConsentGranted: boolean;
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
  'CANCELLED',
];

const LIFECYCLE_STEPS: CallLifecycleStatus[] = [
  'QUEUED',
  'INITIATING',
  'RINGING',
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
  const [error, setError] = useState<string | null>(null);
  const [failedCallLogId, setFailedCallLogId] = useState<string | null>(null);

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

  // Live poll GET /api/voice-calls/:id/status until terminal state
  useEffect(() => {
    if (!open || !activeCall) return;
    if (TERMINAL_CALL_STATUSES.includes(activeCall.callStatus)) return;

    const timer = setInterval(async () => {
      try {
        const snapshot = await apiRequest<CallStatusSnapshot>(
          `/voice-calls/${activeCall._id}/status`
        );
        setActiveCall(snapshot);
        if (TERMINAL_CALL_STATUSES.includes(snapshot.callStatus)) {
          onCallStartedOrUpdated(snapshot._id);
        }
      } catch {
        // Keep polling gently unless modal closes
      }
    }, 2500);

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
    (preflight?.deploymentCheck ? !preflight.deploymentCheck.verified : false);

  const canSubmit =
    !submitting &&
    !loadingInit &&
    !systemBlocked &&
    !permissionBlockedReason &&
    Boolean(familyMemberId) &&
    Boolean(doseInstanceId) &&
    confirmedByAdmin;

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
        }),
      });
      setProviderAcceptInfo(res.providerResponse);
      setActiveCall({
        _id: res.callLog._id,
        callStatus: res.callLog.callStatus,
        outcome: res.callLog.outcome,
        sarvamStatus: res.callLog.sarvamStatus,
        attemptId: res.callLog.attemptId,
        failureReason: res.callLog.failureReason,
        durationSeconds: 0,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        recordingStatus: res.callLog.recordingConsentGranted ? 'PROCESSING' : 'CONSENT_DENIED',
        recordingConsentGranted: res.callLog.recordingConsentGranted,
      });
      onCallStartedOrUpdated(res.callLog._id);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
        const maybeDetails = err.details as { callLogId?: string } | undefined;
        if (maybeDetails?.callLogId) {
          setFailedCallLogId(maybeDetails.callLogId);
          onCallStartedOrUpdated(maybeDetails.callLogId);
        }
      } else {
        setError('Failed to place real Sarvam outbound call.');
      }
    } finally {
      setSubmitting(false);
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
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    preflight.deploymentCheck.verified
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                >
                  <p className="font-bold">
                    Sarvam Deployment Status ({preflight.deploymentCheck.status.toUpperCase()}):
                  </p>
                  <p>{preflight.deploymentCheck.message}</p>
                </div>
              ) : null}

              {!preflight.liveCallingAllowed ? (
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
              <Badge
                variant={
                  activeCall.callStatus === 'COMPLETED'
                    ? 'success'
                    : activeCall.callStatus === 'FAILED' || activeCall.callStatus === 'REJECTED'
                      ? 'danger'
                      : activeCall.callStatus === 'NO_ANSWER' ||
                          activeCall.callStatus === 'BUSY' ||
                          activeCall.callStatus === 'CANCELLED'
                        ? 'warning'
                        : 'indigo'
                }
              >
                {activeCall.callStatus}
              </Badge>
            </div>

            {/* Lifecycle Step Bar */}
            <div className="grid grid-cols-5 gap-1.5 text-center">
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Provider Status</p>
                <p className="font-bold text-slate-800">{activeCall.sarvamStatus || 'initiating'}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Outcome</p>
                <p className="font-bold text-slate-800">{activeCall.outcome}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Recording Consent</p>
                <p className="font-bold text-slate-800">
                  {activeCall.recordingConsentGranted ? 'Granted' : 'Not Granted'}
                </p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-2.5">
                <p className="text-slate-500">Dose Taken?</p>
                <p className="font-bold text-slate-800">{activeCall.medicineConfirmed}</p>
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
                    Calling Consent: {selectedMember.voiceCallingConsentStatus}
                  </Badge>
                  <Badge
                    variant={
                      selectedMember.recordingConsentStatus === 'GRANTED' ? 'success' : 'warning'
                    }
                  >
                    Recording Consent: {selectedMember.recordingConsentStatus}
                  </Badge>
                </div>
                {selectedMember.recordingConsentStatus !== 'GRANTED' ? (
                  <p className="text-[11px] text-amber-800">
                    Recording consent is not GRANTED: automated calling may proceed if calling
                    consent is GRANTED, and CareVoice will withhold recording audio & verbatim
                    transcripts.
                  </p>
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

