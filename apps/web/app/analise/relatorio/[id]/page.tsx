import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import { ID_RE, ler } from '../../../../server/ciclos/store';
import { knobMeta } from '../../../../server/knobs/registry';
import Relatorio from './Relatorio';

export const dynamic = 'force-dynamic';

function versaoSim(): string {
  const v = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
  try {
    return `${v} (${execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()})`;
  } catch {
    return v;
  }
}

export default function Page({ params }: { params: { id: string } }) {
  if (!ID_RE.test(params.id)) notFound();
  const c = ler(params.id);
  if (!c) notFound();
  const knobs = knobMeta().map(({ id, label, unit, decimals, optionLabels }) => ({ id, label, unit, decimals, optionLabels }));
  return <Relatorio c={c} knobs={knobs} versaoSim={versaoSim()} />;
}
