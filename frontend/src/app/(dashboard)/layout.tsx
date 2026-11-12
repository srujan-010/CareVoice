'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Sidebar } from '@/components/layout/Sidebar';
import { apiRequest } from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState<'mock' | 'sarvam'>('mock');

  useEffect(() => {
    apiRequest<{ telephony?: { mode?: 'mock' | 'sarvam' } }>('/health')
      .then((res) => {
        if (res?.telephony?.mode) setVoiceMode(res.telephony.mode);
      })
      .catch(() => {
        // fallback stays mock
      });
  }, []);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-[#F8FBFF] overflow-x-clip">
        <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
        <div className="lg:pl-64 flex min-h-screen min-w-0 flex-col">
          <Header onOpenMobileMenu={() => setMobileOpen(true)} voiceMode={voiceMode} />
          <main className="flex-1 min-w-0 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}

