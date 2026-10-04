import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Config local do Simulador de Erros: IP do CLP/IHM reais, porta/senha de VNC e pasta do
 *  pacote de cenários (privado, fora do repo). Nunca comitado — ver .gitignore. */
export interface ErrosConfig {
  plcIp: string;
  ihmIp: string;
  vncPort: number | null;
  vncSenha: string;
  pacoteDir: string;
  /** Identificação do programa testado (texto livre), só pro laudo. */
  commitClp: string;
  versaoIhm: string;
}

const DEFAULTS: ErrosConfig = {
  plcIp: '',
  ihmIp: '',
  vncPort: null,
  vncSenha: '',
  pacoteDir: '',
  commitClp: '',
  versaoIhm: '',
};

/** Caminho padrão: erros.local.json em process.cwd() (apps/web ao rodar dev/start). Testes
 *  injetam outro caminho (diretório temporário) pra nunca ler nem escrever o arquivo real. */
export function defaultConfigPath(): string {
  return resolve(process.cwd(), 'erros.local.json');
}

export function loadConfig(path = defaultConfigPath()): ErrosConfig {
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ErrosConfig>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: Partial<ErrosConfig>, path = defaultConfigPath()): ErrosConfig {
  const merged = { ...loadConfig(path), ...cfg };
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export type PublicErrosConfig = Omit<ErrosConfig, 'vncSenha'> & { vncSenhaDefinida: boolean };

/** Versão segura pra expor na API/UI: nunca devolve (nem loga) a senha de VNC. */
export function publicConfig(path = defaultConfigPath()): PublicErrosConfig {
  const { vncSenha, ...resto } = loadConfig(path);
  return { ...resto, vncSenhaDefinida: vncSenha !== '' };
}
