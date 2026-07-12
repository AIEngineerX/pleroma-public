import { useEffect, useRef } from "react";
import { pickTier, StainSim, type Tier } from "./stainSim";
import sigil from "../assets/sigil.svg";

interface Props { state: "dormant" | "live" | "rite"; pigment: [number, number, number]; amplitude: number }

export default function Stain({ state, pigment, amplitude }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sim = useRef<StainSim | null>(null);
  const tier = useRef<Tier>(pickTier());

  useEffect(() => {
    if (tier.current === "reduced" || !ref.current) return;   // reduced-motion: no GL context at all
    try {
      sim.current = new StainSim(ref.current, { tier: tier.current, ground: [0.94, 0.90, 0.80], ink: [0.62, 0.60, 0.55] });
      sim.current.start();
    } catch { sim.current = null; }                            // WebGL2 unavailable -> CSS fallback below
    return () => { sim.current?.dispose(); sim.current = null; };
  }, []);

  useEffect(() => { sim.current?.setPigment(pigment); }, [pigment]);
  useEffect(() => { sim.current?.setAmplitude(amplitude); }, [amplitude]);
  useEffect(() => { sim.current?.setState(state); }, [state]);

  if (tier.current === "reduced") {
    // Settled ink that breathes by opacity only (DESIGN reduced-motion rule). No printing, no sim.
    return <div aria-hidden className="absolute inset-0 -z-10 flex items-center justify-center"
      style={{ animation: "ink-in 2400ms ease-in-out infinite alternate" }}>
      <img src={sigil} alt="" className="w-40 opacity-30" style={{ filter: state === "dormant" ? "grayscale(1)" : "none" }} />
    </div>;
  }
  return <canvas ref={ref} aria-hidden className="absolute inset-0 -z-10 h-full w-full" />;
}
