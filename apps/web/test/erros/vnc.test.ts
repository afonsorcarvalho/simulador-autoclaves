import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturarIhm } from '../../server/erros/vnc.js';

const SENHA = 'segredo-super-secreto';
const CFG = { ihmIp: '127.0.0.1', vncPort: 5900, vncSenha: SENHA };

describe('capturarIhm (VNC)', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('sucesso: roda o comando e grava o arquivo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-vnc-'));
    const arquivo = join(dir, 'captura.png');

    const resultado = await capturarIhm(CFG, arquivo, {
      cmd: process.execPath,
      args: (_cfg, arq) => ['-e', "require('fs').writeFileSync(process.argv.at(-1),'x')", arq],
    });

    expect(resultado).toEqual({ ok: true });
    expect(existsSync(arquivo)).toBe(true);
  });

  it('timeout: processo que demora mais que timeout_ms vira erro "timeout"', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-vnc-'));
    const arquivo = join(dir, 'captura.png');

    const resultado = await capturarIhm(CFG, arquivo, {
      cmd: process.execPath,
      args: () => ['-e', 'setTimeout(() => {}, 60000)'],
      timeout_ms: 200,
    });

    expect(resultado).toEqual({ ok: false, erro: 'timeout' });
  });

  it('falha com senha no stderr: mensagem de erro nunca contém a senha', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-vnc-'));
    const arquivo = join(dir, 'captura.png');

    const resultado = await capturarIhm(CFG, arquivo, {
      cmd: process.execPath,
      args: (cfg) => [
        '-e',
        'process.stderr.write("falhou: senha=" + process.argv.at(-1)); process.exit(1)',
        cfg.vncSenha,
      ],
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.erro).not.toContain(SENHA);
      expect(resultado.erro).toContain('***');
    }
  });

  it('comando inexistente: mensagem clara de vncdo ausente', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-vnc-'));
    const arquivo = join(dir, 'captura.png');

    const resultado = await capturarIhm(CFG, arquivo, {
      cmd: 'vncdo-comando-que-nao-existe-xyz',
      timeout_ms: 2000,
    });

    expect(resultado).toEqual({ ok: false, erro: 'vncdo não encontrado (pip install vncdotool)' });
  });

  it('falha transitória: 1 nova tentativa e dá certo na 2ª', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sim-vnc-'));
    const arquivo = join(dir, 'captura.png');
    // 1ª chamada só cria a marca e falha; a 2ª encontra a marca e grava a captura.
    const js =
      "const fs=require('fs'),a=process.argv.at(-1),m=a+'.marca';" +
      "if(!fs.existsSync(m)){fs.writeFileSync(m,'');process.exit(1)}fs.writeFileSync(a,'x')";
    const resultado = await capturarIhm(CFG, arquivo, { cmd: process.execPath, args: (_c, arq) => ['-e', js, arq] });
    expect(resultado).toEqual({ ok: true });
    expect(existsSync(arquivo)).toBe(true);
  });
});
