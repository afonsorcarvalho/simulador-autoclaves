import type { ReactNode } from 'react';

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
      {title && (
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-2">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
