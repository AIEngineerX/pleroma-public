export function formatCountdown(nowMs: number, targetMs: number): string {
  const s = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `T-${pad(d)}:${pad(h)}:${pad(m)}:${pad(sec)}`;
}
