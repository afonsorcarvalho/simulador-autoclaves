export interface LoadState {
  T_metal: number; // K
  T_fabric: number; // K — also reported as witness sensor reading
}

export interface LoadParams {
  m_metal: number;
  cp_metal: number;
  m_fabric: number;
  cp_fabric: number;
  h_gas_metal: number; // W/K
  h_metal_fabric: number; // W/K
}

export interface LoadStepResult {
  next: LoadState;
  Q_from_gas: number; // W (positive = heat flowing from gas to load)
}

export function load_step(s: LoadState, p: LoadParams, T_gas: number, dt: number): LoadStepResult {
  const Q_gas_metal = p.h_gas_metal * (T_gas - s.T_metal);
  const Q_metal_fabric = p.h_metal_fabric * (s.T_metal - s.T_fabric);

  const dT_metal = ((Q_gas_metal - Q_metal_fabric) * dt) / (p.m_metal * p.cp_metal);
  const dT_fabric = (Q_metal_fabric * dt) / (p.m_fabric * p.cp_fabric);

  return {
    next: { T_metal: s.T_metal + dT_metal, T_fabric: s.T_fabric + dT_fabric },
    Q_from_gas: Q_gas_metal,
  };
}
