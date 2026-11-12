'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest, getStoredToken, setStoredToken } from './api';
import type { AuthUser, FamilyProfile } from '@/types';

interface AuthContextValue {
  user: AuthUser | null;
  family: FamilyProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    familyName: string;
    name: string;
    email: string;
    password: string;
    phone?: string;
    timezone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [family, setFamily] = useState<FamilyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setFamily(null);
      setLoading(false);
      return;
    }

    try {
      const data = await apiRequest<{ user: AuthUser; family: FamilyProfile }>('/auth/me');
      setUser(data.user);
      setFamily(data.family);
    } catch {
      setStoredToken(null);
      setUser(null);
      setFamily(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (email: string, password: string) => {
    const data = await apiRequest<{
      token: string;
      user: AuthUser;
      family: FamilyProfile;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setFamily(data.family);
    router.push('/dashboard');
  };

  const register = async (payload: {
    familyName: string;
    name: string;
    email: string;
    password: string;
    phone?: string;
    timezone: string;
  }) => {
    const data = await apiRequest<{
      token: string;
      user: AuthUser;
      family: FamilyProfile;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(data.token);
    setUser(data.user);
    setFamily(data.family);
    router.push('/dashboard');
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors during logout cleanup
    } finally {
      setStoredToken(null);
      setUser(null);
      setFamily(null);
      router.push('/login');
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, family, loading, login, register, logout, refreshSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

