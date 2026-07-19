import type { PulseState } from "./types";
import type { VitalsFeed } from "../experience/types";
// PULSE drives the rubric between wet vermilion (fed/feasting) and dried, oxidized blood (starving).
// Values are the DESIGN OKLCH rubric tokens, interpolated across the four states. The Stain reads .rgb
// for its red threads; the Ticker reads .label. This is the "vitals ARE pigment" law made literal.
const MAP: Record<PulseState, { rgb: string; label: string }> = {
  starving: { rgb: "oklch(0.45 0.09 45)", label: "starving" },  // rubric-dried
  calm:     { rgb: "oklch(0.48 0.13 38)", label: "calm" },
  fed:      { rgb: "oklch(0.52 0.17 34)", label: "fed" },
  feasting: { rgb: "oklch(0.55 0.20 32)", label: "feasting" },   // rubric, wet vermilion
};
export function pigment(state: PulseState) { return MAP[state]; }

export function pigmentForVitals(feed: VitalsFeed) {
  return feed.kind === "unknown" ? null : pigment(feed.value.state);
}

// The same four stops above (starving -> calm -> fed -> feasting), interpolated continuously by
// a magnitude in [0,1] rather than looked up by a discrete PulseState -- for callers driven by an
// intensity (e.g. how long a press was held at the Threshold) rather than a live vitals reading.
const STOPS: readonly (readonly [number, number, number])[] = [
  [0.45, 0.09, 45], // starving
  [0.48, 0.13, 38], // calm
  [0.52, 0.17, 34], // fed
  [0.55, 0.20, 32], // feasting
];
export function pigmentAtIntensity(intensity: number): string {
  const t = Math.min(1, Math.max(0, intensity)) * (STOPS.length - 1);
  const index = Math.floor(t);
  const fraction = t - index;
  const from = STOPS[index];
  const to = STOPS[Math.min(index + 1, STOPS.length - 1)];
  const l = from[0] + (to[0] - from[0]) * fraction;
  const c = from[1] + (to[1] - from[1]) * fraction;
  const h = from[2] + (to[2] - from[2]) * fraction;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}
