'use client';

import { useState } from 'react';
import { Card } from '../ui/Card';
import { DICA_REFAZER, VereditoBadge, type Veredito } from './ResultCard';

export interface CenarioResumo {
  id: string;
  titulo: string;
  origem: string;
  automacao: string;
}

const grupoDe = (id: string) => id.match(/^[A-Za-z]+/)?.[0] ?? '';
const botao = 'rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-sm disabled:opacity-50';

export function ScenarioList({
  cenarios,
  erro,
  vereditos,
  rodando,
  onRodar,
  onParar,
}: {
  cenarios: CenarioResumo[];
  erro: string | null;
  vereditos: Record<string, Veredito>;
  rodando: boolean;
  onRodar: (ids?: string[]) => void;
  onParar: () => void;
}) {
  const [grupo, setGrupo] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const grupos = [...new Set(cenarios.map((c) => grupoDe(c.id)))].sort();
  const visiveis = grupo ? cenarios.filter((c) => grupoDe(c.id) === grupo) : cenarios;
  const alternar = (id: string) => {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSel(s);
  };

  return (
    <Card title="Cenários">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <select className="rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
          <option value="">Todos os grupos</option>
          {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button className={botao} disabled={rodando || sel.size === 0} onClick={() => onRodar([...sel])}>
          Rodar selecionados ({sel.size})
        </button>
        <button className={botao} disabled={rodando || cenarios.length === 0} onClick={() => onRodar()}>Rodar todos</button>
        <button className="rounded bg-red-700 hover:bg-red-600 px-3 py-1 text-sm disabled:opacity-50" disabled={!rodando} onClick={onParar}>
          Parar
        </button>
      </div>
      {Object.keys(vereditos).length > 0 && <p className="mb-2 text-xs text-slate-400">Refazer: {DICA_REFAZER.toLowerCase()}.</p>}
      {erro && <p role="alert" className="mb-2 rounded border border-red-700 bg-red-900/40 px-3 py-2 text-sm text-red-200">{erro}</p>}
      {cenarios.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum cenário carregado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-400">
            <tr>
              <th className="w-6">
                <input
                  type="checkbox"
                  aria-label="Selecionar visíveis"
                  checked={visiveis.length > 0 && visiveis.every((c) => sel.has(c.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...visiveis.map((c) => c.id)]) : new Set())}
                />
              </th>
              <th>ID</th><th>Título</th><th>Grupo</th><th>Automação</th><th>Último veredito</th><th />
            </tr>
          </thead>
          <tbody>
            {visiveis.map((c) => (
              <tr key={c.id} className="border-t border-slate-700">
                <td><input type="checkbox" aria-label={`Selecionar ${c.id}`} checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
                <td className="font-mono">{c.id}</td>
                <td>{c.titulo}</td>
                <td>{grupoDe(c.id)}</td>
                <td>{c.automacao}</td>
                <td>{vereditos[c.id] ? <VereditoBadge v={vereditos[c.id]!} /> : <span className="text-slate-500">—</span>}</td>
                <td>
                  {vereditos[c.id] && (
                    <button className="rounded bg-slate-700 hover:bg-slate-600 px-2 py-0.5 text-xs disabled:opacity-50" disabled={rodando} title={DICA_REFAZER} onClick={() => onRodar([c.id])}>
                      Refazer este cenário
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
