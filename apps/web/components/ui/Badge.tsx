import type { ReactNode } from 'react';

const variants = {
  ok: 'bg-green-600 text-green-50',
  warn: 'bg-yellow-500 text-yellow-50',
  err: 'bg-red-600 text-red-50',
  neutral: 'bg-slate-600 text-slate-100',
} as const;

export function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${variants[variant]}`}>
      {children}
    </span>
  );
}
