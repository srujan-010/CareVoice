'use client';

import React, { useEffect, useState } from 'react';
import { PhoneCall, Sparkles } from 'lucide-react';
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

interface DoseOption {
  id: string;
  slotLabel: string;
  scheduledDateLocal: string;
  status: string;
  familyMemberId?: { _id: string; fullName: string; preferredLanguage?: string };
  medicineId?: { _id: string; name: string; dosage: string };
}

interface MockCallSimulatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSimulated: (callLogId?: string) => void;
}

export function MockCallSimulatorDialog({
  open,
  onOpenChange,
  onSimulated,
}: MockCallSimulatorDialogProps) {
  const [doses, setDoses] = useState<DoseOption[]>([]);
  const [doseInstanceId, setDoseInstanceId] = useState('');
  const [callType, setCallType] = useState('MEDICINE_REMINDER');
  const [scenario, setScenario] = useState('TAKEN');
  const [delayMinutes, setDelayMinutes] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    apiRequest<{ doses: DoseOption[] }>('/schedules/doses')
      .then((res) => {
        setDoses(res.doses || []);
        if (res.doses?.[0]) {
          setDoseInstanceId(res.doses[0].id);
        }
      })
      .catch(() => {
        setDoses([]);
      });
  }, [open]);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ callLog?: { _id: string } }>('/calls/simulate', {
        method: 'POST',
        body: JSON.stringify({
          doseInstanceId,
          callType,
          scenario,
          delayMinutes: scenario === 'MEAL_DELAY_CALLBACK' ? Number(delayMinutes) : undefined,
        }),
      });
      onSimulated(res?.callLog?._id);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Unable to simulate mock voice call.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            Mock Voice Call Simulator (Dev Sandbox)
          </DialogTitle>
          <DialogDescription>
            Explicitly simulate a multilingual AI call in mock mode to test transcripts,
            recordings, smart callbacks, and safety escalations.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {doses.length === 0 ? (
          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 text-xs sm:text-sm text-slate-600">
            No dose instances found yet. Create a medicine with scheduled slots first so the voice
            agent has a valid patient dose context.
          </div>
        ) : (
          <form onSubmit={handleSimulate} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Target Patient & Dose Instance
              </label>
              <SelectNative
                required
                value={doseInstanceId}
                onChange={(e) => setDoseInstanceId(e.target.value)}
              >
                {doses.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.familyMemberId?.fullName} — {d.medicineId?.name} ({d.medicineId?.dosage}) •{' '}
                    {d.slotLabel} [{d.scheduledDateLocal}]
                  </option>
                ))}
              </SelectNative>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Call Type</label>
                <SelectNative value={callType} onChange={(e) => setCallType(e.target.value)}>
                  <option value="MEAL_REMINDER">Meal Reminder</option>
                  <option value="MEDICINE_REMINDER">Medicine Reminder</option>
                  <option value="CONFIRMATION_CALL">Confirmation Call</option>
                  <option value="CALLBACK">Smart Callback</option>
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Simulated Patient Response
                </label>
                <SelectNative value={scenario} onChange={(e) => setScenario(e.target.value)}>
                  <option value="TAKEN">Confirmed Meal & Medicine Taken</option>
                  <option value="MEAL_DELAY_CALLBACK">
                    Not Eaten Yet — Request Callback
                  </option>
                  <option value="MEAL_ONLY_UNCONFIRMED">
                    Meal Confirmed Only (Unconfirmed Dose)
                  </option>
                  <option value="NOT_TAKEN">Patient Forgot / Not Taken</option>
                  <option value="NO_ANSWER">No Answer</option>
                  <option value="BUSY">Line Busy</option>
                  <option value="REJECTED">Call Rejected</option>
                  <option value="FEELING_UNWELL">Feeling Unwell (Trigger Escalation)</option>
                </SelectNative>
              </div>
            </div>

            {scenario === 'MEAL_DELAY_CALLBACK' ? (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Callback Delay (minutes)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value))}
                />
              </div>
            ) : null}

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-900">
              <strong>MOCK VOICE SANDBOX ONLY:</strong> This does{' '}
              <strong>NOT</strong> dial any real phone number or contact Sarvam telephony. All
              generated call logs, transcripts, and audio are permanently tagged{' '}
              <strong>MOCK (isMock: true)</strong> for offline development/testing.
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                <PhoneCall className="h-4 w-4" />
                {submitting ? 'Running Simulation...' : 'Run Mock Call'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

