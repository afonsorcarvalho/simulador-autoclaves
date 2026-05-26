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
      testemunho_C: K_to_C(o.state.load.T_fabric),
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

export class SnapshotPublisher {
  private subs = new Set<SnapshotSubscriber>();
  private _latest: Snapshot | null = null;

  publish(snap: Snapshot): void {
    this._latest = snap;
    for (const cb of this.subs) {
      try {
        cb(snap);
      } catch (err) {
        console.error('snapshot subscriber threw:', err);
      }
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
}
