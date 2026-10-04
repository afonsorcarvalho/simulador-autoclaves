import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetRuntime, getRuntime } from '../../server/runtime/singleton.js';
import { resetErrosService, getErrosService } from '../../server/erros/service.js';
import { GET as configGET, POST as configPOST } from '../../app/api/erros/config/route.js';
import { GET as cenariosGET } from '../../app/api/erros/cenarios/route.js';
import { POST as runPOST } from '../../app/api/erros/run/route.js';
import { Executor, type PlcIo } from '../../server/erros/executor.js';
import { POST as laudoPOST } from '../../app/api/erros/laudo/route.js';

/** CLP falso mínimo que satisfaz PlcIo (duck typing) pra destravar o modo "CLP real". */
class FakeIo implements PlcIo {
  async readPlc(_area: 'M' | 'D', _addr: number, n: number) {
    return new Array<number>(n).fill(0);
  }
  async writePlc() {
    /* no-op */
  }
  setFaults() {
    /* no-op */
  }
}

function req(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { headers });
}

function criarPacote(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-erros-pacote-'));
  mkdirSync(join(dir, 'cenarios'));
  writeFileSync(
    join(dir, 'cenarios', 'S1.json'),
    JSON.stringify({
      id: 'S1',
      titulo: 'cenário de teste',
      origem: 'teste',
      automacao: 'auto',
      esperado: [{ descricao: 'D0 é zero', ler: 'D0', igual: 0, prazo_s: 1 }],
    }),
  );
  return dir;
}

/** Liga um CLP falso (satisfaz PlcIo) e configura o pacote num diretório temporário.
 *  Devolve o caminho de config injetável (usado em vez do erros.local.json real). */
function montarAmbiente(pacoteDir: string | null): string {
  const rt = getRuntime();
  (rt as unknown as { bridge: PlcIo }).bridge = new FakeIo();
  const configPath = join(tmpdir(), `sim-erros-config-${Math.random().toString(36).slice(2)}.json`);
  const service = getErrosService(configPath);
  if (pacoteDir) service.setConfig({ pacoteDir });
  return configPath;
}

const pacotesCriados: string[] = [];

describe('/api/erros', () => {
  beforeEach(() => {
    resetRuntime();
    resetErrosService();
  });

  afterEach(() => {
    for (const dir of pacotesCriados.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('config GET não contém a senha de VNC', async () => {
    montarAmbiente(null);
    const res = await configGET(get('/api/erros/config'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('vncSenha');
    expect(body).toHaveProperty('vncSenhaDefinida', false);
  });

  it('config POST com senha vazia mantém a anterior', async () => {
    montarAmbiente(null);
    await configPOST(req('/api/erros/config', { vncSenha: 'segredo' }));
    const res = await configPOST(req('/api/erros/config', { vncSenha: '', plcIp: '192.0.2.5' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.plcIp).toBe('192.0.2.5');
    expect(body.vncSenhaDefinida).toBe(true);
  });

  it('host de LAN → 403 (rotas só aceitam localhost)', async () => {
    montarAmbiente(null);
    expect((await configGET(get('/api/erros/config', { host: '192.168.0.50:3030' }))).status).toBe(403);
    const r = new Request('http://localhost/api/erros/run', { method: 'POST', headers: { host: '192.168.0.50:3030' } });
    expect((await runPOST(r)).status).toBe(403);
    // host local mas origin de outra máquina (CSRF) também é recusado
    const csrf = new Request('http://localhost/api/erros/run', {
      method: 'POST',
      headers: { host: 'localhost:3030', origin: 'http://192.168.0.50:3030' },
    });
    expect((await runPOST(csrf)).status).toBe(403);
    expect((await configGET(get('/api/erros/config', { host: '127.0.0.1:3030', origin: 'http://[::1]:3030' }))).status).toBe(200);
  });

  it('config POST: pacoteDir de rede (UNC) ou relativo → 400', async () => {
    montarAmbiente(null);
    for (const pacoteDir of ['\\\\srv\\pacote', '//srv/pacote', 'pacote/relativo']) {
      const res = await configPOST(req('/api/erros/config', { pacoteDir }));
      expect(res.status).toBe(400);
    }
  });

  it('cenarios GET sem pacote configurado → 409', async () => {
    montarAmbiente(null);
    const res = await cenariosGET(get('/api/erros/cenarios'));
    expect(res.status).toBe(409);
  });

  it('cenarios GET lista id/titulo/origem/automacao do pacote', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    montarAmbiente(dir);
    const res = await cenariosGET(get('/api/erros/cenarios'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cenarios: unknown[] };
    expect(body.cenarios).toEqual([
      { id: 'S1', titulo: 'cenário de teste', origem: 'teste', automacao: 'auto' },
    ]);
  });

  it('run sem pacote configurado → 409', async () => {
    montarAmbiente(null);
    const res = await runPOST(req('/api/erros/run'));
    expect(res.status).toBe(409);
  });

  it('run sem bridge com readPlc (modo virtual) → 409', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    // resetRuntime() já deixa o bridge virtual (sem readPlc); não chama montarAmbiente,
    // que trocaria por um FakeIo.
    resetRuntime();
    resetErrosService();
    const configPath = join(tmpdir(), `sim-erros-config-${Math.random().toString(36).slice(2)}.json`);
    getErrosService(configPath).setConfig({ pacoteDir: dir });
    const res = await runPOST(req('/api/erros/run'));
    expect(res.status).toBe(409);
  });

  it('run com ids inexistentes → 400', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    montarAmbiente(dir);
    const res = await runPOST(req('/api/erros/run', { ids: ['NAO_EXISTE'] }));
    expect(res.status).toBe(400);
  });

  it('run com executor já rodando → 409', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    montarAmbiente(dir);
    const primeira = await runPOST(req('/api/erros/run'));
    expect(primeira.status).toBe(200);
    const segunda = await runPOST(req('/api/erros/run'));
    expect(segunda.status).toBe(409);
  });

  async function esperarOcioso(): Promise<void> {
    for (let i = 0; i < 200 && getErrosService().status().estado !== 'OCIOSO'; i++) await new Promise((r) => setTimeout(r, 5));
  }

  it('resultado.json traz programa (da config) e setup_inicial', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    montarAmbiente(dir);
    getErrosService().setConfig({ commitClp: 'abc123', versaoIhm: 'v9' });
    vi.spyOn(Executor.prototype, 'executar').mockResolvedValueOnce([]);
    expect((await runPOST(req('/api/erros/run'))).status).toBe(200);
    await esperarOcioso();
    const exec = getErrosService().status().exec!;
    const r = JSON.parse(readFileSync(join(dir, 'execucoes', exec, 'resultado.json'), 'utf8'));
    expect(r.programa).toEqual({ commit_clp: 'abc123', versao_ihm: 'v9' });
    expect(r.setup_inicial).toEqual({});
  });

  it('executar() rejeita → log, resultado.json gravado mesmo assim, volta a OCIOSO', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    montarAmbiente(dir);
    vi.spyOn(Executor.prototype, 'executar').mockRejectedValueOnce(new Error('boom'));
    expect((await runPOST(req('/api/erros/run'))).status).toBe(200);
    await esperarOcioso();
    expect(getErrosService().status().estado).toBe('OCIOSO');
    const pasta = join(dir, 'execucoes', getErrosService().status().exec!);
    expect(existsSync(join(pasta, 'resultado.json'))).toBe(true);
    expect(readFileSync(join(pasta, 'log.txt'), 'utf8')).toContain('boom');
  });

  it('laudo da execução em curso → 409', async () => {
    const dir = criarPacote();
    pacotesCriados.push(dir);
    writeFileSync(join(dir, 'gerar_laudo.py'), '');
    montarAmbiente(dir);
    let soltar = (): void => {};
    vi.spyOn(Executor.prototype, 'executar').mockImplementationOnce(() => new Promise((res) => (soltar = () => res([]))));
    await runPOST(req('/api/erros/run'));
    const exec = getErrosService().status().exec!;
    expect((await laudoPOST(req('/api/erros/laudo', { exec }))).status).toBe(409);
    soltar();
    await esperarOcioso();
  });
});
