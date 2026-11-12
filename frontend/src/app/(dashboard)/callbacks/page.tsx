'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { PhoneForwarded, Plus, RefreshCw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeInTz } from '@/lib/utils';

interface CallbackRow {
  _id: string;
  familyMemberId?: { _id: string; fullName: string; phoneNumber: string; preferredLanguage: string };
  medicineId?: { name: string; dosage: string };
  doseInstanceId?: { _id: string; slotLabel: string; status: string; mealStatus: string };
  reason: string;
  requestedDelayMinutes: number;
  scheduledFor: string;
  status: string;
  attemptNumber: number;
  maxRetries: number;
}

interface DoseOption {
  id: string;
  slotLabel: string;
  scheduledDateLocal: string;
  status: string;
  familyMemberId?: { _id: string; fullName: string };
  medicineId?: { name: string; dosage: string };
}

export default function CallbacksPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [callbacks, setCallbacks] = useState<CallbackRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [doses, setDoses] = useState<DoseOption[]>([]);
  const [selectedDoseId, setSelectedDoseId] = useState('');
  const [delayMinutes, setDelayMinutes] = useState(10);
  const [reason, setReason] = useState('Patient will eat meal in 10 minutes');
  const [submitting, setSubmitting] = useState(false);

  const loadCallbacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : '';
      const data = await apiRequest<CallbackRow[]>(`/callbacks${q}`);
      setCallbacks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load callbacks');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadCallbacks();
  }, [loadCallbacks]);

  const openCreateModal = async () => {
    setError(null);
    const res = await apiRequest<{ doses: DoseOption[] }>('/schedules/doses');
    const eligible = (res.doses || []).filter((d) => d.status !== 'PATIENT_REPORTED_TAKEN');
    setDoses(eligible);
    if (eligible[0]) setSelectedDoseId(eligible[0].id);
    setCreateOpen(true);
  };

  const handleCreateCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = doses.find((d) => d.id === selectedDoseId);
    if (!target?.familyMemberId?._id) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiRequest('/callbacks', {
        method: 'POST',
        body: JSON.stringify({
          familyMemberId: target.familyMemberId._id,
          doseInstanceId: target.id,
          delayMinutes: Number(delayMinutes),
          reason: reason.trim(),
          patientConfirmed: true,
        }),
      });
      setCreateOpen(false);
      loadCallbacks();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to schedule callback');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await apiRequest(`/callbacks/${id}/cancel`, { method: 'POST' });
      loadCallbacks();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to cancel callback');
    }
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Smart Callback Queue
          </h1>
          <p className="text-sm text-slate-500">
            Meal-delay and retry callbacks validated against active prescriptions, duplicate guards
            & retry limits.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" onClick={loadCallbacks}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canEdit ? (
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              Schedule Callback
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <SelectNative
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="sm:w-56"
          >
            <option value="">All Callback Statuses</option>
            <option value="REQUESTED">Requested</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </SelectNative>
          <p className="text-xs text-slate-500">
            Safety rule: Meal delay callbacks never mark medicine as taken automatically.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : callbacks.length === 0 ? (
        <EmptyState
          icon={PhoneForwarded}
          title="No smart callbacks queued"
          description="When a patient says they will eat in 10 minutes, a validated callback job is created here."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {callbacks.map((cb) => (
            <Card key={cb._id} className="hover:shadow-card-hover">
              <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {cb.familyMemberId?.fullName || 'Patient'} — {cb.medicineId?.name}{' '}
                    ({cb.medicineId?.dosage})
                  </CardTitle>
                  <CardDescription>
                    {cb.doseInstanceId?.slotLabel} • Attempt {cb.attemptNumber} of {cb.maxRetries}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    cb.status === 'COMPLETED'
                      ? 'success'
                      : cb.status === 'CANCELLED' || cb.status === 'FAILED'
                        ? 'danger'
                        : 'indigo'
                  }
                >
                  {cb.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-xs sm:text-sm text-slate-600">
                <p>{cb.reason}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-100 bg-sky-50/40 px-3 py-2 text-xs">
                  <span>
                    Delay: <strong>+{cb.requestedDelayMinutes}m</strong>
                  </span>
                  <span>
                    Scheduled: <strong>{formatDateTimeInTz(cb.scheduledFor)}</strong>
                  </span>
                </div>

                {canEdit && ['REQUESTED', 'CONFIRMED', 'SCHEDULED'].includes(cb.status) ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="softDestructive"
                      onClick={() => handleCancel(cb._id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel Callback
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Smart Callback</DialogTitle>
            <DialogDescription>
              Backend validates dose eligibility, duplicate callbacks, and retry limits.
            </DialogDescription>
          </DialogHeader>
          {doses.length === 0 ? (
            <p className="text-sm text-slate-600">
              No pending or unconfirmed doses available for callback scheduling.
            </p>
          ) : (
            <form onSubmit={handleCreateCallback} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Target Dose
                </label>
                <SelectNative
                  required
                  value={selectedDoseId}
                  onChange={(e) => setSelectedDoseId(e.target.value)}
                >
                  {doses.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.familyMemberId?.fullName} — {d.medicineId?.name} ({d.slotLabel}) [
                      {d.status}]
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Delay (minutes, 1–120)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  required
                  value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Reason</label>
                <Input
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Scheduling...' : 'Create Callback'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

