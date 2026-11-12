'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BellRing,
  CalendarClock,
  HeartHandshake,
  LayoutDashboard,
  PhoneCall,
  PhoneForwarded,
  Pill,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/family', label: 'Family Members', icon: Users },
  { href: '/medicines', label: 'Medicines', icon: Pill },
  { href: '/schedules', label: 'Dose Schedules', icon: CalendarClock },
  { href: '/calls', label: 'Voice Calls', icon: PhoneCall },
  { href: '/callbacks', label: 'Smart Callbacks', icon: PhoneForwarded },
  { href: '/notifications', label: 'Alerts & Escalations', icon: BellRing },
  { href: '/reports', label: 'Adherence Reports', icon: BarChart3 },
  { href: '/settings', label: 'Platform & Safety', icon: Settings },
];

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();

  const navContent = (
    <div className="flex h-full flex-col bg-white border-r border-sky-100">
      {/* Brand header */}
      <div className="flex h-16 items-center justify-between border-b border-sky-100 px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5" onClick={onCloseMobile}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-sm shadow-blue-600/25">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-base font-extrabold tracking-tight text-slate-900 leading-none">
              CareVoice
            </span>
            <span className="mt-0.5 block text-[11px] font-semibold text-blue-600">
              AI Family Care
            </span>
          </div>
        </Link>
        <button
          onClick={onCloseMobile}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-50 hover:text-blue-600 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-150',
                active
                  ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-sm shadow-blue-600/25'
                  : 'text-slate-600 hover:bg-sky-50 hover:text-blue-700'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-white' : 'text-blue-500')} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Safety reminder footer card */}
      <div className="p-3.5">
        <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-blue-50/70 p-3.5">
          <div className="flex items-center gap-2 text-xs font-bold text-blue-800">
            <Activity className="h-4 w-4 text-blue-600" />
            <span>Medical Safety Guard</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
            AI calls remind & confirm doses only. Prescriptions are never modified automatically.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-64">
        {navContent}
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-sky-100/75 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            {navContent}
          </div>
        </div>
      ) : null}
    </>
  );
}

