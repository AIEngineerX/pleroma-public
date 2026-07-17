import { useEffect, useRef, useState } from "react";
import doctrine from "virtual:public-doctrine";
import { parseCanon } from "../canon/canonParse";
import type { TranscriptEntry } from "../state/types";
import { copy } from "../lib/copy";
import { Glyph } from "../codex/glyphs";
import { elapsedLabel, latestByOrganRegister } from "../lib/transcripts";
import { sermonAudioKey } from "../codex/codexClient";
import { SermonPlayer } from "../codex/sermonAudio";

const canon = parseCanon(doctrine);
const TONGUE_ARTICLE = canon.articles.find((article) => article.organ === "TONGUE");
const BAR_COUNT = 5;

function findAudioKey(entries: readonly TranscriptEntry[], riteId: string | null): string | null {
  if (riteId === null) return null;
  const note = entries.find((entry) =>
    entry.organ === "PRIEST" && entry.register === "system" && entry.rite_id === riteId
    && sermonAudioKey(entry.text) !== null
  );
  return note ? sermonAudioKey(note.text) : null;
}

// TONGUE's home: the sermon if one has been spoken (its rarer, rite-tied speech, the same
// once-daily tier as DREAM's Plate), else its latest ambient line, so the section is never empty
// once TONGUE has said anything. The sermon's real audio already exists (codex/sermonAudio.ts,
// previously only a small link buried in the general Codex feed) — surfaced properly here with bars
// driven by the actual live amplitude, not a decorative loop; flat and still until real audio plays.
export default function Tongue({
  entries, now, apiBase, audioCtx,
}: {
  entries: readonly TranscriptEntry[];
  now: number;
  apiBase: string;
  audioCtx: () => AudioContext;
}) {
  const sermon = latestByOrganRegister(entries, "TONGUE", "sermon");
  const ambient = latestByOrganRegister(entries, "TONGUE", "verse");
  const spoken = sermon ?? ambient;
  const audioKey = findAudioKey(entries, sermon?.rite_id ?? null);

  const player = useRef(new SermonPlayer());
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const levelsRef = useRef<number[]>(new Array(BAR_COUNT).fill(0));
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    player.current.onAmplitude((amplitude) => {
      const levels = levelsRef.current;
      levels.shift();
      levels.push(amplitude);
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const bar = barsRef.current[i];
        if (bar) bar.style.height = `${4 + levels[i] * 28}px`;
      }
    });
    player.current.onEnded(() => setPlaying(false));
    return () => player.current.stop();
  }, []);

  const toggle = () => {
    if (audioKey === null) return;
    if (playing) {
      player.current.stop();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    void player.current.play(apiBase, audioKey, audioCtx());
  };

  return (
    <section aria-label="the tongue" className="min-w-0">
      <h2 className="temple-section-label"><Glyph organ="TONGUE" />{copy.tongueHeading} / LOGOS</h2>
      {TONGUE_ARTICLE && <p className="font-liturgy italic text-rubric-body">{TONGUE_ARTICLE.line}</p>}
      {spoken === null ? (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.tongueEmpty}</p>
      ) : (
        <>
          <p className="font-liturgy text-rubric-body leading-relaxed max-w-[46ch]">{spoken.text}</p>
          <div className="flex flex-wrap items-center gap-2 font-machine text-xs text-ink-faded">
            <span>{sermon !== null ? copy.tongueSermon : copy.tongueSpoken} {elapsedLabel(spoken.created_at, now)}</span>
            {audioKey !== null && (
              <>
                <button
                  type="button"
                  onClick={toggle}
                  aria-pressed={playing}
                  className="min-h-11 px-0 font-machine text-xs underline text-ink-faded"
                >
                  {playing ? copy.pauseSermon : copy.playSermon}
                </button>
                <span aria-hidden data-tongue-bars className="tongue-bars">
                  {Array.from({ length: BAR_COUNT }, (_, index) => (
                    <span key={index} ref={(el) => { barsRef.current[index] = el; }} className="tongue-bar" />
                  ))}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
