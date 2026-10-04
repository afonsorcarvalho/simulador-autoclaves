import { Badge } from '../ui/Badge';

export type Veredito = 'PASSOU' | 'FALHOU' | 'ERRO' | 'NAO_APLICAVEL' | 'PARADO';

export interface ResultadoCenario {
  id: string;
  titulo: string;
  origem: string;
  automacao: string;
  veredito: Veredito;
  esperados: { descricao: string; esperado: unknown; obtido: unknown; ok: boolean }[];
  foto: string | null;
  duracao_s: number;
  erro?: string;
  interrompido_por_guarda?: true;
  nota?: string;
  justificativa_na?: string;
}

const VARIANTE: Record<Veredito, 'ok' | 'err' | 'warn' | 'neutral'> = {
  PASSOU: 'ok',
  FALHOU: 'err',
  ERRO: 'warn',
  NAO_APLICAVEL: 'neutral',
  PARADO: 'neutral',
};

export function VereditoBadge({ v }: { v: Veredito }) {
  return <Badge variant={VARIANTE[v]}>{v === 'NAO_APLICAVEL' ? 'N/A' : v}</Badge>;
}

export const urlArquivo = (exec: string, nome: string) =>
  `/api/erros/arquivo?exec=${encodeURIComponent(exec)}&nome=${encodeURIComponent(nome)}`;

const fmt = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));

export const DICA_REFAZER = 'O resultado novo substitui o anterior no laudo acumulado';

export function ResultCard({ r, exec, rodando, onRefazer }: { r: ResultadoCenario; exec: string | null; rodando: boolean; onRefazer: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <VereditoBadge v={r.veredito} />
        <span className="font-mono text-sm">{r.id}</span>
        <span className="text-sm">{r.titulo}</span>
        <span className="ml-auto text-xs text-slate-400">{r.duracao_s.toFixed(1)} s</span>
        <button
          className="rounded bg-slate-700 hover:bg-slate-600 px-2 py-0.5 text-xs disabled:opacity-50"
          disabled={rodando}
          title={DICA_REFAZER}
          onClick={() => onRefazer(r.id)}
        >
          Refazer este cenário
        </button>
      </div>
      {r.esperados.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-slate-400 text-left">
            <tr><th>Esperado</th><th>Valor esperado</th><th>Obtido</th><th /></tr>
          </thead>
          <tbody>
            {r.esperados.map((e, i) => (
              <tr key={i} className="border-t border-slate-700">
                <td>{e.descricao}</td>
                <td className="font-mono">{fmt(e.esperado)}</td>
                <td className="font-mono">{fmt(e.obtido)}</td>
                <td>{e.ok ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.interrompido_por_guarda && <p className="text-xs font-semibold text-amber-200">Interrompido: ciclo abortou antes do previsto</p>}
      {r.erro && <p className="text-xs text-amber-300">Erro: {r.erro}</p>}
      {r.nota && <p className="text-xs text-slate-300">Nota: {r.nota}</p>}
      {r.justificativa_na && <p className="text-xs text-slate-300">Justificativa (N/A): {r.justificativa_na}</p>}
      {r.foto && exec && (
        <a href={urlArquivo(exec, r.foto)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urlArquivo(exec, r.foto)} alt={`Tela da IHM — ${r.id}`} className="max-h-40 rounded border border-slate-600" />
        </a>
      )}
    </div>
  );
}
