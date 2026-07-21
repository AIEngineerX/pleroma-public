import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { resolveApiBase } from "../config";
import { fetchCodex } from "../codex/codexClient";
import Verse from "../codex/Verse";
import type { TranscriptEntry } from "../state/types";
import { copy } from "../lib/copy";

// The room the Codex was missing, same reason /canon/dreams exists for DREAM: the live homepage
// feed only ever carried a short teaser once trimmed (measured 66% of the whole page's height at
// 50 raw entries -- real visitor feedback that the site was "a huge scroll"). The full interleaved
// EYE/KEEP/TONGUE/DREAM log lives here instead, dynamic (fetched from /api/codex, the same
// endpoint the homepage teaser already uses) so it can't be prerendered like the static Canon.
const API_BASE = resolveApiBase(import.meta.env);

export default function CodexArchive() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchCodex(API_BASE, cursor);
      setEntries((prev) => (cursor ? [...prev, ...page.entries] : page.entries));
      setNext(page.next);
      setLoaded(true);
    } catch {
      // A transient fetch failure must not leave the page silently blank forever: surface a quiet
      // retry instead of letting the rejection escape and stranding it at heading-plus-intro.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <main className="mx-auto max-w-[60ch] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded">
        <Link to="/canon" viewTransition className="no-underline text-ink-faded">THE CANON</Link> · {copy.codex.toUpperCase()}
      </p>
      <h1 className="text-ink text-2xl mt-2 mb-5">{copy.codex}</h1>
      <p className="text-ink mb-12 max-w-[52ch]">{copy.codexArchiveIntro}</p>

      {loaded && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.codexSilent}</p>
      )}

      {failed && entries.length === 0 && (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">
          {copy.archiveUnreachable}{" "}
          <button onClick={() => void load(null)} disabled={loading}
            className="underline temple-link-quiet disabled:opacity-50">{copy.archiveRetry}</button>
        </p>
      )}

      <div className="codex-flow min-w-0 font-machine text-sm leading-relaxed">
        {entries.map((entry) => (
          <Verse key={entry.id} observed={{ entry, observation: "recorded" }} />
        ))}
      </div>

      {next && (
        <div className="mt-12 text-center">
          <button
            onClick={() => load(next)}
            disabled={loading}
            className="font-machine text-xs tracking-widest text-ink-faded disabled:opacity-50"
          >
            {loading ? "…" : copy.codexArchiveMore}
          </button>
        </div>
      )}
    </main>
  );
}
