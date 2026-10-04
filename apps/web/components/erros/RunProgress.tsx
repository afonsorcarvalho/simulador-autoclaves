import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

export interface Progresso {
  estado: string;
  instrucao: string | null;
  atual: string | null;
  passo: string | null;
  decorrido_s: number;
  falhas: { id?: string; tipo?: string; alvo?: string }[];
  setupPendenteRestaurado?: string[];
}

export function RunProgress({ p, onContinuar }: { p: Progresso; onContinuar: () => void }) {
  const m = Math.floor(p.decorrido_s / 60);
  const s = String(Math.floor(p.decorrido_s % 60)).padStart(2, '0');
  return (
    <Card title="Execução">
      {p.setupPendenteRestaurado && (
        <p className="mb-2 rounded border border-yellow-600 bg-yellow-900/30 px-3 py-2 text-sm text-yellow-200">
          Aviso: o servidor caiu no meio de uma execução anterior e o setup original foi restaurado
          ({p.setupPendenteRestaurado.join(', ')}). Confira o CLP antes de continuar.
        </p>
      )}
      <div className="flex flex-wrap gap-4 text-sm items-center">
        <span>Estado: <Badge variant={p.estado === 'OCIOSO' ? 'neutral' : p.estado === 'AGUARDANDO_OPERADOR' ? 'warn' : 'ok'}>{p.estado}</Badge></span>
        <span>Cenário: <span className="font-mono">{p.atual ?? '—'}</span></span>
        <span>Tempo: {m}:{s}</span>
        <span>
          Falhas ativas:{' '}
          {p.falhas.length === 0 ? '—' : p.falhas.map((f) => f.id ?? `${f.tipo}:${f.alvo}`).join(', ')}
        </span>
      </div>
      {p.passo && <p className="mt-1 text-xs text-slate-400 font-mono break-all">Passo: {p.passo}</p>}
      {p.estado === 'AGUARDANDO_OPERADOR' && (
        <div className="mt-3 rounded border-2 border-yellow-500 bg-yellow-900/40 p-3">
          <p className="text-lg font-semibold text-yellow-100">{p.instrucao}</p>
          <button className="mt-2 rounded bg-yellow-600 hover:bg-yellow-500 px-4 py-1 font-semibold" onClick={onContinuar}>
            Continuar
          </button>
        </div>
      )}
    </Card>
  );
}
