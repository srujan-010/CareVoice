import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'CareVoice — AI Family Medicine Reminder & Voice Care Platform',
  description:
    'Multilingual AI voice medicine reminders, meal-aware dosing schedules, smart callbacks, and family adherence monitoring.',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: ['/favicon.ico'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-screen bg-[#F8FBFF] font-sans text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

