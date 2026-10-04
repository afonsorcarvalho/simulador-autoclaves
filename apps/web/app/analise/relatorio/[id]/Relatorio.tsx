'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceArea, Legend, CartesianGrid } from 'recharts';
import { fmtValor, formatHMS } from '../../../../lib/format';
import { achatar } from '../../../../lib/analise';
import { montarRelatorio, nomeArquivo, faixasRotuladas, formatarValorKnob } from '../../../../lib/relatorio';
import type { Ciclo } from '../../../../server/ciclos/store';

const W = 700;
const CORES = ['#2563eb', '#ea580c', '#16a34a', '#db2777', '#9333ea'];
const FAIXAS = ['#f1f5f9', '#e0f2fe', '#fef3c7', '#dcfce7', '#fce7f3', '#ede9fe'];
const dec = (v: number, d: number) => v.toFixed(d).replace('.', ',');
const hora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR') : '—');

type Serie = { k: string; rot: string; dir?: boolean };
type Dados = ReturnType<typeof montarRelatorio>;

function Faixas({ r, eixo }: { r: Dados; eixo?: string }) {
  const tTotal = r.dados.at(-1)?.t ?? 0;
  const faixas = faixasRotuladas(r.faixas, tTotal);
  return (
    <>
      {faixas.map((f, i) => (
        <ReferenceArea
          key={i}
          x1={f.x1}
          x2={f.x2}
          {...(eixo && f.rotulo && { yAxisId: eixo, label: { value: f.rotulo, position: 'insideTop' as const, fontSize: 8, fill: '#475569' } })}
          fill={FAIXAS[i % FAIXAS.length]!}
          fillOpacity={0.8}
        />
      ))}
    </>
  );
}

function Grafico(p: {
  titulo: string; r: Dados; series: Serie[]; fmt: (v: number) => string; fmtDir?: (v: number) => string;
  /** Escala fixa do eixo esquerdo (padrão: automática). */
  dominio?: [number, number];
}) {
  const { titulo, r, series, fmt, fmtDir, dominio } = p;
  return (
    <section className="graf">
      <h3>{titulo}</h3>
      <LineChart width={W} height={230} data={r.dados} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#e5e7eb" />
        {Faixas({ r, eixo: 'e' })}
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => dec(v, 0)} fontSize={10}
          label={{ value: 'min', position: 'insideBottomRight', offset: -2, fontSize: 10 }} />
        <YAxis yAxisId="e" fontSize={10} width={64} tickFormatter={fmt} domain={dominio ?? ['auto', 'auto']} allowDataOverflow={!!dominio} />
        {fmtDir && <YAxis yAxisId="d" orientation="right" fontSize={10} width={64} tickFormatter={fmtDir} />}
        <Tooltip
          labelFormatter={(v: number) => `${dec(v, 2)} min`}
          formatter={(v: number, _n, item) => (series.find((s) => s.k === item.dataKey)?.dir && fmtDir ? fmtDir : fmt)(v)}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {series.map((s, i) => (
          <Line key={s.k} yAxisId={s.dir ? 'd' : 'e'} dataKey={s.k} name={s.rot} stroke={CORES[i % CORES.length]} dot={false}
            strokeWidth={1.3} isAnimationActive={false} strokeDasharray={s.dir ? '4 2' : undefined} />
        ))}
      </LineChart>
    </section>
  );
}

/** Linhas digitais empilhadas: saída i ocupa a faixa [i, i+1), alta = i+0,75, baixa = i+0,15. */
function Saidas({ r, todas }: { r: Dados; todas: boolean }) {
  const sel = useMemo(() => r.saidas.filter((s) => todas || s.mudou).reverse(), [r, todas]); // 1ª saída no topo
  const dados = useMemo(
    () => r.dados.map((d) => Object.fromEntries([['t', d.t], ...sel.map((s, i) => [s.chave, i + 0.15 + 0.6 * (d[s.chave] ?? 0)])])),
    [r, sel],
  );
  if (!sel.length) return <p className="nota">Nenhuma saída mudou de estado neste ciclo.</p>;
  return (
    <LineChart width={W} height={40 + sel.length * 20} data={dados} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
      {Faixas({ r })}
      <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => dec(v, 0)} fontSize={10} />
      <YAxis type="number" domain={[0, sel.length]} ticks={sel.map((_, i) => i + 0.45)} interval={0} width={170} fontSize={9}
        tickFormatter={(v: number) => sel[Math.floor(v)]?.rot ?? ''} />
      {sel.map((s, i) => (
        <Line key={s.chave} dataKey={s.chave} type="stepAfter" stroke={CORES[i % CORES.length]} dot={false} strokeWidth={1.3} isAnimationActive={false} />
      ))}
    </LineChart>
  );
}

const Linha = ({ k, v }: { k: string; v: ReactNode }) => (
  <tr>
    <th>{k}</th>
    <td>{v}</td>
  </tr>
);

const CSS = `
@page { size: A4 portrait; margin: 14mm 12mm 16mm;
  @bottom-right { content: "Página " counter(page) " / " counter(pages); font-size: 9pt; color: #555; } }
.rel { background: #fff; color: #111; max-width: 760px; margin: 0 auto; padding: 24px; font-size: 12px; }
.rel h1 { font-size: 20px; font-weight: 700; }
.rel h2 { font-size: 15px; font-weight: 700; margin: 18px 0 6px; border-bottom: 1px solid #999; }
.rel h3 { font-size: 12px; font-weight: 600; margin: 8px 0 2px; }
.rel table { border-collapse: collapse; width: 100%; }
.rel th, .rel td { border: 1px solid #ccc; padding: 2px 6px; text-align: left; }
.rel th { background: #f3f4f6; font-weight: 600; width: 40%; }
.rel .graf, .rel .bloco, .rel tr { break-inside: avoid; }
.rel .quebra { break-before: page; }
.rel .nota { color: #555; font-style: italic; }
.rel .rod { margin-top: 16px; color: #555; font-size: 10px; }
.rel button { background: #2563eb; color: #fff; padding: 4px 12px; border-radius: 4px; }
@media print {
  html, body { background: #fff !important; color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav, .noprint { display: none !important; }
  main { padding: 0 !important; }
  .rel { padding: 0; max-width: none; }
}`;

type KnobLabel = { id: string; label: string; unit: string; decimals?: number | undefined; optionLabels?: string[] | undefined };

export default function Relatorio(p: { c: Ciclo; knobs: KnobLabel[]; versaoSim: string }) {
  const { c, knobs, versaoSim } = p;
  const [todas, setTodas] = useState(false);
  // recharts gera ids de clip por contador global: no SSR divergem do cliente (hydration). Gráficos só após montar.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const r = useMemo(() => montarRelatorio(c), [c]);
  const receita = c.meta.modo === 'clp' ? 'receita do CLP' : (c.parametros.ciclo?.name ?? '—');
  const nome = c.meta.nome || receita;
  const { commitClp, versaoIhm } = c.parametros.versoes;
  const g = (v: number | undefined) => (v === undefined ? '—' : fmtValor(v, 'g'));
  const kg = (v: number | undefined) => (v === undefined ? '—' : fmtValor(v, 'kg'));
  const temVapor = c.serie.some((p) => p.vapor_total_kg !== undefined);
  const meta = new Map(knobs.map((k) => [k.id, k]));
  const receitaPlana = Object.entries(achatar(c.parametros.ciclo ?? {}));
  const num = (v: unknown) => String(v).replace('.', ',');

  function exportar() {
    const antigo = document.title;
    document.title = nomeArquivo(nome, new Date(c.meta.inicio), commitClp, versaoIhm);
    window.print();
    document.title = antigo;
  }

  return (
    <div className="rel">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="noprint" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={exportar}>Exportar PDF</button>
        <label>
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> mostrar todas as saídas
        </label>
      </div>

      <h1>Relatório de ciclo</h1>
      <p style={{ fontSize: 15, fontWeight: 600 }}>{nome}</p>
      <table className="bloco" style={{ marginTop: 8 }}>
        <tbody>
          <Linha k="Receita / ciclo" v={receita} />
          <Linha k="Início" v={hora(c.meta.inicio)} />
          <Linha k="Fim" v={hora(c.meta.fim)} />
          <Linha k="Duração" v={formatHMS(c.meta.duracao_s)} />
          <Linha k="Resultado" v={`${c.meta.parcial ? 'gravando (parcial)' : (c.meta.resultado ?? '—')}${c.meta.motivo ? ` — ${c.meta.motivo}` : ''}`} />
          <Linha k="Modo" v={c.meta.modo === 'clp' ? 'CLP real' : 'virtual'} />
          <Linha k="Versão CLP / IHM" v={`${commitClp ?? '—'} / ${versaoIhm ?? '—'}`} />
          <Linha k="Versão do simulador" v={versaoSim} />
          {c.meta.anotacao && <Linha k="Anotação" v={c.meta.anotacao} />}
        </tbody>
      </table>

      <h2>Resumo</h2>
      <table className="bloco">
        <tbody>
          <Linha k="F0 final" v={`${dec(c.resumo.f0_min, 1)} min`} />
          <Linha k="T máx. carga" v={fmtValor(c.resumo.t_carga_max_C, '°C')} />
          <Linha k="P máx. câmara" v={`${fmtValor(c.resumo.p_camara_max_bar, 'bar')} abs`} />
          <Linha k="Condensado total" v={g(c.resumo.cond_total_g)} />
          <Linha k="Evaporado total" v={g(c.resumo.evap_total_g)} />
          <Linha k="Água na carga no fim" v={g(c.resumo.agua_carga_fim_g)} />
          <Linha k="Vapor câmara / camisa / total" v={[c.resumo.vapor_camara_kg, c.resumo.vapor_camisa_kg, c.resumo.vapor_total_kg].map((v) => kg(v)).join(' / ')} />
          <Linha k="Energia do vapor (ref. água 25 °C)" v={c.resumo.energia_kwh === undefined ? '—' : fmtValor(c.resumo.energia_kwh, 'kWh')} />
        </tbody>
      </table>
      <h3>Tempos por fase</h3>
      <table className="bloco">
        <tbody>
          {Object.entries(c.resumo.tempos_fase_s).map(([f, s]) => (
            <Linha key={f} k={f} v={formatHMS(s)} />
          ))}
        </tbody>
      </table>

      <h2 className="quebra">Gráficos</h2>
      {montado && (
        <>
      <Grafico titulo="Pressões (bar abs)" r={r} dominio={[0, 5]} fmt={(v) => fmtValor(v, 'bar')}
        series={[{ k: 'p_camara_bar', rot: 'Câmara' }, { k: 'p_camisa_bar', rot: 'Camisa' }, { k: 'p_gerador_bar', rot: 'Gerador' }]} />
      <Grafico titulo="Temperaturas (°C)" r={r} dominio={[0, 150]} fmt={(v) => fmtValor(v, '°C')}
        series={[
          { k: 't_camara_C', rot: 'Câmara' },
          { k: 't_dreno_C', rot: 'Dreno' },
          { k: 't_carga_C', rot: 'Carga / testemunho' },
          { k: 't_camisa_C', rot: 'Camisa' },
          { k: 't_gerador_C', rot: 'Gerador' },
        ]} />
      <Grafico titulo="F0 (min)" r={r} fmt={(v) => dec(v, 1)} series={[{ k: 'f0_min', rot: 'F0' }]} />
      <Grafico titulo="Condensado e umidade" r={r} fmt={(v) => fmtValor(v, 'g')} fmtDir={(v) => fmtValor(v, 'g/min')}
        series={[
          { k: 'agua_carga_g', rot: 'Água na carga' },
          { k: 'agua_camara_g', rot: 'Água no fundo' },
          { k: 'cond_acum_g', rot: 'Condensado acum.' },
          { k: 'evap_acum_g', rot: 'Evaporado acum.' },
          { k: 'vazao_g_min', rot: 'Vazão cond−evap (g/min)', dir: true },
        ]} />
      {temVapor && (
        <Grafico titulo="Consumo de vapor" r={r} fmt={kg} fmtDir={(v) => fmtValor(v, 'kg/h')}
          series={[
            { k: 'vapor_camara_kg', rot: 'Câmara acum. (kg)' },
            { k: 'vapor_camisa_kg', rot: 'Camisa acum. (kg)' },
            { k: 'vapor_vazao_kg_h', rot: 'Vazão total (kg/h)', dir: true },
          ]} />
      )}
      <section className="graf">
        <h3>Válvulas e atuadores</h3>
        {r.saidas.length ? <Saidas r={r} todas={todas} /> : <p className="nota">Ciclo gravado sem o estado das saídas.</p>}
      </section>
        </>
      )}

      <h2 className="quebra">Anexo — parâmetros</h2>
      {receitaPlana.length > 0 && (
        <>
          <h3>Receita</h3>
          <table>
            <tbody>
              {receitaPlana.map(([k, v]) => (
                <Linha key={k} k={k} v={num(v)} />
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>Knobs</h3>
      <table>
        <tbody>
          {Object.entries(c.parametros.knobs).map(([k, v]) => {
            const km = meta.get(k);
            const valor = formatarValorKnob(v, km);
            return <Linha key={k} k={km?.label ?? k} v={km?.optionLabels ? valor : `${valor} ${km?.unit ?? ''}`} />;
          })}
        </tbody>
      </table>
      <p className="rod" suppressHydrationWarning>
        Emitido em {new Date().toLocaleString('pt-BR')} — Simulador de Autoclaves {versaoSim}
      </p>
    </div>
  );
}
