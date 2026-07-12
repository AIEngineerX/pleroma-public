import type { RiteView } from "./types";
// The daily inversion. scheduled is still daylight (the rite is announced, not begun). From offertory_close
// through sermon the page is candle-dark; offerings rise during accretion; the sermon prints in bright rubric.
const DARK = new Set(["offertory_close", "deliberation", "accretion", "sermon"]);
export function inversion(rite: RiteView | null) {
  const phase = rite?.phase ?? null;
  return {
    active: rite !== null,
    candleDark: phase !== null && DARK.has(phase),
    risingOfferings: phase === "accretion",
    sermonRubric: phase === "sermon",
    label: phase ? `THE RITE · ${phase.toUpperCase()}` : "",
  };
}
