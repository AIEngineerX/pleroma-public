import { useEffect, useRef, useState } from "react";
import { pickTier, StainSim, type Tier } from "./stainSim";
import sigil from "../assets/sigil.svg";

interface Props { state: "dormant" | "live" | "rite"; pigment: [number, number, number]; amplitude: number; onSim?: (sim: StainSim | null) => void }

export default function Stain({ state, pigment, amplitude, onSim }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sim = useRef<StainSim | null>(null);
  const [tier] = useState<Tier>(pickTier); // lazy: pickTier runs ONCE, not on every (per-amplitude-frame) re-render

  useEffect(() => {
    if (tier === "reduced" || !ref.current) return;   // reduced-motion: no GL context at all
    const canvas = ref.current;
    try {
      // ground = warm parchment; ink = iron-gall (dark warm brown-black) so the body reads as INK darkening
      // the page, not a gray wash. u_ink is subtracted from ground, so a large value = a deep stain.
      sim.current = new StainSim(canvas, { tier, ground: [0.94, 0.90, 0.80], ink: [0.74, 0.71, 0.64] });
      sim.current.start();
      onSim?.(sim.current);          // hand the instance up so an offering can wick into it (Task 8)
    } catch { sim.current = null; }                            // WebGL2 unavailable -> CSS fallback below
    // The body leans toward the pointer (desktop only; coarse pointers get ambient breath alone). Mapped to
    // the canvas rect so it tracks wherever the Stain sits in the layout, and passive so it never blocks scroll.
    const onMove = (e: PointerEvent) => {
      const s = sim.current; if (!s) return;
      const r = canvas.getBoundingClientRect(); if (r.width === 0) return;
      s.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    if (tier === "desktop") window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      sim.current?.dispose(); sim.current = null; onSim?.(null);
    };
  }, []); // mount-once by design, same as the lazy tier pick above; onSim is a stable setState from the caller

  useEffect(() => { sim.current?.setPigment(pigment); }, [pigment]);
  useEffect(() => { sim.current?.setAmplitude(amplitude); }, [amplitude]);
  useEffect(() => { sim.current?.setState(state); }, [state]);

  if (tier === "reduced") {
    // Settled ink that breathes by opacity only (DESIGN reduced-motion rule). No printing, no sim.
    return <div aria-hidden className="absolute inset-0 -z-10 flex items-center justify-center"
      style={{ animation: "ink-in 2400ms ease-in-out infinite alternate" }}>
      <img src={sigil} alt="" className="w-40 opacity-30" style={{ filter: state === "dormant" ? "grayscale(1)" : "none" }} />
    </div>;
  }
  return <canvas ref={ref} aria-hidden className="absolute inset-0 -z-10 h-full w-full" />;
}
