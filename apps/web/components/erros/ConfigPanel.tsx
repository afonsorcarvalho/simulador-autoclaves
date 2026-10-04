'use client';

import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface Cfg {
  plcIp: string;
  ihmIp: string;
  vncPort: number | null;
  vncSenhaDefinida: boolean;
  pacoteDir: string;
  commitClp: string;
  versaoIhm: string;
}

const input = 'w-full rounded bg-slate-900 border border-slate-600 px-2 py-1 text-sm';
const botao = 'rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-sm disabled:opacity-50';

export function ConfigPanel({ onSalvo }: { onSalvo: () => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ clp: string; ihm: string; detalhe?: { clp?: string; ihm?: string } } | null>(null);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    fetch('/api/erros/config').then((r) => r.json()).then(setCfg).catch(() => setMsg('Falha ao carregar a configuração'));
  }, []);

  if (!cfg) return <Card title="Configuração">Carregando…</Card>;

  async function salvar() {
    const res = await fetch('/api/erros/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cfg, vncSenha: senha }),
    });
    const body = await res.json();
    if (!res.ok) return setMsg(body.error ?? 'Erro ao salvar');
    setCfg(body);
    setSenha('');
    setMsg('Configuração salva');
    onSalvo();
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await (await fetch('/api/erros/testar', { method: 'POST' })).json());
    } finally {
      setTestando(false);
    }
  }

  const campo = (rotulo: string, el: React.ReactNode) => (
    <label className="block text-sm">
      <span className="text-slate-400">{rotulo}</span>
      {el}
    </label>
  );

  return (
    <Card title="Configuração">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {campo('IP do CLP', <input className={input} value={cfg.plcIp} onChange={(e) => setCfg({ ...cfg, plcIp: e.target.value })} />)}
        {campo('IP da IHM', <input className={input} value={cfg.ihmIp} onChange={(e) => setCfg({ ...cfg, ihmIp: e.target.value })} />)}
        {campo(
          'Porta VNC',
          <input
            className={input}
            type="number"
            value={cfg.vncPort ?? ''}
            placeholder="5900"
            onChange={(e) => setCfg({ ...cfg, vncPort: e.target.value === '' ? null : Number(e.target.value) })}
          />,
        )}
        {campo(
          `Senha VNC${cfg.vncSenhaDefinida ? ' (definida)' : ''}`,
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            value={senha}
            placeholder={cfg.vncSenhaDefinida ? 'manter a atual' : ''}
            onChange={(e) => setSenha(e.target.value)}
          />,
        )}
        {campo('Pasta do pacote', <input className={input} value={cfg.pacoteDir} onChange={(e) => setCfg({ ...cfg, pacoteDir: e.target.value })} />)}
        {campo('Versão do programa do CLP (laudo)', <input className={input} value={cfg.commitClp} onChange={(e) => setCfg({ ...cfg, commitClp: e.target.value })} />)}
        {campo('Versão da IHM (laudo)', <input className={input} value={cfg.versaoIhm} onChange={(e) => setCfg({ ...cfg, versaoIhm: e.target.value })} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <button className={botao} onClick={salvar}>Salvar</button>
        <button className={botao} onClick={testar} disabled={testando}>
          {testando ? 'Testando…' : 'Testar conexão'}
        </button>
        {teste && (
          <>
            <span title={teste.detalhe?.clp}><Badge variant={teste.clp === 'ok' ? 'ok' : 'err'}>CLP: {teste.clp}</Badge></span>
            <span title={teste.detalhe?.ihm}><Badge variant={teste.ihm === 'ok' ? 'ok' : 'err'}>IHM: {teste.ihm}</Badge></span>
            <span className="text-xs text-slate-400">
              {[teste.detalhe?.clp && `CLP: ${teste.detalhe.clp}`, teste.detalhe?.ihm && `IHM: ${teste.detalhe.ihm}`].filter(Boolean).join(' · ')}
            </span>
          </>
        )}
        {msg && <span className="text-sm text-slate-300">{msg}</span>}
      </div>
    </Card>
  );
}
