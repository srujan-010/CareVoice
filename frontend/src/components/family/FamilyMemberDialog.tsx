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
  const [maxRetries, setMaxRetries] = useState(2);
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(10);
  const [allowMealReminders, setAllowMealReminders] = useState(true);
  const [allowConfirmationCalls, setAllowConfirmationCalls] = useState(true);
  const [preferredVoiceGender, setPreferredVoiceGender] = useState<'FEMALE' | 'MALE' | 'NEUTRAL'>(
    'FEMALE'
  );

  const [recordingConsentStatus, setRecordingConsentStatus] = useState<ConsentStatus>('PENDING');
  const [voiceCallingConsentStatus, setVoiceCallingConsentStatus] =
    useState<ConsentStatus>('GRANTED');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (member) {
      setFullName(member.fullName);
      setPhoneNumber(member.phoneNumber);
      setAge(member.age !== undefined ? String(member.age) : '');
      setPreferredLanguage(member.preferredLanguage);
      setTimezone(member.timezone);
      setRelationship(member.relationship);
      setEcName(member.emergencyContact?.name || '');
      setEcPhone(member.emergencyContact?.phoneNumber || '');
      setEcRelationship(member.emergencyContact?.relationship || '');
      setQuietStart(member.callingPreferences?.quietHoursStart || '22:00');
      setQuietEnd(member.callingPreferences?.quietHoursEnd || '06:30');
      setMaxRetries(member.callingPreferences?.maxRetries ?? 2);
      setRetryIntervalMinutes(member.callingPreferences?.retryIntervalMinutes ?? 10);
      setAllowMealReminders(member.callingPreferences?.allowMealReminders ?? true);
      setAllowConfirmationCalls(member.callingPreferences?.allowConfirmationCalls ?? true);
      setPreferredVoiceGender(member.callingPreferences?.preferredVoiceGender ?? 'FEMALE');
      setRecordingConsentStatus(member.recordingConsentStatus);
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
      setMaxRetries(2);
      setRetryIntervalMinutes(10);
      setAllowMealReminders(true);
      setAllowConfirmationCalls(true);
      setPreferredVoiceGender('FEMALE');
      setRecordingConsentStatus('PENDING');
      setVoiceCallingConsentStatus('GRANTED');
      setIsActive(true);
      setNotes('');
    }
    setError(null);
  }, [member, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      age: age.trim() ? Number(age) : undefined,
      preferredLanguage,
      timezone,
      relationship,
      emergencyContact: {
        name: ecName.trim(),
        phoneNumber: ecPhone.trim(),
        relationship: ecRelationship.trim(),
      },
      callingPreferences: {
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        maxRetries: Number(maxRetries),
        retryIntervalMinutes: Number(retryIntervalMinutes),
        allowMealReminders,
        allowConfirmationCalls,
        preferredVoiceGender,
      },
      recordingConsentStatus,
      voiceCallingConsentStatus,
      isActive,
      notes: notes.trim() || undefined,
    };

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
                  required
                  placeholder="+919876543210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
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
                      {lang.name} ({lang.nativeName})
                    </option>
                  ))}
                </SelectNative>
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
                  required
                  placeholder="+919811122233"
                  value={ecPhone}
                  onChange={(e) => setEcPhone(e.target.value)}
                />
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
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
                  onChange={(e) => setRetryIntervalMinutes(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Voice Calling Consent
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
                  Recording Consent
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
                  Voice Tone Preference
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <span>Meal Reminders</span>
                <Switch checked={allowMealReminders} onCheckedChange={setAllowMealReminders} />
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

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
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

