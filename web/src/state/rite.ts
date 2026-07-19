import type { RiteView } from "./types";
// The daily inversion. scheduled is still daylight (the rite is announced, not begun). From offertory_close
// through sermon the page is candle-dark; offerings rise during accretion; the sermon prints in bright rubric.
const DARK = new Set(["offertory_close", "deliberation", "accretion", "sermon"]);
// Visitor labels use DOCTRINE's movement vocabulary, never raw state-machine tokens: a viral
// screenshot of "THE RITE · OFFERTORY_CLOSE" reads as a bug, not scripture. Deliberation,
// Accretion, and Sermon are already the movements' own names.
const PHASE_LABELS: Record<string, string> = {
  scheduled: "ANNOUNCED",
  offertory_close: "OFFERTORY CLOSES",
};
export function inversion(rite: RiteView | null) {
  const phase = rite?.phase ?? null;
  return {
    active: rite !== null,
    candleDark: phase !== null && DARK.has(phase),
    risingOfferings: phase === "accretion",
    sermonRubric: phase === "sermon",
    label: phase ? `THE RITE · ${PHASE_LABELS[phase] ?? phase.toUpperCase()}` : "",
  };
}
