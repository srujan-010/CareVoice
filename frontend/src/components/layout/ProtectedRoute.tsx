'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HeartHandshake } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FBFF]">
        <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-6 py-4 shadow-card">
          <div className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-blue-600 text-white">
            <HeartHandshake className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Verifying CareVoice session...</p>
            <p className="text-xs text-slate-500">Connecting securely to your family workspace</p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

