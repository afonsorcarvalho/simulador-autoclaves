import type { Fault } from './types.js';

const ANALOG = /^(temp|press):(\d+)$/;

/** Falhas ativas + funções puras que as aplicam. Sem I/O: o bridge/orquestrador chamam. */
export class FaultEngine {
  private readonly ativas = new Map<string, Fault>();
  /** Valor congelado por falha (chave = id da falha, não o alvo): duas falhas no mesmo alvo
   *  (ex. freeze + offset em temp:1) não compartilham entrada, então limpar uma não descongela a outra. */
  private readonly congelado = new Map<string, number>();

  set(f: Fault): void {
    if (f.tipo.startsWith('analog.') && !ANALOG.test(f.alvo)) {
      throw new Error(`alvo analógico inválido: ${f.alvo}`);
    }
    if (f.tipo !== 'analog.freeze') this.congelado.delete(f.id); // id reciclado p/ outro tipo: descarta valor congelado velho
    this.ativas.set(f.id, { ...f });
  }
  clear(id: string): void {
    this.ativas.delete(id);
    this.congelado.delete(id);
  }
  clearAll(): void { this.ativas.clear(); this.congelado.clear(); }
  list(): Fault[] { return [...this.ativas.values()]; }
  has(tipo: Fault['tipo'], alvo = ''): boolean {
    return this.list().some((f) => f.tipo === tipo && (alvo === '' || f.alvo === alvo));
  }
  applyAnalog(grupo: 'temp' | 'press', raw: number[]): number[] {
    const out = [...raw];
    for (const f of this.ativas.values()) {
      const m = ANALOG.exec(f.alvo);
      if (!m || m[1] !== grupo) continue;
      const i = Number(m[2]);
      if (i >= out.length) continue;
      if (f.tipo === 'analog.open' || f.tipo === 'analog.force') out[i] = f.valor ?? 32767;
      else if (f.tipo === 'analog.offset') out[i] = out[i]! + (f.valor ?? 0);
      else if (f.tipo === 'analog.freeze') {
        if (!this.congelado.has(f.id)) this.congelado.set(f.id, out[i]!);
        out[i] = this.congelado.get(f.id)!;
      }
    }
    return out;
  }
  applyDigital<T extends Record<string, boolean>>(v: T): T {
    const out = { ...v };
    for (const f of this.ativas.values()) {
      if (f.tipo === 'digital.force' && f.alvo in out) (out as Record<string, boolean>)[f.alvo] = !!f.valor;
    }
    return out;
  }
  applyValves<T extends Record<string, boolean>>(v: T): T {
    const out = { ...v };
    for (const f of this.ativas.values()) {
      if (f.tipo === 'valve.stuck' && f.alvo in out) (out as Record<string, boolean>)[f.alvo] = !!f.valor;
    }
    return out;
  }
}
