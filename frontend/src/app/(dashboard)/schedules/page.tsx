'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, PhoneCall, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DOSE_STATUS_META } from '@/lib/constants';
import { formatDateTimeInTz, formatTimeInTz } from '@/lib/utils';
import type { DoseStatus, FamilyMember } from '@/types';

interface DoseRow {
  id: string;
  _id: string;
  familyMemberId: {
    _id: string;
    fullName: string;
    preferredLanguage: string;
    timezone: string;
  };
  medicineId: {
    _id: string;
    name: string;
    dosage: string;
  };
  scheduledDateLocal: string;
  slotLabel: string;
  scheduledAt: string;
  mealReminderAt?: string;
  medicineReminderAt: string;
  confirmationCallAt?: string;
  timezone: string;
  associatedMeal: string;
  foodInstruction: string;
  mealStatus: string;
  status: DoseStatus;
  callJobs: Array<{
    _id: string;
    callType: string;
    scheduledFor: string;
    status: string;
  }>;
}

export default function SchedulesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [queueStatus, setQueueStatus] = useState<{
    mode: string;
    redisConnected: boolean;
  } | null>(null);

  const [selectedMember, setSelectedMember] = useState('');
  const [selectedDate, setSelectedDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA').format(new Date())
  );
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadDoses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMember) params.set('familyMemberId', selectedMember);
      if (selectedDate) params.set('date', selectedDate);
      const q = params.toString() ? `?${params.toString()}` : '';

      const [doseRes, memberList] = await Promise.all([
        apiRequest<{
          doses: DoseRow[];
          queueStatus: { mode: string; redisConnected: boolean };
        }>(`/schedules/doses${q}`),
        apiRequest<FamilyMember[]>('/family-members'),
      ]);
      setDoses(doseRes.doses);
      setQueueStatus(doseRes.queueStatus);
      setMembers(memberList);
    } finally {
      setLoading(false);
    }
  }, [selectedMember, selectedDate]);

  useEffect(() => {
    loadDoses();
  }, [loadDoses]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await apiRequest('/schedules/generate', {
        method: 'POST',
        body: JSON.stringify({ horizonDays: 2 }),
      });
      await loadDoses();
    } finally {
      setGenerating(false);
    }
  };

  const handleCaregiverConfirm = async (doseId: string, status: DoseStatus) => {
    await apiRequest(`/schedules/doses/${doseId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    loadDoses();
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Dose Schedules &amp; Job Engine
          </h1>
          <p className="text-sm text-slate-500">
            Every dose instance maintains separate meal reminder, medicine call, and confirmation
            jobs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {queueStatus ? (
            <Badge variant={queueStatus.redisConnected ? 'success' : 'default'}>
              Queue: {queueStatus.mode}
            </Badge>
          ) : null}
          {canEdit ? (
            <Button
              onClick={handleGenerate}
              disabled={generating}
              variant="secondary"
              className="w-full min-[420px]:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? 'Generating...' : 'Generate Upcoming Doses'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={loadDoses} className="w-full min-[420px]:w-auto">
            <RefreshCw className="h-4 w-4" />
            <span className="min-[420px]:hidden">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="w-full sm:w-52">
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              Patient Local Date
            </label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-64">
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              Family Member
            </label>
            <SelectNative
              value={selectedMember}
              onChange={(e) => setSelectedMember(e.target.value)}
            >
              <option value="">All Family Members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => setSelectedDate('')}
              className="w-full sm:w-auto"
            >
              Show All Dates
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : doses.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No dose instances for this filter"
          description="Add a medicine or click 'Generate Upcoming Doses' to populate daily dose schedules."
          action={
            canEdit ? (
              <Button onClick={handleGenerate} disabled={generating}>
                Generate Doses Now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {doses.map((dose) => {
            const meta = DOSE_STATUS_META[dose.status];
            return (
              <Card key={dose.id} className="hover:shadow-card-hover">
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">
                          {dose.medicineId?.name || 'Removed Medicine'}
                          {dose.medicineId?.dosage ? ` (${dose.medicineId.dosage})` : ''}
                        </h3>
                        <Badge
                          variant="default"
                          className={`${meta?.bg} ${meta?.text} ${meta?.border}`}
                        >
                          {meta?.label || dose.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-blue-700">
                        {dose.familyMemberId?.fullName || 'Family Member'} • {dose.slotLabel} ({dose.scheduledDateLocal})
                      </p>
                      <p className="text-xs text-slate-500">
                        {dose.foodInstruction.replace(/_/g, ' ')} •{' '}
                        {dose.associatedMeal.replace(/_/g, ' ')} • Meal Status:{' '}
                        <strong>{dose.mealStatus}</strong>
                      </p>
                    </div>

                    {canEdit && dose.status !== 'PATIENT_REPORTED_TAKEN' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            handleCaregiverConfirm(dose.id, 'PATIENT_REPORTED_TAKEN')
                          }
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Mark Taken
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCaregiverConfirm(dose.id, 'PATIENT_REPORTED_NOT_TAKEN')
                          }
                        >
                          Mark Not Taken
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {/* Separate timestamps & scheduled jobs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                      <p className="font-semibold text-slate-500 flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-blue-500" />
                        Meal Reminder
                      </p>
                      <p className="mt-1 font-bold text-slate-900">
                        {dose.mealReminderAt
                          ? formatTimeInTz(dose.mealReminderAt, dose.timezone)
                          : 'Disabled'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                      <p className="font-semibold text-slate-500 flex items-center gap-1.5">
                        <PhoneCall className="h-3.5 w-3.5 text-blue-500" />
                        Medicine Reminder
                      </p>
                      <p className="mt-1 font-bold text-slate-900">
                        {formatTimeInTz(dose.medicineReminderAt, dose.timezone)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                      <p className="font-semibold text-slate-500 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                        Confirmation Call
                      </p>
                      <p className="mt-1 font-bold text-slate-900">
                        {dose.confirmationCallAt
                          ? formatTimeInTz(dose.confirmationCallAt, dose.timezone)
                          : 'Disabled'}
                      </p>
                    </div>
                  </div>

                  {dose.callJobs.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {dose.callJobs.map((job) => (
                        <Badge key={job._id} variant="neutral">
                          {job.callType.replace(/_/g, ' ')} • {job.status} (
                          {formatDateTimeInTz(job.scheduledFor, dose.timezone)})
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

