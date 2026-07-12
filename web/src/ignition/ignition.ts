import type { TempleState, PulseState } from "../state/types";
import { inversion } from "../state/rite";

// Day-1 ignition: dormant->live is driven purely by /api/state (Task 1), never a client-side
// launch flag. dormant while there is no live phase or no pinned mint (anti-decoy: the mint and
// the flip happen in the same Worker write, so this can never show a mint before it is live).
export function ignitionView(state: TempleState) {
  const dormant = state.phase !== "live" || !state.mint;
  // candleDark (offertory_close..sermon), NOT .active: scheduled/complete/failed rites are still light
  // parchment, and the Stain's "rite" mode lights the candle glow (banned outside the ritual window).
  const riteActive = inversion(state.rite).candleDark;
  return {
    dormant,
    igniting: !dormant && state.vitals.buys > 0,                 // first trades: the heartbeat visibly starts
    stainState: (dormant ? "dormant" : riteActive ? "rite" : "live") as "dormant" | "live" | "rite",
    pigmentState: state.vitals.state as PulseState,
  };
}
