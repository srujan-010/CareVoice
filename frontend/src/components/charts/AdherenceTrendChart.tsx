'use client';

import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface AdherencePoint {
  date: string;
  label: string;
  adherencePct: number;
  taken: number;
  notTaken: number;
  unconfirmed: number;
}

export function AdherenceTrendChart({ data }: { data: AdherencePoint[] }) {
  const hasActivity = data.some((d) => d.taken + d.notTaken + d.unconfirmed > 0);

  if (!hasActivity) {
    return (
      <div className="flex h-56 sm:h-64 w-full min-w-0 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-sky-50/40 px-4 text-center">
        <div>
          <p className="text-sm font-semibold text-slate-700">No dose confirmations recorded yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Daily adherence percentages appear once dose instances are generated and confirmed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-56 sm:h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="carevoiceBlueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E0F2FE" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748B', fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748B', fontSize: 11 }}
            unit="%"
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#FFFFFF',
              borderColor: '#BAE6FD',
              borderRadius: '12px',
              boxShadow: '0 8px 24px -6px rgba(37,99,235,0.16)',
              color: '#0F172A',
              fontSize: '12px',
            }}
            formatter={(value: number) => [`${value}%`, 'Adherence']}
          />
          <Area
            type="monotone"
            dataKey="adherencePct"
            stroke="#2563EB"
            strokeWidth={2.5}
            fillOpacity={1}
            fill="url(#carevoiceBlueGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

