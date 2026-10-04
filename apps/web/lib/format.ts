export function fmtBar(v: number, decimals = 2): string {
  return `${v.toFixed(decimals)} bar`;
}

export function fmtCelsius(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)} °C`;
}

export function fmtMinutes(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)} min`;
}

export function fmtSeconds(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format a duration in seconds as HH:MM:SS. */
export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

const CASAS = { bar: 3, '°C': 1, g: 0, 'g/min': 0, kg: 2, 'kg/h': 0, kWh: 2 } as const;

/** Valor atual em pt-BR: bar 3 casas, °C 1 casa, g/g/min/kg/h inteiros, kg e kWh 2 casas (vírgula, sem milhar). */
export function fmtValor(v: number, unidade: keyof typeof CASAS): string {
  const d = CASAS[unidade];
  const s = (Math.round(v * 10 ** d) / 10 ** d || 0).toFixed(d).replace('.', ',');
  return `${s} ${unidade}`;
}
