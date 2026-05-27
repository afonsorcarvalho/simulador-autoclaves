import { NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { CycleConfigSchema } from '../../../../server/virtual-plc/cycle-config';
import { getRuntime } from '../../../../server/runtime/singleton';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const scenario = url.searchParams.get('scenario') ?? 'ster-134-prevac.yaml';
  const path = resolve(process.cwd(), 'server/scenarios', scenario);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return NextResponse.json({ error: `scenario "${scenario}" not found` }, { status: 404 });
  }
  const cycle = CycleConfigSchema.parse(yaml.load(text));
  const runtime = getRuntime();
  if (runtime.cycle_running) {
    return NextResponse.json({ error: 'cycle already running' }, { status: 409 });
  }
  runtime.startCycle(cycle);
  return NextResponse.json({ ok: true, cycle: cycle.name });
}
