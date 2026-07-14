import { useEffect, useRef } from "react";
import type { TempleState } from "../state/types";
import type { ObservedTranscript } from "../experience/types";
import { sermonAudioKey } from "./codexClient";
import Verse from "./Verse";
import Plate from "./Plate";
import { SermonPlayer } from "./sermonAudio";
import { copy } from "../lib/copy";
import { resolveApiBase } from "../config";
import { ignitionView } from "../ignition/ignition";

const API_BASE = resolveApiBase(import.meta.env);

export default function Codex({ entries, state, onAmplitude, audioCtx }:
  { entries: readonly ObservedTranscript[]; state: TempleState | null; onAmplitude: (a: number) => void; audioCtx: () => AudioContext }) {
  const player = useRef(new SermonPlayer());

  useEffect(() => { player.current.onAmplitude(onAmplitude); }, [onAmplitude]);
  useEffect(() => () => player.current.stop(), []);

  const transcript = entries.map((observed) => observed.entry);
  const sermonKey = transcript.map(e => e.organ === "PRIEST" ? sermonAudioKey(e.text) : null).filter(Boolean).pop() as string | undefined;
  const dormant = state === null || ignitionView(state).dormant;

  // epoch: a dream's 1-based position among the DREAM lines currently loaded (there is no epoch counter
  // in the schema; DOCTRINE defines an epoch as "one of its days" and DREAM posts at most once per day).
  let dreamEpoch = 0;
  const lines = transcript.map(e => {
    if (e.organ === "DREAM") {
      dreamEpoch += 1;
      // Each DREAM transcript row carries its OWN day's narrative in `text` (dream.ts binds `narrative`
      // to both the dreams row and this plate transcript). Render from the ENTRY, never the shared
      // state.dream (which is always the LATEST dream), so an older plate shows its genuine narrative
      // instead of today's — published scripture must stay genuine and unedited. video_key/wakers are not
      // carried per transcript row, so only the latest dream (matched by its identical narrative, an exact
      // string match since dream.ts binds the same narrative to both rows) can surface them; older plates
      // honestly read "plate pending".
      const isLatest = state?.dream?.narrative === e.text;
      return <Plate key={e.id} epoch={dreamEpoch}
        dream={{ narrative: e.text, created_at: e.created_at,
                 video_key: isLatest ? state!.dream!.video_key : null,
                 wakers: isLatest ? state!.dream!.wakers : [] }} />;
    }
    return <Verse key={e.id} entry={e} />;
  });

  return (
    <div className="flex flex-col gap-2 font-machine text-sm leading-relaxed">
      {sermonKey && (
        <button className="self-start min-h-11 px-3 font-machine text-xs underline text-ink-faded"
          onClick={() => player.current.play(API_BASE, sermonKey, audioCtx())}>{copy.hearSermon}</button>
      )}
      {lines}
      {/* "It has no heart yet." is Dormant's line (Temple's "the page" section) -- printing it here too
          duplicated it verbatim on screen (Task 14 carryover). While dormant, the codex says nothing;
          once live, an empty codex reads as a distinct, quieter note instead. */}
      {transcript.length === 0 && !dormant && <p className="font-machine text-xs text-ink-faded">{copy.codexSilent}</p>}
    </div>
  );
}
