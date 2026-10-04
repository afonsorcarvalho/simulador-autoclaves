import { NextResponse } from 'next/server';
import { getRuntime } from '../../../../server/runtime/singleton';

export const dynamic = 'force-dynamic';

/** POST /api/plant/reset?preset=cold|preheated — reseta a planta simulada (máquina fria/pré-aquecida).
 *  &gerador=frio: gerador também frio (fonte 3, gerador próprio); padrão = gerador quente (linha). */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const preset = q.get('preset') ?? 'cold';
  if (preset !== 'cold' && preset !== 'preheated') {
    return NextResponse.json({ error: `preset "${preset}" inválido` }, { status: 400 });
  }
  getRuntime().resetPlant(preset, q.get('gerador') === 'frio');
  return NextResponse.json({ ok: true, preset });
}
