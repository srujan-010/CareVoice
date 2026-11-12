'use client';

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface TrendPoint {
  label: string;
  taken: number;
  notTaken: number;
  unconfirmed: number;
}

export function ConfirmationTrendChart({ data }: { data: TrendPoint[] }) {
  const hasDoses = data.some((d) => d.taken + d.notTaken + d.unconfirmed > 0);

  if (!hasDoses) {
    return (
      <div className="flex h-56 sm:h-64 w-full min-w-0 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-sky-50/40 px-4 text-center">
        <div>
          <p className="text-sm font-semibold text-slate-700">No medicine confirmation trends yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Taken, Not Taken, and Unconfirmed doses are never combined.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-56 sm:h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E0F2FE" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748B', fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748B', fontSize: 11 }}
            width={36}
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
          />
          <Legend wrapperStyle={{ fontSize: '11px', color: '#475569', paddingTop: '6px' }} />
          <Bar dataKey="taken" stackId="a" name="Reported Taken" fill="#10B981" />
          <Bar dataKey="unconfirmed" stackId="a" name="Unconfirmed" fill="#F59E0B" />
          <Bar
            dataKey="notTaken"
            stackId="a"
            name="Reported Not Taken"
            fill="#F43F5E"
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

