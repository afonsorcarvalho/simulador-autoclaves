import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { FaultSchema } from '../faults/schema.js';

/** "D100", "M10" (endereço direto) ou um nome do MAPA_SIMBOLOS.json (ver resolveEndereco). */
const Endereco = z.string();

const Passo = z.union([
  z
    .object({
      carregar_receita: z
        .object({ numero: z.number().int(), campos: z.record(z.string(), z.number()).default({}) })
        .strict(),
    })
    .strict(),
  z.object({ iniciar_ciclo: z.literal(true) }).strict(),
  z
    .object({ esperar: z.record(Endereco, z.number()), max_s: z.number().positive() })
    .strict(),
  z.object({ aguardar_s: z.number().positive() }).strict(),
  z.object({ escrever: z.record(Endereco, z.number()) }).strict(),
  z.object({ falha: FaultSchema }).strict(),
  z
    .object({
      porta: z
        .object({ lado: z.enum(['C', 'D']), falhas: z.record(z.string(), z.unknown()) })
        .strict(),
    })
    .strict(),
  z.object({ manual: z.string() }).strict(),
]);

const Esperado = z
  .object({
    descricao: z.string(),
    ler: Endereco,
    igual: z.number().int().optional(), // registros são inteiros com sinal
    maior_que: z.number().optional(),
    menor_que: z.number().optional(),
    prazo_s: z.number().positive().default(10),
  })
  .strict()
  .refine(
    (e) => e.igual !== undefined || e.maior_que !== undefined || e.menor_que !== undefined,
    { message: 'esperado precisa de ao menos um operador (igual/maior_que/menor_que)' },
  );

export const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    titulo: z.string(),
    origem: z.string(),
    automacao: z.enum(['auto', 'manual', 'na']),
    justificativa_na: z.string().optional(),
    nota: z.string().optional(),
    registrar: z.array(Endereco).default([]),
    setup_temporario: z.record(Endereco, z.number()).default({}),
    pre: z.array(Passo).default([]),
    falha: z.array(Passo).default([]),
    esperado: z.array(Esperado).default([]),
    limpeza: z.array(Passo).default([]),
  })
  .refine((s) => s.automacao === 'na' || s.esperado.length > 0, 'cenário sem esperado');

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Passo = z.infer<typeof Passo>;
export type Esperado = z.infer<typeof Esperado>;

export function parseScenario(json: unknown): Scenario {
  return ScenarioSchema.parse(json);
}

export interface EnderecoResolvido {
  area: string;
  addr: number;
}

const ENDERECO_DIRETO_RE = /^([A-Za-z]+)(\d+)$/;

/** Resolve "D100"/"M10" direto, ou um nome (ex. 'NOME_SIMBOLO') via mapa {nome: 'D100'} do
 *  MAPA_SIMBOLOS.json (pacote privado de cenários). */
export function resolveEndereco(
  nome: string,
  mapa: Record<string, string> = {},
): EnderecoResolvido {
  const direto = ENDERECO_DIRETO_RE.exec(nome);
  if (direto) return { area: direto[1]!, addr: Number(direto[2]) };
  const mapeado = mapa[nome];
  const m = mapeado ? ENDERECO_DIRETO_RE.exec(mapeado) : null;
  if (m) return { area: m[1]!, addr: Number(m[2]) };
  throw new Error(`endereço desconhecido: ${nome}`);
}

/** Natural sort (grupo alfabético + número numérico: S1 < S2 < S10). */
function naturalCompare(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [];
  const bx = b.match(/\d+|\D+/g) ?? [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const as = ax[i] ?? '';
    const bs = bx[i] ?? '';
    if (as === bs) continue;
    if (/^\d+$/.test(as) && /^\d+$/.test(bs)) {
      const diff = Number(as) - Number(bs);
      if (diff !== 0) return diff;
    } else {
      return as < bs ? -1 : 1;
    }
  }
  return 0;
}

/** Lê e valida todo cenário em dir/cenarios/*.json, ordenado por grupo e número natural. */
export function loadScenarios(dir: string): Scenario[] {
  const cenariosDir = join(dir, 'cenarios');
  const arquivos = readdirSync(cenariosDir)
    .filter((f) => f.endsWith('.json'))
    .sort(naturalCompare);
  return arquivos.map((f) =>
    parseScenario(JSON.parse(readFileSync(join(cenariosDir, f), 'utf8'))),
  );
}
