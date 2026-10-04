// Valores-padrão da planta, compartilhados entre singleton (defaultParams) e o registry de knobs.
// Módulo à parte para evitar o ciclo singleton → store → registry → singleton.

/** SIM_PLC=delta: CLP Delta real (Modbus TCP em SIM_PLC_HOST) no lugar da VirtualPLC. */
export const REAL_PLC = process.env.SIM_PLC === 'delta';
/** Cv da alimentação da camisa no modo CLP real (knob de calibração, env SIM_JACKET_CV). */
const JACKET_CV_REAL_PLC = Number(process.env.SIM_JACKET_CV ?? 5e-6);

/** Cv (área efetiva, m²) padrão de cada válvula de processo. */
export const VALVE_CV_DEFAULT = {
  V_STEAM_IN_INT: 8e-6,
  V_STEAM_IN_JACKET: REAL_PLC ? JACKET_CV_REAL_PLC : 1e-6,
  V_AIR_IN: 2e-5,
  V_EXHAUST: 2e-5,
  V_DRAIN_INT: 2e-5,
} as const;

/** Bomba de vácuo. S_nom 75 m³/h e p_ult 10 mbar (= antigo nó 'vacuum') reproduzem a evacuação do
 *  modelo antigo (V_VAC Cv 1e-4 até 10 mbar): ar 1,013→0,1 bar 17,3 s vs 17,4 s. vapor_factor 1,7
 *  (efeito condensador do anel líquido) iguala a evacuação de vapor 2→0,15 bar: 71,5 s vs 70,3 s. */
export const PUMP_DEFAULT = { S_nom_m3_h: 75, p_ult_mbar: 10, vapor_factor: 1.7 } as const;

/** Geometria de referência: câmara 150 L / parede 50 kg; camisa 25 L / parede 15 kg. A camisa
 *  escala proporcionalmente ao volume da câmara. */
export const CHAMBER_REF = { V: 0.15, wall_kg: 50, jacket_V: 0.025, jacket_wall_kg: 15 } as const;
