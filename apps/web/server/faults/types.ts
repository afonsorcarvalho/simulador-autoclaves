/** Falha injetável no HIL. alvo: 'temp:N' | 'press:N' (canal bruto 0-based), nome de entrada do CLP,
 *  id de válvula da física, 'steam_line', 'C'/'D' (porta) ou '' (energia). */
export type FaultTipo =
  | 'analog.open' | 'analog.freeze' | 'analog.offset' | 'analog.force'
  | 'digital.force' | 'valve.stuck' | 'utility.off' | 'power.cut';
export interface Fault {
  id: string;
  tipo: FaultTipo;
  alvo: string;
  /** analog: valor bruto/offset; digital/valve: 0|1. */
  valor?: number;
}
