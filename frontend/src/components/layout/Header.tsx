'use client';

import React from 'react';
import Link from 'next/link';
import {
  HeartHandshake,
  LogOut,
  Menu,
  PhoneCall,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { getVoiceModeHeaderLabel } from '@/lib/voiceDisplay';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  voiceMode?: string;
}

export function Header({ onOpenMobileMenu, voiceMode = 'mock' }: HeaderProps) {
  const { user, family, logout } = useAuth();
  const isLiveVoice = voiceMode !== 'mock';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-sky-100 bg-white/95 backdrop-blur-md px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-slate-600 hover:bg-sky-50 hover:text-blue-600 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Compact mobile CareVoice mark */}
        <Link
          href="/dashboard"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-sm shadow-blue-600/20 lg:hidden"
          aria-label="CareVoice Home"
        >
          <HeartHandshake className="h-4 w-4" />
        </Link>

        <div className="min-w-0">
          <p className="truncate text-xs sm:text-sm font-bold text-slate-900 leading-tight max-w-[140px] min-[400px]:max-w-[210px] sm:max-w-xs">
            {family?.name || 'Family Care Workspace'}
          </p>
          <p className="truncate text-[10px] sm:text-[11px] font-medium text-slate-500">
            <span className="hidden sm:inline">Timezone: </span>
            {family?.timezone || 'Asia/Kolkata'}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <Badge
          variant={isLiveVoice ? 'success' : 'default'}
          className="hidden sm:inline-flex"
        >
          <PhoneCall className="h-3 w-3" />
          {getVoiceModeHeaderLabel(voiceMode)}
        </Badge>

        {/* Accessible user profile indicator across mobile + desktop */}
        <Link
          href="/settings"
          title={`${user?.name || 'User'} (${user?.role || 'CAREGIVER'})`}
          className="flex min-h-[40px] items-center gap-1.5 sm:gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-2 sm:px-3 py-1.5 hover:bg-sky-100/70 transition-colors"
        >
          <UserCircle2 className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="hidden min-[400px]:block text-left max-w-[85px] sm:max-w-[140px]">
            <p className="truncate text-[11px] sm:text-xs font-bold text-slate-800 leading-none">
              {user?.name}
            </p>
            <p className="mt-0.5 hidden md:flex items-center gap-1 text-[10px] font-semibold text-blue-700">
              <ShieldCheck className="h-2.5 w-2.5" />
              {user?.role}
            </p>
          </div>
        </Link>

        <Button
          variant="outline"
          size="sm"
          onClick={logout}
          aria-label="Logout"
          className="min-h-[40px] sm:min-h-0 px-2.5 sm:px-3"
        >
          <LogOut className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
}

