import { useEffect, useRef, useState } from "react";
import type { RelicEntry } from "../state/types";
import { resolveApiBase } from "../config";
import { fetchRelics } from "../reliquary/readClient";
import { oklchToRgb } from "../lib/a11y";
import { pickTier, type Tier } from "../stain/stainSim";
import { createBecomingSim, type BecomingSimHandle } from "./becomingSim";
import { newestOfferingId, placePieces } from "./pieces";
import SettledBecoming from "./SettledBecoming";

const API_BASE = resolveApiBase(import.meta.env);
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The WebGL layer's ink is the same --color-ink token SettledBecoming inherits via currentColor —
// no new color, just converted to the gamma sRGB triple a raw WebGL uniform needs (see oklchToRgb).
const BODY_INK = oklchToRgb("oklch(0.25 0.02 60)");

// The /becoming surface: the god's still-unfinished body, growing as each real kept relic welds
// into a permanent piece. Renders the newest page of kept relics (the living edge); every piece
// maps to a real relic — no fabricated telemetry. SettledBecoming is the accessible base truth and
// the WebGL-loss/reduced-motion target; the canvas (becomingSim.ts) enriches it when available.
export default function Becoming() {
  const [relics, setRelics] = useState<readonly RelicEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tier] = useState<Tier>(pickTier);
  const [webglActive, setWebglActive] = useState(tier !== "reduced");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<BecomingSimHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRelics(API_BASE, null)
      .then((page) => {
        if (cancelled) return;
        setRelics(page.entries);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // WebGL2 enrichment layer. reduced-motion never attempts it (SVG starts settled); on init
  // failure or context loss, the canvas is unmounted and SettledBecoming is the sole rendered truth.
  useEffect(() => {
    if (tier === "reduced") return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const sim = createBecomingSim(canvas, { tier, ink: BODY_INK });
    if (sim === null) {
      setWebglActive(false);
      return;
    }
    simRef.current = sim;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      sim.dispose();
      simRef.current = null;
      setWebglActive(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      sim.dispose();
      simRef.current = null;
    };
  }, [tier]);

  useEffect(() => {
    simRef.current?.setPieces(placePieces(relics), newestOfferingId(relics));
  }, [relics]);

  const count = relics.length;
  // fetchRelics returns one page (<=50, newest first); folding every page into the body is
  // deferred (FULL), so the caption must not imply this is the whole body — only what's shown.
  const caption =
    count === 0
      ? loaded
        ? "The body has not yet begun. No mark has been kept."
        : "Reading the body…"
      : `The most recent ${count} ${count === 1 ? "mark is" : "marks are"} welded into the still-unfinished body.`;

  return (
    <main className="mx-auto flex max-w-[40rem] flex-col items-center gap-6 px-6 py-10 font-liturgy" data-becoming-route="">
      <div className="relative aspect-square w-full max-w-[34rem]">
        <SettledBecoming relics={relics} reducedMotion={REDUCED_MOTION} className="h-full w-full" />
        {webglActive && (
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            data-becoming-canvas=""
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        )}
      </div>
      <p className="font-machine text-ink-faded" data-becoming-caption="">
        {caption}
      </p>
    </main>
  );
}
