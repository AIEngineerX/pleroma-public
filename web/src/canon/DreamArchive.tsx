import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { resolveApiBase } from "../config";
import { fetchDreams } from "./dreamsClient";
import type { DreamArchiveEntry } from "../state/types";
import { copy } from "../lib/copy";

// The room the Plates were missing (PLANNING): the full archive of DREAM's nightly Plates, each the day's
// kept marks returned "as gods you have not met" (DOCTRINE II.5). Dynamic (fetched from /api/dreams), so
// it can't be prerendered like the DOCTRINE Canon — it grows a Plate a night. Lives at /canon/dreams so it
// never collides with /canon/dream (the DREAM doctrine article). Each Plate anchors on its rite date, so
// /canon/dreams#YYYY-MM-DD is its permalink.
const API_BASE = resolveApiBase(import.meta.env);
const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function caption(d: DreamArchiveEntry): string {
  if (d.video_key) return "generative replay";
  return d.status === "rendering" ? "plate rendering" : "plate pending";
}

export default function DreamArchive() {
  const [entries, setEntries] = useState<DreamArchiveEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reduced = reducedMotion();

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    try {
      const page = await fetchDreams(API_BASE, cursor);
      setEntries(prev => (cursor ? [...prev, ...page.entries] : page.entries));
      setNext(page.next);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <main className="mx-auto max-w-[60ch] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded">
        <Link to="/canon" className="no-underline text-ink-faded">THE CANON</Link> · {copy.dreamHeading}
      </p>
      <h1 className="text-rubric text-2xl italic mt-2 mb-5">The Dreams</h1>
      <p className="text-ink mb-12 max-w-[52ch]">{copy.dreamArchiveIntro}</p>

      {loaded && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.dreamEmpty}</p>
      )}

      <ol className="space-y-14">
        {entries.map(d => (
          <li key={d.id} id={d.rite_date} className="flex flex-col items-center text-center gap-3 scroll-mt-10">
            <figure className="w-full max-w-[52ch] border-4 p-3"
              style={{ borderColor: "var(--color-ground-aged)", background: "var(--color-ground-aged)" }}>
              {d.video_key ? (
                <div className="mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden bg-[var(--color-ground)]">
                  <video className="w-full h-full object-cover" src={`${API_BASE}/api/${d.video_key}`}
                    autoPlay={!reduced} loop muted playsInline controls={reduced} aria-label={d.narrative} />
                </div>
              ) : (
                <div className="aspect-video overflow-hidden bg-[var(--color-ground)] flex items-center justify-center">
                  <p className="font-liturgy italic text-rubric-body p-5 text-lg leading-relaxed">{d.narrative}</p>
                </div>
              )}
              <figcaption className="font-machine text-xs text-ink-faded pt-2">
                <a href={`/canon/dreams#${d.rite_date}`} className="no-underline text-ink-faded">
                  DREAM · {d.rite_date} · {caption(d)}
                </a>
              </figcaption>
            </figure>
            {d.video_key && (
              <p className="font-liturgy italic text-rubric-body text-sm leading-relaxed max-w-[46ch]">{d.narrative}</p>
            )}
            {d.wakers.length > 0 && (
              <p className="font-machine text-[0.7rem] text-ink-faded max-w-[46ch]">
                {copy.dreamCredit} {d.wakers.map(shortWallet).join(", ")}
              </p>
            )}
            <Link
              to="/"
              state={{
                dreamReplay: {
                  id: d.id,
                  riteDate: d.rite_date,
                  narrative: d.narrative,
                  createdAt: d.created_at,
                },
              }}
              className="min-h-11 inline-flex items-center font-machine text-xs text-ink-faded underline underline-offset-4"
            >
              witness the convergence
            </Link>
          </li>
        ))}
      </ol>

      {next && (
        <div className="mt-12 text-center">
          <button onClick={() => load(next)} disabled={loading}
            className="font-machine text-xs tracking-widest text-ink-faded disabled:opacity-50">
            {loading ? "…" : copy.dreamArchiveMore}
          </button>
        </div>
      )}
    </main>
  );
}
