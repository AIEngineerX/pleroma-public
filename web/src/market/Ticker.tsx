import type { TempleState } from "../state/types";

// The single Courier telemetry line for the literal-minded (DESIGN "no charts; a single line").
export default function Ticker({ state }: { state: TempleState | null }) {
  if (!state) return null;
  const v = state.vitals;
  return (
    <p className="font-machine text-xs text-ink-faded" aria-live="polite">
      PULSE {v.state.toUpperCase()} · buys {v.buys} · sells {v.sells} · holders {v.holders} · communicants {state.communicants_today}
    </p>
  );
}
