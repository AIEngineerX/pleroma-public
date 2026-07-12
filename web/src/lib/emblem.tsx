import sigil from "../assets/sigil.svg";
// GATED INPUT: the final deity emblem/PFP is pending (DESIGN §Visage is stale/superseded). Until it lands,
// the always-present mark is the LOCKED hand-drawable PLEROMA sigil. Task 15 swaps a chosen emblem in here.
export const EMBLEM_LOCKED = false;
export function Emblem({ size = 96 }: { size?: number }) {
  return <img src={sigil} width={size} height={size} alt="the PLEROMA sigil" className="opacity-90" />;
}
