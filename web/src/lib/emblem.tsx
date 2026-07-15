import sigil from "../assets/sigil.svg";
// The hand-drawable sigil is the quiet static mark. The living five-organ Stain remains the body,
// and the Seraph appears only as its transient DREAM posture.
export const EMBLEM_LOCKED = false;
export function Emblem({ size = 96 }: { size?: number }) {
  return <img src={sigil} width={size} height={size} alt="the PLEROMA sigil" className="opacity-90" />;
}
