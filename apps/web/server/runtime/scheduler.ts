import { TICK_DT_S, type Runtime } from './singleton.js';

export interface SchedulerOpts {
  runtime: Runtime;
  /** Wall-clock period between scheduler firings (ms). */
  tick_wall_ms: number;
}

/** Máximo de tempo simulado em atraso recuperado de uma vez (anti-espiral após pausa/GC). */
const MAX_BACKLOG_S = 2;

/**
 * Avança a simulação pelo relógio de parede: a cada disparo roda os ticks DEVIDOS desde o disparo
 * anterior (parede decorrida × velocidade), não um número fixo. Com `n` ticks fixos por disparo e
 * `if (busy) return`, qualquer disparo que passasse de tick_wall_ms (2 ticks + sync Modbus com o
 * CLP) pulava o seguinte e o tempo simulado ficava ~3–4 % atrás do CLP (210 s de esterilização do
 * CLP viravam 202 s simulados). Velocidade: timeScale = ticks por disparo ⇒ taxa = timeScale·dt/período
 * (timeScale 2 com 100 ms e dt 50 ms = 1× tempo real).
 */
export function startScheduler(opts: SchedulerOpts): () => void {
  let running = true;
  let busy = false;
  let last_ms = Date.now();
  let owed_s = 0;

  const handle = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      // Read timeScale each firing so mid-run changes (a knob) take effect immediately.
      const n = Math.max(1, Math.round(opts.runtime.timeScale) || 1);
      const rate = (n * TICK_DT_S) / (opts.tick_wall_ms / 1000);
      const now_ms = Date.now();
      owed_s = Math.min(owed_s + ((now_ms - last_ms) / 1000) * rate, MAX_BACKLOG_S);
      last_ms = now_ms;
      while (owed_s >= TICK_DT_S - 1e-9) {
        await opts.runtime.tick();
        owed_s -= TICK_DT_S;
      }
    } catch (err) {
      console.error('scheduler tick error:', err);
    } finally {
      busy = false;
    }
  }, opts.tick_wall_ms);

  return () => {
    running = false;
    clearInterval(handle);
  };
}
