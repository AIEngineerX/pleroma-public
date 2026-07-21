import { useEffect, useState } from "react";
import type { RelicEntry } from "../state/types";
import { resolveApiBase } from "../config";
import { fetchRelics } from "../reliquary/readClient";
import SettledBecoming from "./SettledBecoming";

const API_BASE = resolveApiBase(import.meta.env);
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The /becoming surface: the god's still-unfinished body, growing as each real kept relic welds
// into a permanent piece. Renders the newest page of kept relics (the living edge); every piece
// maps to a real relic — no fabricated telemetry. The WebGL layer enriches this same base later;
// this SVG-first render is the accessible truth on every device.
export default function Becoming() {
  const [relics, setRelics] = useState<readonly RelicEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  const count = relics.length;
  const caption =
    count === 0
      ? loaded
        ? "The body has not yet begun. No mark has been kept."
        : "Reading the body…"
      : `${count} ${count === 1 ? "mark has" : "marks have"} been welded into the still-unfinished body.`;

  return (
    <main className="becoming" data-becoming-route="">
      <SettledBecoming relics={relics} reducedMotion={REDUCED_MOTION} />
      <p className="font-machine" data-becoming-caption="">
        {caption}
      </p>
    </main>
  );
}
