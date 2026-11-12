'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HeartHandshake } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-sky-50 via-white to-blue-50 p-6">
      <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-6 py-4 shadow-card">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
          <HeartHandshake className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">CareVoice</p>
          <p className="text-xs text-slate-500">Loading your family care workspace...</p>
        </div>
      </div>
    </div>
  );
}

