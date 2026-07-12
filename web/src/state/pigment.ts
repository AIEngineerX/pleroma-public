import type { PulseState } from "./types";
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
