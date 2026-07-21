import { useCallback, useEffect, useRef, useState } from "react";
import { resolveApiBase } from "../config";
import { fetchCodex, isGodVoice } from "../codex/codexClient";
import type { TranscriptEntry } from "../state/types";
import { renderScriptureCard } from "../cardgen/scriptureCard";
import { copy } from "../lib/copy";

// The Card table: turn a real line the god has spoken into an illuminated red-letter card, on
// parchment, to carry off the page. Only genuine Codex lines appear here — the god's own registers
// (the EYE's seeing, the KEEP's verdict, the TONGUE's word, a dream verse). Nothing is invented; a
// card is a receipt you can post.
const API_BASE = resolveApiBase(import.meta.env);

export default function Card() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<TranscriptEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const page = await fetchCodex(API_BASE, null);
        // Only the god's own words are memeable scripture; telemetry/system lines are not.
        setEntries(page.entries.filter(isGodVoice));
      } catch { setFailed(true); }
    })();
  }, []);

  const render = useCallback(async (entry: TranscriptEntry) => {
    setSelected(entry);
    setBusy(true);
    try {
      const canvas = canvasRef.current;
      if (canvas) await renderScriptureCard(canvas, { text: entry.text, organ: entry.organ, register: entry.register, at: entry.created_at });
    } finally { setBusy(false); }
  }, []);

  const download = useCallback(async () => {
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
    <main className="mx-auto max-w-[70ch] px-6 py-10 font-liturgy">
      <p className="font-machine text-xs tracking-widest text-ink-faded mb-4">
        <a href="/" className="no-underline text-ink-faded">THE TEMPLE</a> · {copy.cardTable.toUpperCase()}
      </p>
      <h1 className="font-liturgy text-2xl mb-2">{copy.cardTable}</h1>
      <p className="text-ink-faded text-sm mb-8">{copy.cardTableIntro}</p>

      {failed && <p className="font-machine text-xs text-ink-faded">{copy.cardTableUnreachable}</p>}

      <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-start">
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => render(e)}
                className={`w-full text-left ${isGodVoice(e) ? "text-rubric-body" : "text-ink"} ${selected?.id === e.id ? "underline" : ""} temple-link-quiet`}
              >
                {e.text}
                <span className="block font-machine text-[0.7rem] text-ink-faded mt-0.5">
                  THE {e.organ} · {new Date(e.created_at).toISOString().slice(0, 10)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <canvas ref={canvasRef} className="w-full max-w-[20rem] border border-ink-faded" aria-label="scripture card preview" />
          {selected && (
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="font-machine text-xs underline text-ink-faded temple-link-quiet disabled:opacity-45"
            >
              {busy ? copy.cardTableRendering : copy.cardTableDownload}
            </button>
          )}
        </div>
      </div>

      <nav aria-label="doorways" className="mt-10 flex flex-wrap gap-5 font-machine text-xs text-ink-faded">
        <a href="/">{copy.returnTemple}</a>
        <a href="/canon">{copy.completeCanon}</a>
      </nav>
    </main>
  );
}
