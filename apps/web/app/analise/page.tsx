'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, Legend } from 'recharts';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { fmtValor, formatHMS } from '../../lib/format';
import { getKnobs } from '../../lib/knobs-api';
import {
  GRANDEZAS,
  UNIDADE,
  achatar,
  diffParametros,
  escolherEixos,
  faixasFase,
  fmtGrandeza,
  grandeza,
  mesclarSeries,
  passoReducao,
  reduzir,
} from '../../lib/analise';
import type { Ciclo } from '../../server/ciclos/store';

type Item = Omit<Ciclo, 'serie'>;

const CORES = ['#60a5fa', '#fb923c', '#34d399', '#f472b6', '#facc15', '#a78bfa', '#22d3ee', '#f87171'];
const TRACOS = [undefined, '6 3', '2 3'];
const FAIXAS = ['#334155', '#1e3a5f', '#3f2d4f', '#2d4a3a', '#4a3b24', '#4a2a2a'];
const RESULTADOS = ['aprovado', 'abortado', 'parado', 'interrompido', 'desconhecido'] as const;

const badge = (c: Item) =>
  c.meta.parcial ? (
    <Badge variant="warn">gravando</Badge>
  ) : (
    <Badge variant={c.meta.resultado === 'aprovado' ? 'ok' : c.meta.resultado === 'abortado' ? 'err' : 'neutral'}>
      {c.meta.resultado ?? '—'}
    </Badge>
  );
const receita = (c: Item) => (c.meta.modo === 'clp' ? 'CLP' : (c.parametros.ciclo?.name ?? '—'));
const dataHora = (c: Item) => new Date(c.meta.inicio).toLocaleString('pt-BR');
const rotulo = (c: Item) => c.meta.nome || dataHora(c);
const num = (v: unknown) => (typeof v === 'number' ? String(v).replace('.', ',') : v === undefined ? '—' : String(v));

/** Campo de texto que salva ao sair (blur) ou Enter. */
function Editavel({ valor, onSalvar, ph }: { valor: string; onSalvar: (v: string) => void; ph: string }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <input
      value={v}
      placeholder={ph}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== valor && onSalvar(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-full bg-transparent border-b border-slate-700 focus:border-sky-400 outline-none text-sm"
    />
  );
}

export default function AnalisePage() {
  const [lista, setLista] = useState<Item[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [gs, setGs] = useState<string[]>(['t_carga_C']);
  const [comFases, setComFases] = useState(false);
  const [soDifere, setSoDifere] = useState(false);
  const [series, setSeries] = useState<Record<string, Ciclo['serie']>>({});
  const cache = useRef<Record<string, Ciclo['serie']>>({});
  const [knobLabel, setKnobLabel] = useState<Record<string, string>>({});

  const carregar = () =>
    fetch('/api/ciclos')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { ciclos: Item[] }) => setLista(j.ciclos))
      .catch((e: Error) => setErro(e.message));

  useEffect(() => {
    void carregar();
    getKnobs()
      .then((k) => setKnobLabel(Object.fromEntries(k.knobs.map((m) => [m.id, `${m.label}${m.unit ? ` (${m.unit})` : ''}`]))))
      .catch(() => {});
    const t = setInterval(carregar, 10_000); // ciclo "gravando" atualiza
    return () => clearInterval(t);
  }, []);

  // séries sob demanda, só dos selecionados (cache; o ciclo em gravação é rebuscado)
  useEffect(() => {
    for (const id of sel) {
      const parcial = lista.find((c) => c.meta.id === id)?.meta.parcial;
      if (cache.current[id] && !parcial) continue;
      fetch(`/api/ciclos/${id}`)
        .then((r) => r.json())
        .then((c: Ciclo) => {
          cache.current[id] = c.serie;
          setSeries((s) => ({ ...s, [id]: c.serie }));
        })
        .catch(() => {});
    }
  }, [sel, lista]);

  const selCiclos = sel.map((id) => lista.find((c) => c.meta.id === id)).filter((c): c is Item => !!c);
  const { esq, dir, fora } = escolherEixos(gs);
  const visiveis = gs.filter((k) => [esq, dir].includes(grandeza(k).eixo));

  const { dados, passo } = useMemo(() => {
    const ss = selCiclos.map((c) => series[c.meta.id] ?? []);
    const passo = passoReducao(ss.reduce((n, s) => n + s.length, 0));
    return { dados: mesclarSeries(ss.map((s) => reduzir(s, passo)), visiveis), passo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, sel.join(), visiveis.join(), lista]);

  const faixas = comFases && selCiclos[0] ? faixasFase(series[selCiclos[0].meta.id] ?? []) : [];
  const coresFase = new Map<string, string>();
  for (const f of faixas) if (!coresFase.has(f.fase)) coresFase.set(f.fase, FAIXAS[coresFase.size % FAIXAS.length]!);

  const patch = async (id: string, body: object) => {
    await fetch(`/api/ciclos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    void carregar();
  };
  const apagar = async (c: Item) => {
    if (!confirm(`Apagar o ciclo ${rotulo(c)}? Não dá para desfazer.`)) return;
    await fetch(`/api/ciclos/${c.meta.id}`, { method: 'DELETE' });
    setSel((s) => s.filter((x) => x !== c.meta.id));
    void carregar();
  };

  const filtrada = lista.filter((c) => !filtro || (filtro === 'gravando' ? c.meta.parcial : c.meta.resultado === filtro));
  const linhasParam = diffParametros(
    selCiclos.map((c) => ({
      ...achatar(c.parametros.ciclo, 'receita'),
      ...achatar(c.parametros.knobs, 'knob'),
      ...achatar(c.parametros.versoes, 'versão'),
    })),
  ).filter((l) => !soDifere || l.difere);
  const nomeParam = (k: string) => (k.startsWith('knob.') ? (knobLabel[k.slice(5)] ?? k.slice(5)) : k);

  const resumo: [string, (c: Item) => string][] = [
    ['Receita', receita],
    ['Resultado', (c) => (c.meta.parcial ? 'gravando' : (c.meta.resultado ?? '—'))],
    ['Duração', (c) => formatHMS(c.meta.duracao_s)],
    ['F0 final', (c) => fmtGrandeza(c.resumo.f0_min, 'f0')],
    ['Condensado carga', (c) => fmtValor(c.resumo.cond_carga_g, 'g')],
    ['Condensado parede', (c) => fmtValor(c.resumo.cond_parede_g, 'g')],
    ['Condensado total', (c) => fmtValor(c.resumo.cond_total_g, 'g')],
    ['Evaporado total', (c) => (c.resumo.evap_total_g === undefined ? '—' : fmtValor(c.resumo.evap_total_g, 'g'))],
    ['Água na carga no fim', (c) => (c.resumo.agua_carga_fim_g === undefined ? '—' : fmtValor(c.resumo.agua_carga_fim_g, 'g'))],
    ['Vapor câmara', (c) => (c.resumo.vapor_camara_kg === undefined ? '—' : fmtValor(c.resumo.vapor_camara_kg, 'kg'))],
    ['Vapor camisa', (c) => (c.resumo.vapor_camisa_kg === undefined ? '—' : fmtValor(c.resumo.vapor_camisa_kg, 'kg'))],
    ['Vapor total', (c) => (c.resumo.vapor_total_kg === undefined ? '—' : fmtValor(c.resumo.vapor_total_kg, 'kg'))],
    ['Energia do vapor', (c) => (c.resumo.energia_kwh === undefined ? '—' : fmtValor(c.resumo.energia_kwh, 'kWh'))],
    ['T máx carga', (c) => fmtValor(c.resumo.t_carga_max_C, '°C')],
    ['P máx câmara', (c) => fmtValor(c.resumo.p_camara_max_bar, 'bar')],
  ];
  const fases = [...new Set(selCiclos.flatMap((c) => Object.keys(c.resumo.tempos_fase_s)))];

  const th = 'text-left px-2 py-1 font-semibold text-slate-400';
  const td = 'px-2 py-1';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Análise de ciclos</h1>
      {erro && <p className="text-red-400 text-sm">Erro ao carregar ciclos: {erro}</p>}

      <Card title="Ciclos gravados">
        <div className="flex gap-2 items-center text-sm mb-2">
          <label htmlFor="filtro">Resultado:</label>
          <select id="filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="bg-slate-900 border border-slate-600 rounded px-1">
            <option value="">todos</option>
            <option value="gravando">gravando</option>
            {RESULTADOS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className="text-slate-500">{filtrada.length} ciclo(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={th}>Data/hora</th>
                <th className={th}>Nome</th>
                <th className={th}>Receita</th>
                <th className={th}>Resultado</th>
                <th className={th}>Duração</th>
                <th className={th}>F0</th>
                <th className={th}>Condensado</th>
                <th className={th}>Anotação</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((c) => {
                const i = sel.indexOf(c.meta.id);
                return (
                  <tr key={c.meta.id} className="border-t border-slate-700">
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${rotulo(c)}`}
                        checked={i >= 0}
                        onChange={(e) => setSel((s) => (e.target.checked ? [...s, c.meta.id] : s.filter((x) => x !== c.meta.id)))}
                      />
                      {i >= 0 && <span className="inline-block w-3 h-3 ml-1 rounded-full align-middle" style={{ background: CORES[i % CORES.length] }} />}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{dataHora(c)}</td>
                    <td className={td}>
                      <Editavel valor={c.meta.nome} ph="(sem nome)" onSalvar={(nome) => void patch(c.meta.id, { nome })} />
                    </td>
                    <td className={td}>{receita(c)}</td>
                    <td className={td}>{badge(c)}</td>
                    <td className={td}>{formatHMS(c.meta.duracao_s)}</td>
                    <td className={td}>{fmtGrandeza(c.resumo.f0_min, 'f0')}</td>
                    <td className={td}>{fmtValor(c.resumo.cond_total_g, 'g')}</td>
                    <td className={`${td} min-w-40`}>
                      <Editavel valor={c.meta.anotacao} ph="(anotação)" onSalvar={(anotacao) => void patch(c.meta.id, { anotacao })} />
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      <a href={`/api/ciclos/${c.meta.id}/csv`} className="text-sky-400 hover:underline mr-3">
                        CSV
                      </a>
                      <a href={`/analise/relatorio/${c.meta.id}`} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline mr-3">
                        Relatório PDF
                      </a>
                      <button onClick={() => void apagar(c)} className="text-red-400 hover:underline">
                        Apagar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtrada.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-slate-500 py-2">
                    Nenhum ciclo gravado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Gráfico">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
          {GRANDEZAS.map((g) => (
            <label key={g.k} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={gs.includes(g.k)}
                onChange={(e) => setGs((s) => (e.target.checked ? [...s, g.k] : s.filter((x) => x !== g.k)))}
              />
              {g.rot}
            </label>
          ))}
          <label className="flex items-center gap-1 text-slate-300">
            <input type="checkbox" checked={comFases} onChange={(e) => setComFases(e.target.checked)} />
            Faixas de fase (1º ciclo)
          </label>
        </div>
        {fora.length > 0 && (
          <p className="text-yellow-400 text-xs mb-2">
            No máximo 2 eixos: {fora.map((e) => UNIDADE[e]).join(', ')} não mostrado(s). Desmarque um tipo de grandeza.
          </p>
        )}
        {passo > 1 && <p className="text-slate-500 text-xs mb-2">Mostrando 1 a cada {passo} pontos.</p>}
        {selCiclos.length === 0 ? (
          <p className="text-slate-500 text-sm">Selecione ciclos na lista.</p>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dados}>
                {faixas.map((f, i) => (
                  <ReferenceArea
                    key={i}
                    yAxisId={esq ?? dir}
                    x1={f.x1}
                    x2={f.x2}
                    fill={coresFase.get(f.fase)}
                    fillOpacity={0.5}
                    ifOverflow="hidden"
                    label={{ value: f.fase, position: 'insideTopLeft', fontSize: 9, fill: '#94a3b8' }}
                  />
                ))}
                <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} stroke="#94a3b8" tick={{ fontSize: 10 }} unit=" min" tickFormatter={(v: number) => v.toFixed(0)} />
                {esq && <YAxis yAxisId={esq} stroke="#94a3b8" tick={{ fontSize: 10 }} unit={` ${UNIDADE[esq]}`} width={70} />}
                {dir && <YAxis yAxisId={dir} orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} unit={` ${UNIDADE[dir]}`} width={70} />}
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #475569' }}
                  labelFormatter={(v) => `t = ${formatHMS(Number(v) * 60)}`}
                  formatter={(v, _n, item) => fmtGrandeza(Number(v), grandeza(String(item.dataKey).split(':')[1]!).eixo)}
                />
                <Legend />
                {selCiclos.flatMap((c, i) =>
                  visiveis.map((k, j) => (
                    <Line
                      key={`${i}:${k}`}
                      yAxisId={grandeza(k).eixo}
                      name={`${rotulo(c)} — ${grandeza(k).rot}`}
                      dataKey={`${i}:${k}`}
                      stroke={CORES[i % CORES.length]}
                      strokeDasharray={TRACOS[j % TRACOS.length]}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )),
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {selCiclos.length > 0 && (
        <>
          <Card title="Resumo">
            <div className="overflow-x-auto">
              <table className="text-sm tabular-nums">
                <thead>
                  <tr>
                    <th className={th}></th>
                    {selCiclos.map((c, i) => (
                      <th key={c.meta.id} className={th} style={{ color: CORES[i % CORES.length] }}>
                        {rotulo(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resumo.map(([n, f]) => (
                    <tr key={n} className="border-t border-slate-700">
                      <td className={`${td} text-slate-400`}>{n}</td>
                      {selCiclos.map((c) => (
                        <td key={c.meta.id} className={td}>
                          {f(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {fases.map((f) => (
                    <tr key={f} className="border-t border-slate-700">
                      <td className={`${td} text-slate-400`}>Tempo em {f}</td>
                      {selCiclos.map((c) => (
                        <td key={c.meta.id} className={td}>
                          {c.resumo.tempos_fase_s[f] !== undefined ? formatHMS(c.resumo.tempos_fase_s[f]!) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Parâmetros">
            <label className="flex items-center gap-1 text-sm mb-2">
              <input type="checkbox" checked={soDifere} onChange={(e) => setSoDifere(e.target.checked)} />
              Só o que difere
            </label>
            <div className="overflow-x-auto">
              <table className="text-sm tabular-nums">
                <thead>
                  <tr>
                    <th className={th}>Parâmetro</th>
                    {selCiclos.map((c, i) => (
                      <th key={c.meta.id} className={th} style={{ color: CORES[i % CORES.length] }}>
                        {rotulo(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhasParam.map((l) => (
                    <tr key={l.k} className={`border-t border-slate-700 ${l.difere ? 'bg-yellow-500/15 text-yellow-100' : ''}`}>
                      <td className={`${td} text-slate-400`}>{nomeParam(l.k)}</td>
                      {l.valores.map((v, i) => (
                        <td key={i} className={td}>
                          {num(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
