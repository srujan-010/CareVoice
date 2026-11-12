'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, SelectNative, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiClientError, apiRequest } from '@/lib/api';
import { COMMON_TIMEZONES, RELATIONSHIP_OPTIONS, SUPPORTED_LANGUAGES } from '@/lib/constants';
import type { ConsentStatus, FamilyMember } from '@/types';

interface FamilyMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: FamilyMember | null;
  onSaved: () => void;
}

function normalizePhoneInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return trimmed;
  return `+${trimmed.slice(1).replace(/[\s().-]/g, '')}`;
}

function isValidE164Client(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export function FamilyMemberDialog({
  open,
  onOpenChange,
  member,
  onSaved,
}: FamilyMemberDialogProps) {
  const isEdit = Boolean(member);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [age, setAge] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('te');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [relationship, setRelationship] = useState('Mother');

  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');
  const [ecRelationship, setEcRelationship] = useState('Son / Daughter');

  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('06:30');
  const [maxRetries, setMaxRetries] = useState('2');
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState('10');
  const [allowMealReminders, setAllowMealReminders] = useState(true);
  const [allowMedicineReminders, setAllowMedicineReminders] = useState(true);
  const [allowConfirmationCalls, setAllowConfirmationCalls] = useState(true);
  const [preferredVoiceGender, setPreferredVoiceGender] = useState<'FEMALE' | 'MALE' | 'NEUTRAL'>(
    'FEMALE'
  );

  const [recordingConsentStatus, setRecordingConsentStatus] = useState<ConsentStatus>('PENDING');
  const [transcriptConsentStatus, setTranscriptConsentStatus] = useState<ConsentStatus>('PENDING');
  const [voiceCallingConsentStatus, setVoiceCallingConsentStatus] =
    useState<ConsentStatus>('GRANTED');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (member) {
      setFullName(member.fullName);
      setPhoneNumber(member.phoneNumber);
      setAge(
        member.age !== undefined && member.age !== null && Number.isFinite(Number(member.age))
          ? String(member.age)
          : ''
      );
      setPreferredLanguage(member.preferredLanguage || 'te');
      setTimezone(member.timezone || 'Asia/Kolkata');
      setRelationship(member.relationship || 'Mother');
      setEcName(member.emergencyContact?.name || '');
      setEcPhone(member.emergencyContact?.phoneNumber || '');
      setEcRelationship(member.emergencyContact?.relationship || 'Son / Daughter');
      setQuietStart(member.callingPreferences?.quietHoursStart || '22:00');
      setQuietEnd(member.callingPreferences?.quietHoursEnd || '06:30');
      setMaxRetries(String(member.callingPreferences?.maxRetries ?? 2));
      setRetryIntervalMinutes(String(member.callingPreferences?.retryIntervalMinutes ?? 10));
      setAllowMealReminders(member.callingPreferences?.allowMealReminders ?? true);
      setAllowMedicineReminders(member.callingPreferences?.allowMedicineReminders ?? true);
      setAllowConfirmationCalls(member.callingPreferences?.allowConfirmationCalls ?? true);
      setPreferredVoiceGender(member.callingPreferences?.preferredVoiceGender ?? 'FEMALE');
      setRecordingConsentStatus(member.recordingConsentStatus);
      setTranscriptConsentStatus(member.transcriptConsentStatus ?? 'PENDING');
      setVoiceCallingConsentStatus(member.voiceCallingConsentStatus);
      setIsActive(member.isActive);
      setNotes(member.notes || '');
    } else {
      setFullName('');
      setPhoneNumber('');
      setAge('');
      setPreferredLanguage('te');
      setTimezone('Asia/Kolkata');
      setRelationship('Mother');
      setEcName('');
      setEcPhone('');
      setEcRelationship('Son / Daughter');
      setQuietStart('22:00');
      setQuietEnd('06:30');
      setMaxRetries('2');
      setRetryIntervalMinutes('10');
      setAllowMealReminders(true);
      setAllowMedicineReminders(true);
      setAllowConfirmationCalls(true);
      setPreferredVoiceGender('FEMALE');
      setRecordingConsentStatus('PENDING');
      setTranscriptConsentStatus('PENDING');
      setVoiceCallingConsentStatus('GRANTED');
      setIsActive(true);
      setNotes('');
    }
    setError(null);
  }, [member, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanedName = fullName.trim();
    const cleanedPhone = normalizePhoneInput(phoneNumber);
    const cleanedEcName = ecName.trim();
    const cleanedEcPhone = normalizePhoneInput(ecPhone);
    const cleanedEcRel = ecRelationship.trim();

    if (cleanedName.length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (!isValidE164Client(cleanedPhone)) {
      setError(
        "Patient phone number must be in E.164 format starting with '+' and country code (e.g., +919876543210)."
      );
      return;
    }
    if (cleanedEcName.length < 2) {
      setError('Emergency contact name must be at least 2 characters.');
      return;
    }
    if (!isValidE164Client(cleanedEcPhone)) {
      setError(
        "Emergency contact phone must be in E.164 format starting with '+' and country code (e.g., +919811122233)."
      );
      return;
    }
    if (cleanedEcRel.length < 2) {
      setError('Emergency contact relationship must be at least 2 characters.');
      return;
    }

    let parsedAge: number | undefined;
    const trimmedAge = age.trim();
    if (trimmedAge !== '') {
      if (!/^\d+$/.test(trimmedAge)) {
        setError('Age must be a whole number between 0 and 130.');
        return;
      }
      const n = Number.parseInt(trimmedAge, 10);
      if (n < 0 || n > 130) {
        setError('Age must be between 0 and 130.');
        return;
      }
      parsedAge = n;
    }

    const trimmedRetries = maxRetries.trim();
    const parsedMaxRetries = trimmedRetries === '' ? 2 : Number.parseInt(trimmedRetries, 10);
    if (
      (trimmedRetries !== '' && !/^\d+$/.test(trimmedRetries)) ||
      !Number.isInteger(parsedMaxRetries) ||
      parsedMaxRetries < 0 ||
      parsedMaxRetries > 5
    ) {
      setError('Max Retries must be a whole number between 0 and 5.');
      return;
    }

    const trimmedInterval = retryIntervalMinutes.trim();
    const parsedRetryInterval = trimmedInterval === '' ? 10 : Number.parseInt(trimmedInterval, 10);
    if (
      (trimmedInterval !== '' && !/^\d+$/.test(trimmedInterval)) ||
      !Number.isInteger(parsedRetryInterval) ||
      parsedRetryInterval < 5 ||
      parsedRetryInterval > 60
    ) {
      setError('Retry Interval must be a whole number between 5 and 60 minutes.');
      return;
    }

    const trimmedQuietStart = quietStart.trim();
    const trimmedQuietEnd = quietEnd.trim();
    const timeRegex = /^\d{2}:\d{2}$/;

    setSubmitting(true);

    const payload: Record<string, unknown> = {
      fullName: cleanedName,
      phoneNumber: cleanedPhone,
      preferredLanguage,
      timezone: timezone.trim() || 'Asia/Kolkata',
      relationship: relationship.trim(),
      emergencyContact: {
        name: cleanedEcName,
        phoneNumber: cleanedEcPhone,
        relationship: cleanedEcRel,
      },
      callingPreferences: {
        ...(timeRegex.test(trimmedQuietStart) ? { quietHoursStart: trimmedQuietStart } : {}),
        ...(timeRegex.test(trimmedQuietEnd) ? { quietHoursEnd: trimmedQuietEnd } : {}),
        maxRetries: parsedMaxRetries,
        retryIntervalMinutes: parsedRetryInterval,
        allowMealReminders,
        allowMedicineReminders,
        allowConfirmationCalls,
        preferredVoiceGender,
      },
      recordingConsentStatus,
      transcriptConsentStatus,
      voiceCallingConsentStatus,
      isActive,
    };

    if (parsedAge !== undefined) {
      payload.age = parsedAge;
    }
    const trimmedNotes = notes.trim();
    if (trimmedNotes) {
      payload.notes = trimmedNotes;
    } else if (isEdit && member?.notes) {
      payload.notes = '';
    }

    try {
      if (isEdit && member) {
        await apiRequest(`/family-members/${member.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/family-members', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to save family member.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Family Member' : 'Add Family Member'}</DialogTitle>
          <DialogDescription>
            Configure independent language, timezone, calling preferences, and consent settings.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Core Identity */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Patient Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Full Name *
                </label>
                <Input
                  required
                  placeholder="Lakshmi Devi"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Phone Number (with country code) *
                </label>
                <Input
                  type="tel"
                  required
                  placeholder="+919876543210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
                {phoneNumber.trim() && !phoneNumber.trim().startsWith('+') ? (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-amber-700">
                    <span>Include country code (e.g. +91...)</span>
                    {/^\d{10}$/.test(phoneNumber.trim()) ? (
                      <button
                        type="button"
                        onClick={() => setPhoneNumber(`+91${phoneNumber.trim()}`)}
                        className="font-semibold text-blue-600 underline hover:text-blue-700"
                      >
                        Add +91
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Relationship *
                </label>
                <SelectNative
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                >
                  {RELATIONSHIP_OPTIONS.map((rel) => (
                    <option key={rel} value={rel}>
                      {rel}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Age (optional)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={130}
                  placeholder="68"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Preferred Call Language *
                </label>
                <SelectNative
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value)}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name} ({lang.nativeName}){!lang.sarvamSupported ? ' — Fallback Required' : ''}
                    </option>
                  ))}
                </SelectNative>
                {SUPPORTED_LANGUAGES.find((l) => l.code === preferredLanguage)?.sarvamSupported ===
                false ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Live voice calling does not natively support this language yet; explicit Admin
                    fallback authorization will be required before placing a call (never auto-switches to Hindi).
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Timezone *
                </label>
                <SelectNative value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </SelectNative>
              </div>
            </div>
          </div>

          {/* Emergency Contact */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Emergency Contact
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Contact Name *
                </label>
                <Input
                  required
                  placeholder="Ravi Kumar"
                  value={ecName}
                  onChange={(e) => setEcName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Contact Phone *
                </label>
                <Input
                  type="tel"
                  required
                  placeholder="+919811122233"
                  value={ecPhone}
                  onChange={(e) => setEcPhone(e.target.value)}
                />
                {ecPhone.trim() && !ecPhone.trim().startsWith('+') ? (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-amber-700">
                    <span>Include country code (e.g. +91...)</span>
                    {/^\d{10}$/.test(ecPhone.trim()) ? (
                      <button
                        type="button"
                        onClick={() => setEcPhone(`+91${ecPhone.trim()}`)}
                        className="font-semibold text-blue-600 underline hover:text-blue-700"
                      >
                        Add +91
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Relationship *
                </label>
                <Input
                  required
                  placeholder="Son"
                  value={ecRelationship}
                  onChange={(e) => setEcRelationship(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Calling Preferences & Consent */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Calling Preferences & Consent
            </h4>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Quiet Hours Start
                </label>
                <Input
                  type="time"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Quiet Hours End
                </label>
                <Input
                  type="time"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Max Retries
                </label>
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Retry Interval (min)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={retryIntervalMinutes}
                  onChange={(e) => setRetryIntervalMinutes(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Automated AI Calls
                </label>
                <SelectNative
                  value={voiceCallingConsentStatus}
                  onChange={(e) => setVoiceCallingConsentStatus(e.target.value as ConsentStatus)}
                >
                  <option value="GRANTED">Granted</option>
                  <option value="PENDING">Pending</option>
                  <option value="DENIED">Denied</option>
                  <option value="REVOKED">Revoked</option>
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Transcript Storage
                </label>
                <SelectNative
                  value={transcriptConsentStatus}
                  onChange={(e) => setTranscriptConsentStatus(e.target.value as ConsentStatus)}
                >
                  <option value="PENDING">Pending</option>
                  <option value="GRANTED">Granted</option>
                  <option value="DENIED">Denied</option>
                  <option value="REVOKED">Revoked</option>
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Audio Recording
                </label>
                <SelectNative
                  value={recordingConsentStatus}
                  onChange={(e) => setRecordingConsentStatus(e.target.value as ConsentStatus)}
                >
                  <option value="PENDING">Pending</option>
                  <option value="GRANTED">Granted</option>
                  <option value="DENIED">Denied</option>
                  <option value="REVOKED">Revoked</option>
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Voice Tone
                </label>
                <SelectNative
                  value={preferredVoiceGender}
                  onChange={(e) =>
                    setPreferredVoiceGender(e.target.value as 'FEMALE' | 'MALE' | 'NEUTRAL')
                  }
                >
                  <option value="FEMALE">Warm Female</option>
                  <option value="MALE">Calm Male</option>
                  <option value="NEUTRAL">Neutral</option>
                </SelectNative>
              </div>
            </div>

            <p className="rounded-lg border border-sky-100 bg-white px-3 py-2 text-[11px] text-slate-600">
              Calling, Transcript Storage, and Audio Recording consents are independent.
              {isEdit &&
              ((member?.transcriptConsentStatus === 'GRANTED' &&
                (transcriptConsentStatus === 'DENIED' || transcriptConsentStatus === 'REVOKED')) ||
                (member?.recordingConsentStatus === 'GRANTED' &&
                  (recordingConsentStatus === 'DENIED' || recordingConsentStatus === 'REVOKED'))) ? (
                <span className="font-semibold text-amber-800">
                  {' '}
                  Retention policy: revoking or denying Transcript or Recording consent will
                  immediately purge previously saved transcript turns or audio recordings for this
                  patient.
                </span>
              ) : null}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Meal Reminders</span>
                <Switch checked={allowMealReminders} onCheckedChange={setAllowMealReminders} />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Medicine Reminders</span>
                <Switch
                  checked={allowMedicineReminders}
                  onCheckedChange={setAllowMedicineReminders}
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Confirmation Calls</span>
                <Switch
                  checked={allowConfirmationCalls}
                  onCheckedChange={setAllowConfirmationCalls}
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Active Profile</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Care Notes (optional)
            </label>
            <Textarea
              placeholder="E.g. Prefers gentle morning calls after 7:15 AM; hard of hearing in left ear."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 sm:gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting
                ? 'Saving...'
                : isEdit
                  ? 'Save Changes'
                  : 'Add Family Member'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

