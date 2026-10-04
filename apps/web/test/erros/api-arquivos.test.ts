import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resetRuntime } from '../../server/runtime/singleton.js';
import { resetErrosService, getErrosService } from '../../server/erros/service.js';
import { GET as arquivoGET } from '../../app/api/erros/arquivo/route.js';
import { POST as testarPOST } from '../../app/api/erros/testar/route.js';
import { POST as laudoPOST } from '../../app/api/erros/laudo/route.js';
import { POST as acumPOST } from '../../app/api/erros/laudo-acumulado/route.js';

const temPython = spawnSync('python', ['--version']).status === 0;
let pacote = '';

function arq(exec: string, nome: string) {
  return arquivoGET(new Request(`http://localhost/api/erros/arquivo?exec=${encodeURIComponent(exec)}&nome=${encodeURIComponent(nome)}`));
}
const acum = () => acumPOST(new Request('http://localhost/api/erros/laudo-acumulado', { method: 'POST' }));
function laudo(exec: string) {
  return laudoPOST(new Request('http://localhost/api/erros/laudo', { method: 'POST', body: JSON.stringify({ exec }) }));
}

describe('/api/erros arquivo|testar|laudo', () => {
  beforeEach(() => {
    resetRuntime(); // modo virtual
    resetErrosService();
    pacote = mkdtempSync(join(tmpdir(), 'sim-erros-arq-'));
    mkdirSync(join(pacote, 'execucoes', 'E1', 'fotos'), { recursive: true });
    writeFileSync(join(pacote, 'execucoes', 'E1', 'fotos', 'a.png'), 'png');
    writeFileSync(join(pacote, 'segredo.json'), '{}');
    getErrosService(join(pacote, 'cfg.json')).setConfig({ pacoteDir: pacote });
  });
  afterEach(() => rmSync(pacote, { recursive: true, force: true }));

  it('arquivo: traversal → 400', async () => {
    for (const [e, n] of [
      ['..', 'segredo.json'],
      ['E1', '../../segredo.json'],
      ['E1', '..\\..\\segredo.json'],
      ['E1/..', 'segredo.json'],
      ['E1', 'C:\\x.png'],
      ['E1', '/etc/x.png'],
      ['E1', 'fotos/a.exe'],
    ]) {
      expect((await arq(e!, n!)).status, `${e} ${n}`).toBe(400);
    }
  });

  it('arquivo: ok → 200 com content-type; inexistente → 404', async () => {
    const res = await arq('E1', 'fotos/a.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('png');
    expect((await arq('E1', 'nada.png')).status).toBe(404);
  });

  it('testar em modo virtual → clp erro, sem senha na resposta', async () => {
    getErrosService().setConfig({ vncSenha: 'segredo123' });
    const res = await testarPOST(new Request('http://localhost/api/erros/testar', { method: 'POST' }));
    const body = await res.json();
    expect(body.clp).toBe('erro');
    expect(body.ihm).toBe('erro'); // sem IP de IHM
    expect(JSON.stringify(body)).not.toContain('segredo123');
  });

  it('laudo sem gerar_laudo.py → 409', async () => {
    expect((await laudo('E1')).status).toBe(409);
  });

  it.skipIf(!temPython)('laudo roda gerar_laudo.py e lista os arquivos (pula se python não estiver no PATH)', async () => {
    writeFileSync(
      join(pacote, 'gerar_laudo.py'),
      'import sys, os\nopen(os.path.join(sys.argv[1], "laudo_teste.pdf"), "w").write("x")\n',
    );
    const res = await laudo('E1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, arquivos: ['laudo_teste.pdf'] });
    expect((await laudo('../x')).status).toBe(400);
  });

  it('laudo acumulado: sem gerar_laudo.py → 409; execução rodando → 409; remoto → 403', async () => {
    expect((await acum()).status).toBe(409);
    writeFileSync(join(pacote, 'gerar_laudo.py'), '');
    (getErrosService() as unknown as { executor: unknown }).executor = { estado: 'RODANDO' };
    expect((await acum()).status).toBe(409);
    const remoto = await acumPOST(
      new Request('http://localhost/api/erros/laudo-acumulado', { method: 'POST', headers: { origin: 'http://outro.example' } }),
    );
    expect(remoto.status).toBe(403);
  });

  it.skipIf(!temPython)('laudo acumulado roda gerar_laudo.py --acumulado e serve de exec=_acumulado', async () => {
    writeFileSync(
      join(pacote, 'gerar_laudo.py'),
      'import sys, os\nassert sys.argv[1] == "--acumulado"\nd = os.path.join(sys.argv[2], "execucoes", "_acumulado")\n' +
        'os.makedirs(d, exist_ok=True)\nopen(os.path.join(d, "laudo_acumulado.pdf"), "w").write("x")\n',
    );
    const res = await acum();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, arquivos: ['laudo_acumulado.pdf'] });
    const a = await arq('_acumulado', 'laudo_acumulado.pdf');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('application/pdf');
  });
});
