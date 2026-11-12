'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Edit3, Pill, Plus, Search, Trash2, Users } from 'lucide-react';
import {
  MedicineFormDialog,
  type MedicineRecord,
} from '@/components/medicines/MedicineFormDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { FamilyMember } from '@/types';

export default function MedicinesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';
  const canDelete = user?.role === 'ADMIN';

  const [medicines, setMedicines] = useState<MedicineRecord[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<MedicineRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedMember) params.set('familyMemberId', selectedMember);
      if (search.trim()) params.set('search', search.trim());
      const q = params.toString() ? `?${params.toString()}` : '';
      const [medList, memberList] = await Promise.all([
        apiRequest<MedicineRecord[]>(`/medicines${q}`),
        apiRequest<FamilyMember[]>('/family-members'),
      ]);
      setMedicines(medList);
      setMembers(memberList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load medicines');
    } finally {
      setLoading(false);
    }
  }, [selectedMember, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (med: MedicineRecord) => {
    if (!window.confirm(`Delete ${med.name}? Future queued calls for it will be cancelled.`)) {
      return;
    }
    await apiRequest(`/medicines/${med.id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Medicine Prescriptions
          </h1>
          <p className="text-sm text-slate-500">
            Configure multi-dose schedules, meal pairing, and food rules per family member.
          </p>
        </div>

        <div className="flex flex-col min-[420px]:flex-row min-[420px]:flex-wrap items-stretch min-[420px]:items-center gap-2.5">
          <Button asChild variant="outline" className="w-full min-[420px]:w-auto">
            <Link href="/schedules">
              <CalendarClock className="h-4 w-4" />
              View Dose Timeline
            </Link>
          </Button>
          {canEdit && members.length > 0 ? (
            <Button
              onClick={() => {
                setEditingMed(null);
                setDialogOpen(true);
              }}
              className="w-full min-[420px]:w-auto"
            >
              <Plus className="h-4 w-4" />
              Add Medicine
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search medicine name, dosage, or doctor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <SelectNative
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            className="sm:w-56"
          >
            <option value="">All Family Members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </SelectNative>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Add a family member first"
          description="Medicines must be assigned to a parent or family member profile."
          action={
            <Button asChild>
              <Link href="/family">Go to Family Members</Link>
            </Button>
          }
        />
      ) : medicines.length === 0 ? (
        <EmptyState
          icon={Pill}
          title="No medicines configured yet"
          description="Add a prescription with one or more daily dose slots to generate meal & medicine calls."
          action={
            canEdit ? (
              <Button
                onClick={() => {
                  setEditingMed(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add First Medicine
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {medicines.map((med) => {
            const patient =
              typeof med.familyMemberId === 'object' ? med.familyMemberId : null;
            return (
              <Card key={med.id} className="hover:shadow-card-hover">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{med.name}</h3>
                        <Badge variant="default">{med.dosage}</Badge>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-blue-600">
                        For: {patient?.fullName || 'Assigned Member'}
                        {med.prescribingDoctor ? ` • ${med.prescribingDoctor}` : ''}
                      </p>
                    </div>
                    <Badge variant={med.isActive ? 'success' : 'neutral'}>
                      {med.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-600">{med.prescribedInstructions}</p>

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Scheduled Dose Slots ({med.scheduledTimes.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {med.scheduledTimes.map((slot, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2 text-xs"
                        >
                          <p className="font-bold text-slate-800">
                            {slot.timeOfDay} — {slot.slotLabel}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {slot.foodInstruction.replace(/_/g, ' ')} •{' '}
                            {slot.associatedMeal.replace(/_/g, ' ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col min-[420px]:flex-row min-[420px]:items-center justify-between gap-2.5 pt-2 border-t border-sky-100 text-xs text-slate-500">
                    <span>Frequency: {med.frequency.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingMed(med);
                            setDialogOpen(true);
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          size="sm"
                          variant="softDestructive"
                          onClick={() => handleDelete(med)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <MedicineFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members}
        medicine={editingMed}
        onSaved={loadData}
      />
    </div>
  );
}

