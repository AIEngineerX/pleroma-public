import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { resolveApiBase } from "../config";
import { fetchDreams } from "./dreamsClient";
import type { DreamArchiveEntry } from "../state/types";
import { copy } from "../lib/copy";
import { scrollToId } from "../lib/smoothScroll";

// The room the Plates were missing (PLANNING): the full archive of DREAM's nightly Plates, each the day's
// kept marks returned "as gods you have not met" (DOCTRINE II.5). Dynamic (fetched from /api/dreams), so
// it can't be prerendered like the DOCTRINE Canon — it grows a Plate a night. Lives at /canon/dreams so it
// never collides with /canon/dream (the DREAM doctrine article). Each Plate anchors on its rite date, so
// /canon/dreams#YYYY-MM-DD is its permalink.
const API_BASE = resolveApiBase(import.meta.env);
const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
function caption(d: DreamArchiveEntry): string {
  if (d.video_key) return "plate printed";
  return d.status === "rendering" ? "plate printing" : "plate pending";
}

// Video windowing. The archive grows a Plate a night and keeps every loaded <li> mounted (the pager
// appends, never replaces), so attaching a live <video src> to each would let a deep-paging visitor
// buffer dozens or hundreds of clips at once — a real, unbounded mobile-memory drain over time. Each
// plate attaches its <video> only while it is near the viewport (IntersectionObserver + a rootMargin
// lead-in) and drops it when scrolled well past, releasing the decoder and buffer. The aspect-ratio
// box holds its space either way, so layout and the permalink scroll stay stable. Resident media is
// thus bounded to what is roughly on screen, independent of how large the archive has grown.
function PlateVideo({ videoKey, narrative }: { videoKey: string; narrative: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") { setNear(true); return; } // no IO (e.g. SSR): show it
    // A generous lead-in so a plate is already attached by the time it scrolls in (no pop-in), while a
    // deep archive still only ever holds a small window of clips resident — bounded, not the whole list.
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="dream-plate__media mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden">
      {near && (
        <video className="w-full h-full object-cover" src={`${API_BASE}/api/${videoKey}`}
          loop muted playsInline controls aria-label={narrative} />
      )}
    </div>
  );
}

export default function DreamArchive() {
  const location = useLocation();
  const [entries, setEntries] = useState<DreamArchiveEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchDreams(API_BASE, cursor);
      setEntries(prev => (cursor ? [...prev, ...page.entries] : page.entries));
      setNext(page.next);
      setLoaded(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  // Each Plate anchors on its rite date and /canon/dreams#YYYY-MM-DD is its advertised permalink,
  // but entries arrive async after mount and Lenis eats a native fragment jump — so scroll to the
  // dated plate ourselves once it is in the DOM (react-router does no hash scrolling of its own).
  // A second scroll after the Plates' media has had a beat to lay out catches the layout shift that
  // would otherwise leave a one-shot jump short of a plate whose video only just sized itself.
  useEffect(() => {
    const date = location.hash.slice(1);
    if (date === "") return;
    if (entries.some((entry) => entry.rite_date === date)) {
      scrollToId(date);
      const settle = window.setTimeout(() => scrollToId(date), 400);
      return () => window.clearTimeout(settle);
    }
    if (next !== null && !loading) {
      void load(next); // keep paging until the dated plate loads or the archive is exhausted
    }
  }, [location.hash, entries, next, loading, load]);

  return (
    <main className="mx-auto max-w-[60ch] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded">
        <Link to="/canon" className="no-underline text-ink-faded">THE CANON</Link> · {copy.dreamHeading}
      </p>
      <h1 className="text-ink text-2xl mt-2 mb-5">The Dreams</h1>
      <p className="text-ink mb-12 max-w-[52ch]">{copy.dreamArchiveIntro}</p>

      {loaded && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.dreamEmpty}</p>
      )}

      {failed && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">
          {copy.archiveUnreachable}{" "}
          <button onClick={() => void load(null)} disabled={loading}
            className="underline temple-link-quiet disabled:opacity-50">{copy.archiveRetry}</button>
        </p>
      )}

      <ol className="space-y-14">
        {entries.map(d => (
          <li key={d.id} id={d.rite_date} className="flex flex-col items-center text-center gap-3 scroll-mt-10">
            <figure className="dream-plate w-full max-w-[52ch]">
              {d.video_key ? (
                <PlateVideo videoKey={d.video_key} narrative={d.narrative} />
              ) : (
                <div className="dream-plate__media aspect-video overflow-hidden flex items-center">
                  <p className="font-liturgy italic text-rubric-body text-lg leading-relaxed">{d.narrative}</p>
                </div>
              )}
              <figcaption className="font-machine text-xs text-ink-faded pt-2">
                <Link to={{ hash: d.rite_date }} className="no-underline text-ink-faded">
                  DREAM · {d.rite_date} · {caption(d)}
                </Link>
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
              className="min-h-11 inline-flex items-center font-machine text-xs text-ink-faded underline underline-offset-4 temple-link-quiet"
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
