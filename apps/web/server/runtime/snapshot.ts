import type { SystemState, SystemParams } from '@sim/physics';
import { chamber_pressure, generator_pressure, K_to_C, Pa_to_bar } from '@sim/physics';

export interface Snapshot {
  t_s: number;
  wall_t_ms: number;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  f0_min: number;
  pressures: { chamber_bar: number; jacket_bar: number; generator_bar: number };
  temperatures: { chamber_C: number; testemunho_C: number; jacket_C: number; generator_C: number };
  valves: Record<string, boolean>;
  masses: { air_chamber_kg: number; vap_chamber_kg: number; liq_chamber_kg: number };
}

export interface BuildSnapshotOpts {
  state: SystemState;
  params: SystemParams;
  cycle_running: boolean;
  cycle_phase: string;
  cycle_elapsed_s: number;
  valves: Record<string, boolean>;
}

export function buildSnapshot(o: BuildSnapshotOpts): Snapshot {
  const pc = chamber_pressure(o.state.chamber, o.params.chamber);
  const pj = chamber_pressure(o.state.jacket, o.params.jacket);
  const pg =
    o.state.generator && o.params.generator
      ? generator_pressure(o.state.generator, o.params.generator)
      : 0;
  return {
    t_s: o.state.time_s,
    wall_t_ms: Date.now(),
    cycle_running: o.cycle_running,
    cycle_phase: o.cycle_phase,
    cycle_elapsed_s: o.cycle_elapsed_s,
    f0_min: o.state.f0_minutes,
    pressures: {
      chamber_bar: Pa_to_bar(pc.p_total),
      jacket_bar: Pa_to_bar(pj.p_total),
      generator_bar: Pa_to_bar(pg),
    },
    temperatures: {
      chamber_C: K_to_C(o.state.chamber.T),
      testemunho_C: K_to_C(
        (o.state.load.nodes.find((n) => n.isWitness) ?? o.state.load.nodes[0]!).T,
      ),
      jacket_C: K_to_C(o.state.jacket.T),
      generator_C: o.state.generator ? K_to_C(o.state.generator.T) : 0,
    },
    valves: { ...o.valves },
    masses: {
      air_chamber_kg: o.state.chamber.m_air,
      vap_chamber_kg: o.state.chamber.m_vap,
      liq_chamber_kg: o.state.chamber.m_liq,
    },
  };
}

export type SnapshotSubscriber = (snap: Snapshot) => void;

const HISTORY_CAP = 5000; // whole cycle at 1 Hz (~83 min)

export class SnapshotPublisher {
  private subs = new Set<SnapshotSubscriber>();
  private _latest: Snapshot | null = null;
  private _history: Snapshot[] = [];
  private lastSec = -1;
  private prevRunning = false;

  publish(snap: Snapshot): void {
    this._latest = snap;
    this.record(snap);
    for (const cb of this.subs) {
      try {
        cb(snap);
      } catch (err) {
        console.error('snapshot subscriber threw:', err);
      }
    }
  }

  /**
   * Server-side cycle history so a client that opens (or re-opens) /live gets the
   * whole cycle, not just from the moment it connected. One point per elapsed second
   * while running; cleared when a new cycle starts (rising edge of cycle_running).
   */
  private record(snap: Snapshot): void {
    if (snap.cycle_running && !this.prevRunning) {
      this._history = [];
      this.lastSec = -1;
    }
    this.prevRunning = snap.cycle_running;
    if (!snap.cycle_running) return;
    const sec = Math.floor(snap.cycle_elapsed_s);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this._history.push(snap);
      if (this._history.length > HISTORY_CAP) this._history.shift();
    }
  }

  subscribe(cb: SnapshotSubscriber): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  get latest(): Snapshot | null {
    return this._latest;
  }

  get history(): readonly Snapshot[] {
    return this._history;
  }
}
