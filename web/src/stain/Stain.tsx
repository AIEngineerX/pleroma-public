import { useEffect, useRef, useState } from "react";
import { pickTier, StainSim, type Tier } from "./stainSim";
import type { SwarmSignalTarget } from "./swarmSignals";
import type { Vitals } from "../state/types";

interface Props {
  state: "dormant" | "live" | "rite";
  pigment: [number, number, number];
  amplitude: number;
  vitals: Vitals;
  onSim?: (sim: StainSim | null) => void;
  onSwarm?: (swarm: SwarmSignalTarget | null) => void;
}

function SettledSwarm({ pigment }: { pigment: [number, number, number] }) {
  const rubric = `rgb(${pigment.map(channel => Math.round(channel * 255)).join(" ")})`;
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
      className="swarm-settled absolute inset-0 -z-10 h-full w-full">
      <g fill="none" stroke="currentColor" strokeWidth="0.18" opacity="0.28">
        <path d="M50 28 C61 31 69 39 70 50" />
        <path d="M70 50 C68 60 60 68 50 72" />
        <path d="M50 72 C39 69 31 61 30 50" />
        <path d="M30 50 C32 40 40 31 50 28" />
        <path d="M50 28 C55 43 57 56 50 72" opacity="0.5" />
      </g>
      <g fill="currentColor" opacity="0.7">
        <path d="M41 28 C45 23 55 23 60 28 C55 33 45 33 41 28 Z M47 28 A3 3 0 1 0 53 28 A3 3 0 1 0 47 28" />
        <path d="M65 43 C70 39 76 43 74 49 C78 54 72 59 67 56 C62 59 60 51 63 48 C61 46 62 44 65 43 Z" />
        <path d="M61 69 C64 61 68 58 72 62 C75 66 70 75 65 79 C65 74 64 71 61 69 Z" />
        <path d="M27 45 C31 40 38 43 37 49 C40 54 35 58 30 55 C25 58 22 51 25 48 C23 47 24 45 27 45 Z" />
        <path d="M29 63 C33 58 40 59 42 65 C39 72 33 76 27 74 C31 71 31 67 29 63 Z" />
      </g>
      <path d="M27 45 C31 40 38 43 37 49 C40 54 35 58 30 55 C25 58 22 51 25 48 C23 47 24 45 27 45 Z"
        fill={rubric} opacity="0.62" transform="translate(0.35 0)" />
    </svg>
  );
}

export default function Stain({ state, pigment, amplitude, vitals, onSim, onSwarm }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sim = useRef<StainSim | null>(null);
  const [tier] = useState<Tier>(pickTier); // lazy: pickTier runs ONCE, not on every (per-amplitude-frame) re-render
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (tier === "reduced" || !ref.current) return;   // reduced-motion: no GL context at all
    const canvas = ref.current;
    try {
      // ground = warm parchment; ink = iron-gall (dark warm brown-black) so the body reads as INK darkening
      // the page, not a gray wash. u_ink is subtracted from ground, so a large value = a deep stain.
      sim.current = new StainSim(canvas, { tier, ground: [0.94, 0.90, 0.80], ink: [0.74, 0.71, 0.64] });
      sim.current.start();
      onSim?.(sim.current);          // hand the instance up so an offering can wick into it (Task 8)
      onSwarm?.(sim.current);        // typed signal-only seam for Codex now, sound/intro later
    } catch { sim.current = null; setFailed(true); }           // WebGL2 unavailable -> settled ink fallback below
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
      sim.current?.dispose(); sim.current = null; onSim?.(null); onSwarm?.(null);
    };
  }, []); // mount-once by design, same as the lazy tier pick above; onSim is a stable setState from the caller

  useEffect(() => { sim.current?.setPigment(pigment); }, [pigment]);
  useEffect(() => { sim.current?.setAmplitude(amplitude); }, [amplitude]);
  useEffect(() => { sim.current?.setState(state); }, [state]);
  useEffect(() => { sim.current?.setVitals(vitals); }, [vitals]);

  if (tier === "reduced" || failed) {
    // Settled ink that breathes by opacity only (DESIGN reduced-motion rule). No printing, no sim.
    return <SettledSwarm pigment={pigment} />;
  }
  return <canvas ref={ref} data-organ-swarm={tier} aria-hidden className="absolute inset-0 -z-10 h-full w-full" />;
}
