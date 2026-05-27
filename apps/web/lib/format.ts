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
