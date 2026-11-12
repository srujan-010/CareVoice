'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, PhoneCall, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, SelectNative } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COMMON_TIMEZONES } from '@/lib/constants';
import type { UserRole } from '@/types';

interface CaregiverItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
}

export default function SettingsPage() {
  const { user, family, refreshSession } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [familyName, setFamilyName] = useState(family?.name || '');
  const [timezone, setTimezone] = useState(family?.timezone || 'Asia/Kolkata');
  const [autoEscalationMinutes, setAutoEscalationMinutes] = useState(
    family?.settings?.autoEscalationMinutes ?? 30
  );
  const [maxCallbackRetries, setMaxCallbackRetries] = useState(
    family?.settings?.maxCallbackRetries ?? 3
  );
  const [savingFamily, setSavingFamily] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [caregivers, setCaregivers] = useState<CaregiverItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('CAREGIVER');

  const [healthInfo, setHealthInfo] = useState<{
    database?: { connected: boolean; state: string };
    telephony?: {
      mode: string;
      ready: boolean;
      missingFields: string[];
      webhookReady?: boolean;
      missingWebhookFields?: string[];
      mockSimulationAllowed?: boolean;
    };
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [users, health] = await Promise.all([
        apiRequest<CaregiverItem[]>('/auth/caregivers'),
        apiRequest<{
          database?: { connected: boolean; state: string };
          telephony?: {
            mode: string;
            ready: boolean;
            missingFields: string[];
            webhookReady?: boolean;
            missingWebhookFields?: string[];
            mockSimulationAllowed?: boolean;
          };
        }>('/health'),
      ]);
      setCaregivers(users);
      setHealthInfo(health);
    } catch {
      // handled gracefully
    }
  }, []);

  useEffect(() => {
    if (family) {
      setFamilyName(family.name);
      setTimezone(family.timezone);
      setAutoEscalationMinutes(family.settings?.autoEscalationMinutes ?? 30);
      setMaxCallbackRetries(family.settings?.maxCallbackRetries ?? 3);
    }
    loadData();
  }, [family, loadData]);

  const handleSaveFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingFamily(true);
    setSaveMessage(null);
    try {
      await apiRequest('/auth/family', {
        method: 'PATCH',
        body: JSON.stringify({
          name: familyName,
          timezone,
          settings: {
            autoEscalationMinutes: Number(autoEscalationMinutes),
            maxCallbackRetries: Number(maxCallbackRetries),
          },
        }),
      });
      await refreshSession();
      setSaveMessage('Family settings saved.');
    } finally {
      setSavingFamily(false);
    }
  };

  const handleAddCaregiver = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/auth/caregivers', {
      method: 'POST',
      body: JSON.stringify({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      }),
    });
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    loadData();
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Platform & Safety Settings
        </h1>
        <p className="text-sm text-slate-500">
          Manage family workspace configuration, caregiver access roles, and Sarvam voice readiness.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Family Workspace Settings</CardTitle>
            <CardDescription>Default timezone, escalation threshold, and retry limits</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveFamily} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Family Name
                </label>
                <Input
                  disabled={!isAdmin}
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Default Timezone
                </label>
                <SelectNative
                  disabled={!isAdmin}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Escalation Window (min)
                  </label>
                  <Input
                    type="number"
                    min={5}
                    max={180}
                    disabled={!isAdmin}
                    value={autoEscalationMinutes}
                    onChange={(e) => setAutoEscalationMinutes(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Max Callback Retries
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    disabled={!isAdmin}
                    value={maxCallbackRetries}
                    onChange={(e) => setMaxCallbackRetries(Number(e.target.value))}
                  />
                </div>
              </div>
              {saveMessage ? (
                <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {saveMessage}
                </p>
              ) : null}
              {isAdmin ? (
                <Button type="submit" disabled={savingFamily}>
                  {savingFamily ? 'Saving...' : 'Save Workspace Settings'}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-blue-600" />
              Sarvam Voice & System Readiness
            </CardTitle>
            <CardDescription>
              Credentials remain securely in backend environment variables only
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 space-y-2 text-xs sm:text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">MongoDB Atlas</span>
                <Badge variant={healthInfo?.database?.connected ? 'success' : 'warning'}>
                  {healthInfo?.database?.state || 'checking'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Voice Provider Mode</span>
                <Badge variant={healthInfo?.telephony?.ready ? 'success' : 'default'}>
                  {healthInfo?.telephony?.mode?.toUpperCase() || 'MOCK'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Real Telephony</span>
                <Badge variant={healthInfo?.telephony?.ready ? 'success' : 'neutral'}>
                  {healthInfo?.telephony?.ready ? 'Enabled' : 'Safely Disabled'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Authenticated Webhook</span>
                <Badge variant={healthInfo?.telephony?.webhookReady ? 'success' : 'warning'}>
                  {healthInfo?.telephony?.webhookReady ? 'HTTPS Ready' : 'Not Configured'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Mock Sandbox Mode</span>
                <Badge variant={healthInfo?.telephony?.mockSimulationAllowed ? 'warning' : 'neutral'}>
                  {healthInfo?.telephony?.mockSimulationAllowed
                    ? 'Allowed (Dev/Testing)'
                    : 'Locked in Production'}
                </Badge>
              </div>
            </div>

            {healthInfo?.telephony && !healthInfo.telephony.ready ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800 space-y-1">
                <p className="font-bold">Missing backend configuration for live telephony:</p>
                <p>{healthInfo.telephony.missingFields.join(', ')}</p>
                {healthInfo.telephony.missingWebhookFields &&
                healthInfo.telephony.missingWebhookFields.length > 0 ? (
                  <p className="pt-1">
                    <strong>Missing webhook/deployment config:</strong>{' '}
                    {healthInfo.telephony.missingWebhookFields.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border border-sky-100 bg-white p-3.5 text-xs text-slate-600 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
              <span>
                Medical Safety Guardrail: CareVoice AI agents only remind, ask about meals, record
                patient-reported intake, schedule callbacks, and escalate. They never prescribe or
                modify dosages.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Caregivers RBAC */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            Family Caregivers & Role Access
          </CardTitle>
          <CardDescription>
            Role-based access: ADMIN (full control), CAREGIVER (manage members & medicines), VIEWER
            (read-only)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {caregivers.map((cg) => (
              <div
                key={cg.id}
                className="rounded-xl border border-sky-100 bg-sky-50/40 p-3.5 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{cg.name}</p>
                  <p className="text-xs text-slate-500">{cg.email}</p>
                </div>
                <Badge variant="default">{cg.role}</Badge>
              </div>
            ))}
          </div>

          {isAdmin ? (
            <form
              onSubmit={handleAddCaregiver}
              className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4 grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
            >
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Name</label>
                <Input
                  required
                  placeholder="Brother / Sister"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Email</label>
                <Input
                  type="email"
                  required
                  placeholder="caregiver@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Password</label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Min 8 chars"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Role</label>
                <SelectNative
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                >
                  <option value="CAREGIVER">CAREGIVER</option>
                  <option value="VIEWER">VIEWER</option>
                  <option value="ADMIN">ADMIN</option>
                </SelectNative>
              </div>
              <Button type="submit">
                <UserPlus className="h-4 w-4" />
                Add User
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

