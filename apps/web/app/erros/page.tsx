'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigPanel } from '../../components/erros/ConfigPanel';
import { ScenarioList, type CenarioResumo } from '../../components/erros/ScenarioList';
import { RunProgress, type Progresso } from '../../components/erros/RunProgress';
import { ResultCard, urlArquivo, type ResultadoCenario, type Veredito } from '../../components/erros/ResultCard';
import { Card } from '../../components/ui/Card';

const post = async (url: string, body?: unknown) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
};

/** Traduz o 409 de modo virtual pra algo que o operador entenda. */
const amigavel = (msg: string) =>
  msg.includes('modo virtual')
    ? 'Sem CLP real conectado: o simulador está em modo virtual. Suba o servidor com o bridge do CLP para rodar cenários.'
    : msg;

export default function ErrosPage() {
  const [cenarios, setCenarios] = useState<CenarioResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoCenario[]>([]);
  const [exec, setExec] = useState<string | null>(null);
  const [prog, setProg] = useState<Progresso>({ estado: 'OCIOSO', instrucao: null, atual: null, passo: null, decorrido_s: 0, falhas: [] });
  const inicio = useRef<number | null>(null);
  const [laudo, setLaudo] = useState<{ gerando: boolean; arquivos: string[]; erro: string | null }>({ gerando: false, arquivos: [], erro: null });
  const [acum, setAcum] = useState<{ gerando: boolean; arquivos: string[]; erro: string | null }>({ gerando: false, arquivos: [], erro: null });

  const carregarCenarios = useCallback(async () => {
    const res = await fetch('/api/erros/cenarios');
    const body = await res.json();
    if (!res.ok) {
      setCenarios([]);
      setErro(body.error ?? `HTTP ${res.status}`);
    } else {
      setCenarios(body.cenarios);
      setErro(null);
    }
  }, []);

  useEffect(() => {
    void carregarCenarios();
    const es = new EventSource('/api/erros/stream');
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data);
      if (e.tipo === 'status') {
        setResultados(e.resultadoParcial);
        setExec(e.exec);
        setProg((p) => ({ ...p, estado: e.estado, instrucao: e.instrucao, setupPendenteRestaurado: e.setupPendenteRestaurado }));
      } else if (e.tipo === 'inicio_cenario') {
        setProg((p) => ({ ...p, estado: 'RODANDO', atual: `${e.id} — ${e.titulo}`, passo: null }));
      } else if (e.tipo === 'passo') {
        setProg((p) => ({ ...p, passo: e.descricao }));
      } else if (e.tipo === 'aguardando_operador') {
        setProg((p) => ({ ...p, estado: 'AGUARDANDO_OPERADOR', instrucao: e.instrucao }));
      } else if (e.tipo === 'resultado') {
        setResultados((r) => [...r, e.resultado]);
        setProg((p) => (p.estado === 'AGUARDANDO_OPERADOR' ? { ...p, estado: 'RODANDO' } : p));
      } else if (e.tipo === 'fim') {
        setProg((p) => ({ ...p, estado: 'OCIOSO', atual: null, passo: null, instrucao: null }));
        inicio.current = null;
      }
    };
    return () => es.close();
  }, [carregarCenarios]);

  // Relógio + falhas ativas: só enquanto há execução.
  // ponytail: polling de /api/faults a 1 Hz; trocar por SSE se virar gargalo.
  const ativo = prog.estado !== 'OCIOSO';
  useEffect(() => {
    if (!ativo) return;
    inicio.current ??= Date.now();
    const t = setInterval(async () => {
      const faults = await fetch('/api/faults').then((r) => r.json()).then((b) => b.faults).catch(() => []);
      setProg((p) => ({ ...p, decorrido_s: (Date.now() - (inicio.current ?? Date.now())) / 1000, falhas: faults }));
    }, 1000);
    return () => clearInterval(t);
  }, [ativo]);

  async function rodar(ids?: string[]) {
    setErro(null);
    try {
      await post('/api/erros/run', ids ? { ids } : {});
      inicio.current = Date.now();
      setLaudo({ gerando: false, arquivos: [], erro: null });
      const st = await (await fetch('/api/erros/status')).json();
      setExec(st.exec);
      setResultados(st.resultadoParcial);
      setProg((p) => ({ ...p, estado: st.estado, decorrido_s: 0 }));
    } catch (err) {
      setErro(amigavel((err as Error).message));
    }
  }

  async function gerarLaudo() {
    if (!exec) return;
    setLaudo({ gerando: true, arquivos: [], erro: null });
    try {
      const r = await post('/api/erros/laudo', { exec });
      setLaudo({ gerando: false, arquivos: r.arquivos, erro: null });
    } catch (err) {
      setLaudo({ gerando: false, arquivos: [], erro: (err as Error).message });
    }
  }

  async function gerarAcumulado() {
    setAcum({ gerando: true, arquivos: [], erro: null });
    try {
      const r = await post('/api/erros/laudo-acumulado');
      setAcum({ gerando: false, arquivos: r.arquivos, erro: null });
    } catch (err) {
      setAcum({ gerando: false, arquivos: [], erro: (err as Error).message });
    }
  }

  const vereditos = Object.fromEntries(resultados.map((r) => [r.id, r.veredito])) as Record<string, Veredito>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Simulador de erros</h1>
      <ConfigPanel onSalvo={carregarCenarios} />
      <ScenarioList
        cenarios={cenarios}
        erro={erro}
        vereditos={vereditos}
        rodando={ativo}
        onRodar={rodar}
        onParar={() => void post('/api/erros/stop').catch(() => {})}
      />
      <RunProgress p={prog} onContinuar={() => void post('/api/erros/continuar').catch(() => {})} />
      {resultados.length > 0 && (
        <Card title={`Resultados${exec ? ` — ${exec}` : ''}`}>
          <div className="space-y-2">
            {resultados.map((r) => <ResultCard key={r.id} r={r} exec={exec} rodando={ativo} onRefazer={(id) => void rodar([id])} />)}
          </div>
          {!ativo && exec && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="rounded bg-blue-700 hover:bg-blue-600 px-3 py-1 text-sm disabled:opacity-50" disabled={laudo.gerando} onClick={gerarLaudo}>
                {laudo.gerando ? 'Gerando laudo…' : 'Gerar laudo'}
              </button>
              {laudo.arquivos.map((a) => (
                <a key={a} className="text-sm text-blue-400 underline" href={urlArquivo(exec, a)} download>{a}</a>
              ))}
              {laudo.erro && <span className="text-sm text-red-300">{laudo.erro}</span>}
            </div>
          )}
        </Card>
      )}
      {!ativo && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded bg-blue-900 hover:bg-blue-800 px-3 py-1 text-sm disabled:opacity-50"
            disabled={acum.gerando}
            onClick={gerarAcumulado}
            title="Junta as execuções da versão atual do programa: vale o resultado mais recente de cada cenário"
          >
            {acum.gerando ? 'Gerando laudo acumulado…' : 'Laudo acumulado'}
          </button>
          {acum.arquivos.map((a) => (
            <a key={a} className="text-sm text-blue-400 underline" href={urlArquivo('_acumulado', a)} download>{a}</a>
          ))}
          {acum.erro && <span className="text-sm text-red-300">{acum.erro}</span>}
        </div>
      )}
    </div>
  );
}
