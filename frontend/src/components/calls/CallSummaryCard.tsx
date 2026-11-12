'use client';

import React from 'react';
import Link from 'next/link';
import { Clock, FileText, Globe2, Mic, Pill } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCallLifecycleBadgeVariant, getLanguageLabel } from '@/lib/constants';
import { formatDateTimeInTz } from '@/lib/utils';
import {
  getCallLifecycleDisplay,
  getCallModeDisplay,
  getCallOutcomeDisplay,
  getCallTypeDisplay,
  getRecordingStatusDisplay,
  getTranscriptStatusDisplay,
} from '@/lib/voiceDisplay';
import type { CallLifecycleStatus, LanguageStatus, TranscriptStatus } from '@/types';

export interface CallSummaryRecord {
  _id: string;
  familyMemberId?: { _id: string; fullName: string; phoneNumber: string; timezone?: string };
  medicineId?: { _id: string; name: string; dosage: string };
  doseInstanceId?: { _id: string; slotLabel: string; scheduledAt: string };
  callType: string;
  phoneNumber: string;
  language: string;
  requestedLanguage?: string;
  actualLanguageUsed?: string;
  languageStatus?: LanguageStatus;
  scheduledAt: string;
  startedAt?: string;
  durationSeconds: number;
  callStatus?: CallLifecycleStatus;
  outcome: string;
  recordingStatus: string;
  transcriptAvailable: boolean;
  transcriptStatus?: TranscriptStatus;
  mode: 'mock' | 'live';
  isMock?: boolean;
  isTestCall?: boolean;
}

export function CallSummaryCard({ call }: { call: CallSummaryRecord }) {
  const isMockRow = call.isMock ?? call.mode === 'mock';
  const lifecycleDisplay = getCallLifecycleDisplay(call.callStatus);
  const outcomeDisplay = getCallOutcomeDisplay(call.outcome);
  const modeDisplay = getCallModeDisplay(isMockRow);
  const recDisplay = getRecordingStatusDisplay(call.recordingStatus);
  const txDisplay = getTranscriptStatusDisplay(
    call.transcriptStatus ?? (call.transcriptAvailable ? 'AVAILABLE' : undefined)
  );
  const requestedLang = call.requestedLanguage || call.language;
  const tz = call.familyMemberId?.timezone;

  return (
    <div className="rounded-2xl border border-sky-200/80 bg-white p-4 shadow-sm space-y-3">
      {/* Top row: Patient + Mode & Lifecycle */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 break-words">
            {call.familyMemberId?.fullName || 'Patient'}
          </p>
          <p className="text-xs text-slate-500 break-all">{call.phoneNumber}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={modeDisplay.badgeVariant}>{modeDisplay.shortLabel}</Badge>
          {call.isTestCall ? <Badge variant="default">ADMIN TEST</Badge> : null}
          <Badge variant={getCallLifecycleBadgeVariant(call.callStatus)}>
            {lifecycleDisplay.label}
          </Badge>
        </div>
      </div>

      {/* Medicine & Call Type */}
      <div className="rounded-xl border border-sky-100 bg-sky-50/40 px-3 py-2.5 text-xs space-y-1">
        <div className="flex items-start gap-2">
          <Pill className="h-3.5 w-3.5 shrink-0 text-blue-600 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 break-words">
              {call.medicineId?.name || 'Medicine'}
              {call.medicineId?.dosage ? ` (${call.medicineId.dosage})` : ''}
            </p>
            <p className="text-slate-500">
              {call.doseInstanceId?.slotLabel || 'Dose'} • {getCallTypeDisplay(call.callType)}
            </p>
          </div>
        </div>
      </div>

      {/* Timestamps, Duration, Language & Outcome */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-sky-100 bg-white p-2.5 min-w-0">
          <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
            <Clock className="h-3 w-3 text-blue-600 shrink-0" />
            Times
          </p>
          <p className="mt-1 text-slate-700 break-words">
            <span className="font-semibold">Sch:</span> {formatDateTimeInTz(call.scheduledAt, tz)}
          </p>
          <p className="text-slate-600 break-words">
            <span className="font-semibold">Act:</span> {formatDateTimeInTz(call.startedAt, tz)}
          </p>
        </div>

        <div className="rounded-xl border border-sky-100 bg-white p-2.5 min-w-0">
          <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
            <Globe2 className="h-3 w-3 text-blue-600 shrink-0" />
            Outcome &amp; Language
          </p>
          <p className="mt-1 font-semibold text-slate-800 break-words">{outcomeDisplay.label}</p>
          <p className="text-slate-600">
            {call.durationSeconds}s • {getLanguageLabel(requestedLang)}
          </p>
          {call.actualLanguageUsed && call.actualLanguageUsed !== requestedLang ? (
            <Badge variant="warning" className="mt-1">
              Spoken: {getLanguageLabel(call.actualLanguageUsed)}
            </Badge>
          ) : call.languageStatus === 'FALLBACK_AUTHORIZED' ? (
            <Badge variant="default" className="mt-1">
              Fallback Authorized
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Media availability + Inspect CTA */}
      <div className="flex flex-col min-[420px]:flex-row min-[420px]:items-center justify-between gap-2.5 pt-1 border-t border-sky-100">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={recDisplay.badgeVariant}>
            <Mic className="h-3 w-3" />
            {recDisplay.label}
          </Badge>
          <Badge variant={txDisplay.badgeVariant}>
            <FileText className="h-3 w-3" />
            {txDisplay.label}
          </Badge>
        </div>
        <Button asChild size="sm" variant="secondary" className="w-full min-[420px]:w-auto shrink-0">
          <Link href={`/calls/${call._id}`}>Inspect Call</Link>
        </Button>
      </div>
    </div>
  );
}

