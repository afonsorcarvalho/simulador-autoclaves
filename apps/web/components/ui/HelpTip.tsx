'use client';

import { useId, useState } from 'react';

/** Ícone "?" com balão de ajuda: abre no hover, no foco (teclado) e no toque; Esc fecha. */
export function HelpTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-block" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`Ajuda: ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="ml-1 w-4 h-4 rounded-full bg-slate-600 text-[10px] leading-4 text-center text-slate-100 hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`${open ? 'block' : 'hidden'} absolute z-20 left-0 top-5 w-72 max-w-[80vw] rounded border border-slate-600 bg-slate-900 p-2 text-xs leading-snug text-slate-200 shadow-lg`}
      >
        {text}
      </span>
    </span>
  );
}
