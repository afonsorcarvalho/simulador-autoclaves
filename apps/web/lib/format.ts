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
