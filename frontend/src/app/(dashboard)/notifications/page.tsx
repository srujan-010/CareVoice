'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, Check, CheckCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTimeInTz } from '@/lib/utils';

interface EscalationItem {
  _id: string;
  familyMemberId?: { fullName: string; phoneNumber: string; relationship: string };
  reason: string;
  severity: string;
  status: string;
  description: string;
  createdAt: string;
}

interface NotificationItem {
  _id: string;
  familyMemberId?: { fullName: string; relationship: string };
  channel: string;
  triggerType: string;
  recipientName: string;
  recipientContact: string;
  title: string;
  message: string;
  status: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'CAREGIVER';

  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [adapterStatus, setAdapterStatus] = useState<{
    inApp: { enabled: boolean };
    whatsapp: { enabled: boolean };
    sms: { enabled: boolean };
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [escList, notifData] = await Promise.all([
        apiRequest<EscalationItem[]>('/escalations'),
        apiRequest<{
          notifications: NotificationItem[];
          adapterStatus: {
            inApp: { enabled: boolean };
            whatsapp: { enabled: boolean };
            sms: { enabled: boolean };
          };
        }>('/notifications'),
      ]);
      setEscalations(escList);
      setNotifications(notifData.notifications || []);
      setAdapterStatus(notifData.adapterStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleEscalationAction = async (id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    await apiRequest(`/escalations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    loadAll();
  };

  const handleMarkRead = async (id: string) => {
    await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
    loadAll();
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
    loadAll();
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Alerts, Escalations & Notifications
          </h1>
          <p className="text-sm text-slate-500">
            Caregiver escalations and multi-channel notifications (In-App, WhatsApp, SMS adapters).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="outline" onClick={loadAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {canEdit && notifications.some((n) => !n.isRead) ? (
            <Button variant="secondary" onClick={handleMarkAllRead}>
              <CheckCheck className="h-4 w-4" />
              Mark All Read
            </Button>
          ) : null}
        </div>
      </div>

      {/* Adapter readiness status */}
      {adapterStatus ? (
        <div className="flex flex-wrap gap-2.5">
          <Badge variant="success">In-App Alerts: Enabled</Badge>
          <Badge variant={adapterStatus.whatsapp.enabled ? 'success' : 'neutral'}>
            WhatsApp Adapter:{' '}
            {adapterStatus.whatsapp.enabled ? 'Configured' : 'Disabled (Awaiting Credentials)'}
          </Badge>
          <Badge variant={adapterStatus.sms.enabled ? 'success' : 'neutral'}>
            SMS Adapter: {adapterStatus.sms.enabled ? 'Configured' : 'Disabled (Awaiting Credentials)'}
          </Badge>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Escalations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                Safety & Missed-Dose Escalations
              </CardTitle>
              <CardDescription>
                Triggered by repeated no-answer, unwell reports, or forgotten doses
              </CardDescription>
            </CardHeader>
            <CardContent>
              {escalations.length === 0 ? (
                <EmptyState
                  icon={ShieldAlert}
                  title="No escalations recorded"
                  description="Emergency or missed-dose escalations appear here with caregiver acknowledgement actions."
                />
              ) : (
                <div className="space-y-3">
                  {escalations.map((esc) => (
                    <div
                      key={esc._id}
                      className="rounded-xl border border-sky-100 bg-sky-50/35 p-4 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {esc.familyMemberId?.fullName || 'Patient'} —{' '}
                            {esc.reason.replace(/_/g, ' ')}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatDateTimeInTz(esc.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              esc.severity === 'CRITICAL' || esc.severity === 'HIGH'
                                ? 'danger'
                                : 'warning'
                            }
                          >
                            {esc.severity}
                          </Badge>
                          <Badge variant={esc.status === 'RESOLVED' ? 'success' : 'indigo'}>
                            {esc.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-slate-700">{esc.description}</p>
                      {canEdit && esc.status !== 'RESOLVED' ? (
                        <div className="flex justify-end gap-2">
                          {esc.status === 'OPEN' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEscalationAction(esc._id, 'ACKNOWLEDGED')}
                            >
                              Acknowledge
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleEscalationAction(esc._id, 'RESOLVED')}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Resolve
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-blue-600" />
                Notification Dispatch Log
              </CardTitle>
              <CardDescription>
                External WhatsApp/SMS sends only when credentials and member consent are granted
              </CardDescription>
            </CardHeader>
            <CardContent>
              {notifications.length === 0 ? (
                <EmptyState
                  icon={BellRing}
                  title="No notifications dispatched yet"
                  description="Alerts for missed calls, forgotten medicines, or wellness checks will show here."
                />
              ) : (
                <div className="space-y-3">
                  {notifications.map((n) => (
                    <div
                      key={n._id}
                      className={`rounded-xl border p-4 space-y-2 ${
                        n.isRead
                          ? 'border-sky-100 bg-white'
                          : 'border-blue-200 bg-sky-50/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{n.title}</p>
                          <p className="text-xs text-slate-500">
                            {n.channel} • To: {n.recipientName} ({n.recipientContact})
                          </p>
                        </div>
                        <Badge
                          variant={
                            n.status === 'DELIVERED' || n.status === 'SENT'
                              ? 'success'
                              : n.status === 'FAILED'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {n.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-700">{n.message}</p>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{formatDateTimeInTz(n.createdAt)}</span>
                        {canEdit && !n.isRead ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleMarkRead(n._id)}
                          >
                            Mark Read
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

