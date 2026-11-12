'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  Edit3,
  Globe2,
  Phone,
  PhoneCall,
  Pill,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { FamilyMemberDialog } from '@/components/family/FamilyMemberDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONSENT_TYPE_META, DOSE_STATUS_META, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import {
  getCallModeDisplay,
  getCallOutcomeDisplay,
  getCallTypeDisplay,
} from '@/lib/voiceDisplay';
import type { ConsentStatus, ConsentType, FamilyMember } from '@/types';

interface MemberProfilePayload {
  member: FamilyMember;
  medicines: Array<Record<string, unknown>>;
  doseHistory: Array<Record<string, unknown>>;
  callHistory: Array<Record<string, unknown>>;
  adherenceSummary: {
    totalTrackedDoses: number;
    adherenceRate: number | null;
    breakdown: Record<string, number>;
  };
}

export default function FamilyMemberProfilePage() {
  const params = useParams<{ id: string }>();
  const memberId = params?.id;
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [profile, setProfile] = useState<MemberProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<MemberProfilePayload>(`/family-members/${memberId}/profile`);
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load member profile');
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleConsentUpdate = async (consentType: ConsentType, status: ConsentStatus) => {
    if (!memberId) return;
    await apiRequest(`/family-members/${memberId}/consent`, {
      method: 'PATCH',
      body: JSON.stringify({ consentType, status, method: 'DASHBOARD' }),
    });
    loadProfile();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-rose-700">{error || 'Profile not found'}</p>
          <Button asChild variant="outline">
            <Link href="/family">Back to Family Members</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { member, medicines, doseHistory, callHistory, adherenceSummary } = profile;

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <Button asChild variant="outline" size="icon" className="shrink-0">
            <Link href="/family">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 break-words">
                {member.fullName}
              </h1>
              <Badge variant={member.isActive ? 'success' : 'neutral'}>
                {member.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 break-words">
              {member.relationship}
              {member.age ? ` • ${member.age} years` : ''} •{' '}
              {getLanguageLabel(member.preferredLanguage)}
            </p>
          </div>
        </div>

        {canEdit ? (
          <Button onClick={() => setEditOpen(true)} className="w-full sm:w-auto">
            <Edit3 className="h-4 w-4" />
            Edit Profile
          </Button>
        ) : null}
      </div>

      {/* Top info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Phone className="h-4 w-4 text-blue-600" />
              Contact & Timezone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs sm:text-sm text-slate-600">
            <p>
              <span className="font-semibold text-slate-800">Phone:</span> {member.phoneNumber}
            </p>
            <p className="flex items-center gap-1.5">
              <Globe2 className="h-3.5 w-3.5 text-blue-500" />
              <span>{member.timezone}</span>
            </p>
            <p>
              <span className="font-semibold text-slate-800">Quiet Hours:</span>{' '}
              {member.callingPreferences.quietHoursStart} –{' '}
              {member.callingPreferences.quietHoursEnd}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-blue-600" />
              Emergency Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs sm:text-sm text-slate-600">
            <p className="font-bold text-slate-900">{member.emergencyContact?.name}</p>
            <p>{member.emergencyContact?.phoneNumber}</p>
            <p className="text-xs text-slate-500">
              Relationship: {member.emergencyContact?.relationship}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              Adherence Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs sm:text-sm text-slate-600">
            <p className="text-2xl font-extrabold text-blue-700">
              {adherenceSummary.adherenceRate !== null
                ? `${adherenceSummary.adherenceRate}%`
                : 'No data yet'}
            </p>
            <p className="text-xs text-slate-500">
              {adherenceSummary.totalTrackedDoses} tracked doses •{' '}
              {adherenceSummary.breakdown.PATIENT_REPORTED_TAKEN ?? 0} reported taken
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Medicines, Dose History, Call History, Consents */}
      <Tabs defaultValue="medicines">
        <TabsList className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto gap-1">
          <TabsTrigger value="medicines">Assigned Medicines ({medicines.length})</TabsTrigger>
          <TabsTrigger value="doses">Medicine History ({doseHistory.length})</TabsTrigger>
          <TabsTrigger value="calls">Call History ({callHistory.length})</TabsTrigger>
          <TabsTrigger value="consents">Consents &amp; Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="medicines">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle>Assigned Prescriptions</CardTitle>
                <CardDescription>Active and past medicines for {member.fullName}</CardDescription>
              </div>
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href="/medicines">Manage Medicines</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {medicines.length === 0 ? (
                <EmptyState
                  icon={Pill}
                  title="No medicines assigned yet"
                  description="Add a prescription in the Medicines module to start dose scheduling."
                  action={
                    <Button asChild size="sm">
                      <Link href="/medicines">Add Medicine</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {medicines.map((med) => (
                    <div
                      key={String(med._id)}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/40 p-4"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {String(med.name)} — {String(med.dosage)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {String(med.frequency).replace(/_/g, ' ')} •{' '}
                          {String(med.foodInstruction).replace(/_/g, ' ')}
                        </p>
                      </div>
                      <Badge variant={med.isActive ? 'success' : 'neutral'}>
                        {med.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="doses">
          <Card>
            <CardHeader>
              <CardTitle>Dose Confirmation History</CardTitle>
              <CardDescription>Individual dose schedules and confirmation tracking</CardDescription>
            </CardHeader>
            <CardContent>
              {doseHistory.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="No dose history yet"
                  description="Generated daily doses and patient confirmations will appear here."
                />
              ) : (
                <div className="space-y-2.5">
                  {doseHistory.map((dose) => {
                    const med = dose.medicineId as { name?: string; dosage?: string } | undefined;
                    const st = String(dose.status || 'PENDING');
                    const meta = DOSE_STATUS_META[st];
                    return (
                      <div
                        key={String(dose._id)}
                        className="flex items-center justify-between rounded-xl border border-sky-100 bg-white p-3.5"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {med?.name || 'Medicine'} ({med?.dosage || ''})
                          </p>
                          <p className="text-xs text-slate-500">
                            {String(dose.slotLabel || '')} •{' '}
                            {formatDateTimeInTz(dose.scheduledAt as string, member.timezone)}
                          </p>
                        </div>
                        <Badge variant="default" className={`${meta?.bg} ${meta?.text} ${meta?.border}`}>
                          {meta?.label || st}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card>
            <CardHeader>
              <CardTitle>Voice Call History</CardTitle>
              <CardDescription>AI reminder and confirmation calls for {member.fullName}</CardDescription>
            </CardHeader>
            <CardContent>
              {callHistory.length === 0 ? (
                <EmptyState
                  icon={PhoneCall}
                  title="No calls placed yet"
                  description="Calls placed in Test Environment or Live Voice mode will appear here."
                />
              ) : (
                <div className="space-y-2.5">
                  {callHistory.map((call) => {
                    const modeDisplay = getCallModeDisplay(
                      Boolean(call.isMock) || String(call.mode || '') === 'mock'
                    );
                    const outcomeDisplay = getCallOutcomeDisplay(String(call.outcome || ''));
                    return (
                      <Link
                        key={String(call._id)}
                        href={`/calls/${String(call._id)}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-sky-100 bg-white p-3.5 hover:bg-sky-50/50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {getCallTypeDisplay(String(call.callType || ''))} •{' '}
                            {getLanguageLabel(String(call.language || member.preferredLanguage))}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDateTimeInTz(call.createdAt as string, member.timezone)} •{' '}
                            {String(call.durationSeconds ?? 0)}s
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={modeDisplay.badgeVariant}>{modeDisplay.shortLabel}</Badge>
                          <Badge variant={outcomeDisplay.badgeVariant}>
                            {outcomeDisplay.label}
                          </Badge>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consents">
          <Card>
            <CardHeader>
              <CardTitle>Consent Management & Retention Policy</CardTitle>
              <CardDescription>
                Voice Calling, Transcript Storage, and Audio Recording consents are strictly
                independent. Revoking a consent immediately enforces data retention rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(member.consents || []).map((consent) => {
                const meta = CONSENT_TYPE_META[consent.consentType];
                return (
                  <div
                    key={consent._id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sky-100 bg-sky-50/40 p-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">
                          {meta?.title || consent.consentType.replace(/_/g, ' ')}
                        </p>
                        {consent.consentVersion ? (
                          <Badge variant="neutral">{consent.consentVersion}</Badge>
                        ) : null}
                      </div>
                      {meta?.description ? (
                        <p className="text-xs text-slate-600">{meta.description}</p>
                      ) : null}
                      <p className="text-[11px] text-slate-500">
                        Updated via {consent.method} •{' '}
                        {formatDateTimeInTz(consent.updatedAt, member.timezone)}
                        {consent.grantedAt
                          ? ` • Granted: ${formatDateTimeInTz(consent.grantedAt, member.timezone)}`
                          : ''}
                        {consent.revokedAt
                          ? ` • Revoked: ${formatDateTimeInTz(consent.revokedAt, member.timezone)}`
                          : ''}
                      </p>
                      {meta?.retentionNote ? (
                        <p className="text-[11px] text-amber-800">{meta.retentionNote}</p>
                      ) : null}
                    </div>
                    <div className="w-full sm:w-40 shrink-0">
                      <SelectNative
                        disabled={!canEdit}
                        value={consent.status}
                        onChange={(e) =>
                          handleConsentUpdate(
                            consent.consentType,
                            e.target.value as ConsentStatus
                          )
                        }
                        className="w-full"
                      >
                        <option value="GRANTED">Granted</option>
                        <option value="PENDING">Pending</option>
                        <option value="DENIED">Denied</option>
                        <option value="REVOKED">Revoked</option>
                      </SelectNative>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FamilyMemberDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        member={member}
        onSaved={loadProfile}
      />
    </div>
  );
}

