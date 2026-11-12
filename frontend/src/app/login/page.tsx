'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  Globe2,
  HeartHandshake,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, SelectNative } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { COMMON_TIMEZONES } from '@/lib/constants';
import { ApiClientError } from '@/lib/api';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [familyName, setFamilyName] = useState('');
  const [name, setName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(loginEmail, loginPassword);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to sign in. Please check your credentials.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({
        familyName,
        name,
        email: regEmail,
        password: regPassword,
        phone: phone || undefined,
        timezone,
      });
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to create family account. Please review your details.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#EFF6FF] via-[#F8FBFF] to-[#E0F2FE] px-4 py-8 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 items-center">
        {/* Left healthcare SaaS value panel */}
        <div className="lg:col-span-6 space-y-6 animate-fade-up">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-sky-200 bg-white px-4 py-1.5 shadow-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
              <HeartHandshake className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-bold tracking-wide text-blue-700 uppercase">
              CareVoice Platform
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Caring voice calls that keep parents on track with every medicine.
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Automated multilingual telephone reminders with meal-aware scheduling, smart callbacks,
            and transparent family adherence tracking — built for safety and peace of mind.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 shadow-card">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-blue-600 mb-2.5">
                <Globe2 className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-slate-900">11+ Indian Languages</p>
              <p className="text-xs text-slate-500 mt-1">
                Telugu, Hindi, Marathi, Tamil, Kannada, Bengali & English per parent.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 shadow-card">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 mb-2.5">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <p className="text-sm font-bold text-slate-900">Meal & Dose Accuracy</p>
              <p className="text-xs text-slate-500 mt-1">
                Separate before/after meal checks, smart callbacks, and confirmed dose logs.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-sky-200/80 bg-white/80 px-4 py-3 text-xs text-slate-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600" />
            <span>
              Safety-first assistant: strictly reminds and confirms — never alters prescriptions or
              dosages.
            </span>
          </div>
        </div>

        {/* Right login / register card */}
        <div className="lg:col-span-6">
          <Card className="border-sky-200/90 bg-white shadow-xl shadow-blue-900/5">
            <CardContent className="p-6 sm:p-8">
              <Tabs
                value={tab}
                onValueChange={(v) => {
                  setTab(v as 'login' | 'register');
                  setError(null);
                }}
              >
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Admin Sign In</TabsTrigger>
                  <TabsTrigger value="register">Create Family Account</TabsTrigger>
                </TabsList>

                {error ? (
                  <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm font-medium text-rose-700">
                    {error}
                  </div>
                ) : null}

                <TabsContent value="login" className="mt-0">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                        Email Address
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <Input
                          type="email"
                          required
                          placeholder="family.admin@example.com"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <Input
                          type="password"
                          required
                          placeholder="Enter your password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full h-11" disabled={submitting}>
                      {submitting ? 'Signing in...' : 'Sign In to CareVoice'}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="mt-0">
                  <form onSubmit={handleRegister} className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Family Account Name
                        </label>
                        <div className="relative">
                          <Users className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                          <Input
                            required
                            placeholder="Sharma Family"
                            value={familyName}
                            onChange={(e) => setFamilyName(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Your Full Name
                        </label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                          <Input
                            required
                            placeholder="Ananya Sharma"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Admin Email
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <Input
                          type="email"
                          required
                          placeholder="ananya@example.com"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Password (min 8 chars)
                        </label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                          <Input
                            type="password"
                            required
                            minLength={8}
                            placeholder="••••••••"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">
                          Phone (optional)
                        </label>
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                          <Input
                            placeholder="+919876543210"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="pl-9"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Default Family Timezone
                      </label>
                      <SelectNative
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

                    <Button type="submit" className="w-full h-11 mt-1" disabled={submitting}>
                      {submitting ? 'Creating workspace...' : 'Create Family Care Account'}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

