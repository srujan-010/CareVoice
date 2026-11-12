'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Mic,
  PhoneCall,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { MockCallSimulatorDialog } from '@/components/calls/MockCallSimulatorDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import type { FamilyMember } from '@/types';

interface CallLogRow {
  _id: string;
  familyMemberId?: { _id: string; fullName: string; phoneNumber: string; timezone?: string };
  medicineId?: { _id: string; name: string; dosage: string };
  doseInstanceId?: { _id: string; slotLabel: string; scheduledAt: string };
  callType: string;
  phoneNumber: string;
  language: string;
  scheduledAt: string;
  startedAt?: string;
  durationSeconds: number;
  outcome: string;
  recordingStatus: string;
  transcriptAvailable: boolean;
  mealConfirmed: boolean | null;
  medicineConfirmed: string;
  mode: 'mock' | 'live';
}

export default function CallsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canSimulate = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [memberFilter, setMemberFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [simOpen, setSimOpen] = useState(false);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (memberFilter) params.set('familyMemberId', memberFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      const q = params.toString() ? `?${params.toString()}` : '';

      const [callList, memberList] = await Promise.all([
        apiRequest<CallLogRow[]>(`/calls${q}`),
        apiRequest<FamilyMember[]>('/family-members'),
      ]);
      setCalls(callList);
      setMembers(memberList);
    } finally {
      setLoading(false);
    }
  }, [memberFilter, outcomeFilter]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Voice Call Management
          </h1>
          <p className="text-sm text-slate-500">
            Inspect call logs, multilingual transcripts, audio recordings, and simulate calls in
            sandbox mode.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" onClick={loadCalls}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canSimulate ? (
            <Button onClick={() => setSimOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Simulate Mock Call
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <SelectNative
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="sm:w-64"
          >
            <option value="">All Family Members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </SelectNative>
          <SelectNative
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="sm:w-56"
          >
            <option value="">All Outcomes</option>
            <option value="COMPLETED">Completed</option>
            <option value="ANSWERED">Answered</option>
            <option value="CALLBACK_REQUESTED">Callback Requested</option>
            <option value="NO_ANSWER">No Answer</option>
            <option value="BUSY">Busy</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
            <option value="ESCALATED">Escalated</option>
          </SelectNative>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : calls.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No voice calls logged yet"
          description="Use the Mock Call Simulator to test Telugu, Hindi, Marathi, or English medicine reminder conversations."
          action={
            canSimulate ? (
              <Button onClick={() => setSimOpen(true)}>
                <Sparkles className="h-4 w-4" />
                Simulate First Call
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-sky-100 bg-sky-50/60 text-xs font-bold text-slate-600">
                  <th className="px-4 py-3">Patient & Phone</th>
                  <th className="px-4 py-3">Medicine & Dose</th>
                  <th className="px-4 py-3">Type & Mode</th>
                  <th className="px-4 py-3">Scheduled / Actual</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3">Media</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-100">
                {calls.map((c) => (
                  <tr key={c._id} className="hover:bg-sky-50/40 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-900">
                        {c.familyMemberId?.fullName || 'Patient'}
                      </p>
                      <p className="text-xs text-slate-500">{c.phoneNumber}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">
                        {c.medicineId?.name || 'Medicine'} ({c.medicineId?.dosage || ''})
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.doseInstanceId?.slotLabel || 'Dose'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">
                        {c.callType.replace(/_/g, ' ')}
                      </p>
                      <Badge variant={c.mode === 'live' ? 'success' : 'default'}>
                        {c.mode.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>Sch: {formatDateTimeInTz(c.scheduledAt, c.familyMemberId?.timezone)}</p>
                      <p>Act: {formatDateTimeInTz(c.startedAt, c.familyMemberId?.timezone)}</p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {c.durationSeconds}s
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          c.outcome === 'COMPLETED'
                            ? 'success'
                            : c.outcome === 'ESCALATED' || c.outcome === 'FAILED'
                              ? 'danger'
                              : c.outcome === 'CALLBACK_REQUESTED'
                                ? 'indigo'
                                : 'warning'
                        }
                      >
                        {c.outcome}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {getLanguageLabel(c.language)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={c.recordingStatus === 'AVAILABLE' ? 'success' : 'neutral'}
                        >
                          <Mic className="h-3 w-3" />
                          {c.recordingStatus === 'AVAILABLE' ? 'Audio' : c.recordingStatus}
                        </Badge>
                        {c.transcriptAvailable ? (
                          <Badge variant="default">
                            <FileText className="h-3 w-3" />
                            Text
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/calls/${c._id}`}>Inspect</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <MockCallSimulatorDialog
        open={simOpen}
        onOpenChange={setSimOpen}
        onSimulated={(newId) => {
          loadCalls();
          if (newId) router.push(`/calls/${newId}`);
        }}
      />
    </div>
  );
}

