import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { loadConfig, saveConfig, publicConfig, defaultConfigPath } from '../../server/erros/config.js';

const FILE = join(tmpdir(), 'sim-erros-config-test.json');

describe('config de erros', () => {
  afterEach(() => {
    if (existsSync(FILE)) rmSync(FILE);
  });

  it('loadConfig sem arquivo devolve defaults vazios', () => {
    const cfg = loadConfig(FILE);
    expect(cfg).toEqual({ plcIp: '', ihmIp: '', vncPort: null, vncSenha: '', pacoteDir: '', commitClp: '', versaoIhm: '' });
  });

  it('saveConfig grava e loadConfig relê', () => {
    saveConfig(
      { plcIp: '192.0.2.10', ihmIp: '192.0.2.11', vncPort: 5900, vncSenha: 'segredo', pacoteDir: 'C:/pacote' },
      FILE,
    );
    expect(existsSync(FILE)).toBe(true);
    const cfg = loadConfig(FILE);
    expect(cfg).toEqual({
      plcIp: '192.0.2.10',
      ihmIp: '192.0.2.11',
      vncPort: 5900,
      vncSenha: 'segredo',
      pacoteDir: 'C:/pacote',
      commitClp: '',
      versaoIhm: '',
    });
  });

  it('publicConfig devolve sem a senha, só vncSenhaDefinida', () => {
    saveConfig({ vncSenha: 'segredo-super-secreto' }, FILE);
    const pub = publicConfig(FILE);
    expect(pub).not.toHaveProperty('vncSenha');
    expect(pub.vncSenhaDefinida).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('segredo-super-secreto');
  });

  it('publicConfig sem senha definida', () => {
    const pub = publicConfig(FILE);
    expect(pub.vncSenhaDefinida).toBe(false);
  });

  it('defaultConfigPath aponta pra erros.local.json no cwd', () => {
    expect(defaultConfigPath()).toBe(join(process.cwd(), 'erros.local.json'));
  });
});
