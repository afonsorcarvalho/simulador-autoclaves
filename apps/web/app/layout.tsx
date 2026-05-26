import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Simulador de Autoclaves',
  description: 'Steam autoclave HIL emulator dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <body className="min-h-screen">
        <nav className="border-b border-slate-700 bg-slate-800 px-4 py-3 flex gap-4 items-center">
          <span className="font-bold text-lg">Simulador de Autoclaves</span>
          <Link href="/" className="hover:text-blue-400">Home</Link>
          <Link href="/live" className="hover:text-blue-400">Live</Link>
          <Link href="/virtual-plc" className="hover:text-blue-400">Virtual PLC</Link>
        </nav>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
