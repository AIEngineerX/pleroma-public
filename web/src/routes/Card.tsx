import { useCallback, useEffect, useRef, useState } from "react";
import { resolveApiBase } from "../config";
import { fetchCodex, isGodVoice } from "../codex/codexClient";
import type { TranscriptEntry } from "../state/types";
import { renderScriptureCard } from "../cardgen/scriptureCard";
import { copy } from "../lib/copy";

// The Card table: turn a real line the god has spoken into an illuminated red-letter card, on
// parchment, to carry off the page. Only genuine Codex lines appear here — the god's own registers.
// The card itself is the hero (rendered on load); the line-picker below is a scannable list, each
// entry a single truncated line, so it never becomes a wall of text.
const API_BASE = resolveApiBase(import.meta.env);

function shorten(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default function Card() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<TranscriptEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const render = useCallback(async (entry: TranscriptEntry) => {
    setSelected(entry);
    setBusy(true);
    try {
      const canvas = canvasRef.current;
      if (canvas) await renderScriptureCard(canvas, { text: entry.text, organ: entry.organ, register: entry.register, at: entry.created_at });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const page = await fetchCodex(API_BASE, null);
        const god = page.entries.filter(isGodVoice);
        setEntries(god);
        if (god.length) await render(god[0]); // the card is the hero — never an empty frame
      } catch { setFailed(true); }
    })();
  }, [render]);

  const shuffle = useCallback(() => {
    if (!entries.length) return;
    const others = entries.filter((e) => e.id !== selected?.id);
    const pool = others.length ? others : entries;
    void render(pool[Math.floor(Math.random() * pool.length)]);
  }, [entries, selected, render]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selected) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pleroma-${selected.organ.toLowerCase()}-${new Date(selected.created_at).toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [selected]);

  return (
    <main className="mx-auto max-w-[46rem] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded mb-4">
        <a href="/" className="no-underline text-ink-faded">THE TEMPLE</a> · {copy.cardTable.toUpperCase()}
      </p>
      <h1 className="font-liturgy text-2xl mb-2">{copy.cardTable}</h1>
      <p className="text-ink-faded text-sm mb-8">{copy.cardTableIntro}</p>

      {failed && <p className="font-machine text-xs text-ink-faded">{copy.cardTableUnreachable}</p>}

      {/* The card, the hero. */}
      <figure className="flex flex-col items-center gap-4">
        <canvas ref={canvasRef} aria-label="scripture card" className="w-full max-w-[22rem] border border-ink-faded" />
        <div className="flex gap-6 font-machine text-xs text-ink-faded">
          <button type="button" onClick={shuffle} disabled={!entries.length} className="underline temple-link-quiet disabled:opacity-45">
            {copy.cardTableShuffle}
          </button>
          <button type="button" onClick={download} disabled={busy || !selected} className="underline temple-link-quiet disabled:opacity-45">
            {busy ? copy.cardTableRendering : copy.cardTableDownload}
          </button>
        </div>
      </figure>

      {/* The picker: one truncated line each, scannable, never a wall. */}
      {entries.length > 0 && (
        <section className="mt-10">
          <p className="font-machine text-xs tracking-widest text-ink-faded mb-3">{copy.cardTablePick}</p>
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => render(e)}
                  className={`block w-full truncate text-left text-sm ${selected?.id === e.id ? "text-rubric-body" : "text-ink-faded"} temple-link-quiet`}
                  title={e.text}
                >
                  <span className="font-machine text-[0.7rem]">THE {e.organ}</span> · {shorten(e.text)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="doorways" className="mt-10 flex flex-wrap gap-5 font-machine text-xs text-ink-faded">
        <a href="/">{copy.returnTemple}</a>
        <a href="/canon">{copy.completeCanon}</a>
      </nav>
    </main>
  );
}
