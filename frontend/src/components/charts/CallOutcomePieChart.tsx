'use client';

import React from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const OUTCOME_COLORS: Record<string, string> = {
  COMPLETED: '#2563EB',
  ANSWERED: '#0EA5E9',
  CALLBACK_REQUESTED: '#6366F1',
  NO_ANSWER: '#F59E0B',
  BUSY: '#FB923C',
  REJECTED: '#94A3B8',
  ESCALATED: '#F43F5E',
};

export function CallOutcomePieChart({
  data,
}: {
  data: Array<{ outcome: string; count: number }>;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-sky-50/40 px-4 text-center">
        <div>
          <p className="text-sm font-semibold text-slate-700">No call outcomes recorded yet</p>
          <p className="mt-1 text-xs text-slate-500">
            Outcomes from voice reminders and simulated calls appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="outcome"
            cx="50%"
            cy="46%"
            innerRadius={48}
            outerRadius={78}
            paddingAngle={3}
          >
            {data.map((entry) => (
              <Cell
                key={entry.outcome}
                fill={OUTCOME_COLORS[entry.outcome] ?? '#38BDF8'}
              />
            ))}
          </Pie>
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
          <Legend wrapperStyle={{ fontSize: '11px', color: '#475569' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

