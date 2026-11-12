'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Edit3,
  Eye,
  Globe2,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { FamilyMemberDialog } from '@/components/family/FamilyMemberDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, SelectNative } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getLanguageLabel } from '@/lib/constants';
import type { FamilyMember } from '@/types';

export default function FamilyMembersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';
  const canDelete = user?.role === 'ADMIN';

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter === 'active') params.set('isActive', 'true');
      if (statusFilter === 'inactive') params.set('isActive', 'false');
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await apiRequest<FamilyMember[]>(`/family-members${query}`);
      setMembers(res);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load family members');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleToggleActive = async (member: FamilyMember) => {
    try {
      await apiRequest(`/family-members/${member.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      fetchMembers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleDelete = async (member: FamilyMember) => {
    if (!window.confirm(`Delete ${member.fullName}? This will cancel queued reminder calls.`)) {
      return;
    }
    try {
      await apiRequest(`/family-members/${member.id}`, { method: 'DELETE' });
      fetchMembers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete member');
    }
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Family Members
          </h1>
          <p className="text-sm text-slate-500">
            Manage parents and elders with individual languages, timezones, and calling consent.
          </p>
        </div>

        {canEdit ? (
          <Button
            onClick={() => {
              setEditingMember(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Family Member
          </Button>
        ) : null}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by name, phone, or relationship..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <SelectNative
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="sm:w-48"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </SelectNative>
        </CardContent>
      </Card>

      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {actionError}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Skeleton key={idx} className="h-56 w-full" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No family members found"
          description="Add your mother, father, or elder family member to begin managing their multilingual voice reminders."
          action={
            canEdit ? (
              <Button
                onClick={() => {
                  setEditingMember(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add Family Member
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {members.map((member) => (
            <Card key={member.id} className="hover:shadow-card-hover flex flex-col justify-between">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">{member.fullName}</h3>
                      {member.age ? (
                        <span className="text-xs font-medium text-slate-400">({member.age}y)</span>
                      ) : null}
                    </div>
                    <p className="text-xs font-semibold text-blue-600">{member.relationship}</p>
                  </div>
                  <Badge variant={member.isActive ? 'success' : 'neutral'}>
                    {member.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/40 p-3 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-blue-500" />
                    <span className="font-semibold text-slate-800">{member.phoneNumber}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe2 className="h-3.5 w-3.5 text-blue-500" />
                    <span>
                      {getLanguageLabel(member.preferredLanguage)} • {member.timezone}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                    <span>
                      Recording Consent:{' '}
                      <strong className="text-slate-800">{member.recordingConsentStatus}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Active Medicines:{' '}
                    <strong className="text-slate-800">{member.activeMedicineCount ?? 0}</strong>
                  </span>
                  <span>
                    Quiet: {member.callingPreferences?.quietHoursStart}–
                    {member.callingPreferences?.quietHoursEnd}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-sky-100">
                  <Button asChild size="sm" variant="secondary" className="flex-1">
                    <Link href={`/family/${member.id}`}>
                      <Eye className="h-3.5 w-3.5" />
                      Profile
                    </Link>
                  </Button>
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingMember(member);
                          setDialogOpen(true);
                        }}
                        title="Edit member"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleActive(member)}
                        title={member.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {member.isActive ? (
                          <UserMinus className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                      </Button>
                    </>
                  ) : null}
                  {canDelete ? (
                    <Button
                      size="sm"
                      variant="softDestructive"
                      onClick={() => handleDelete(member)}
                      title="Delete member"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FamilyMemberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editingMember}
        onSaved={fetchMembers}
      />
    </div>
  );
}

