'use client';

import React from 'react';
import { LogOut, Menu, PhoneCall, ShieldCheck, UserCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  voiceMode?: 'mock' | 'sarvam';
}

export function Header({ onOpenMobileMenu, voiceMode = 'mock' }: HeaderProps) {
  const { user, family, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-sky-100 bg-white/90 backdrop-blur-md px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="rounded-xl border border-sky-200 bg-white p-2 text-slate-600 hover:bg-sky-50 hover:text-blue-600 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div>
          <p className="text-sm font-bold text-slate-900 leading-tight">
            {family?.name || 'Family Care Workspace'}
          </p>
          <p className="text-[11px] font-medium text-slate-500">
            Timezone: {family?.timezone || 'Asia/Kolkata'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3">
        <Badge
          variant={voiceMode === 'sarvam' ? 'success' : 'default'}
          className="hidden sm:inline-flex"
        >
          <PhoneCall className="h-3 w-3" />
          {voiceMode === 'sarvam' ? 'Sarvam Live Telephony' : 'Mock Voice Sandbox'}
        </Badge>

        <div className="hidden md:flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-1.5">
          <UserCircle2 className="h-4 w-4 text-blue-600" />
          <div className="text-left">
            <p className="text-xs font-bold text-slate-800 leading-none">{user?.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-blue-700">
              <ShieldCheck className="h-2.5 w-2.5" />
              {user?.role}
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
}

