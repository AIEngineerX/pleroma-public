import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
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

export function codexDisplayEntry(observed: ObservedTranscript): ObservedTranscript {
  if (observed.entry.organ !== "PRIEST" || sermonAudioKey(observed.entry.text) === null) return observed;
  return {
    ...observed,
    entry: { ...observed.entry, text: copy.sermonRecorded },
  };
}

export default function Codex({ entries, state, currentDreamRiteDate = null, onAmplitude, audioCtx, limit }:
  {
    entries: readonly ObservedTranscript[];
    state: TempleState | null;
    currentDreamRiteDate?: string | null;
    onAmplitude: (a: number) => void;
    audioCtx: () => AudioContext;
    limit?: number;
  }) {
  const player = useRef(new SermonPlayer());

  useEffect(() => { player.current.onAmplitude(onAmplitude); }, [onAmplitude]);
  useEffect(() => () => player.current.stop(), []);

  const transcript = entries.map((observed) => observed.entry);
  const sermonKey = transcript.map(e => e.organ === "PRIEST" ? sermonAudioKey(e.text) : null).filter(Boolean).pop() as string | undefined;
  const dormant = state === null || ignitionView(state).dormant;

  // The homepage teaser shows only the most recent `limit` entries (measured: the full feed was
  // 66% of the whole page's height, real visitor feedback that the site was "a huge scroll"). The
  // complete interleaved log lives at /canon/codex. sermonKey above still scans the FULL entries
  // so a sermon further back than the teaser window can still be heard. `entries` is oldest-first
  // (mergeNewest sorts ascending), so the most recent are the last `limit`, not the first.
  const shown = limit === undefined ? entries : entries.slice(-limit);

  // epoch: a dream's 1-based position among the DREAM lines currently loaded (there is no epoch counter
  // in the schema; DOCTRINE defines an epoch as "one of its days" and DREAM posts at most once per day).
  let dreamEpoch = 0;
  const lines = shown.map(source => {
    const observed = codexDisplayEntry(source);
    const e = observed.entry;
    if (e.organ === "DREAM") {
      dreamEpoch += 1;
      // Each DREAM transcript row carries its OWN day's narrative in `text` (dream.ts binds `narrative`
      // to both the dreams row and this plate transcript). Render from the ENTRY, never the shared
      // state.dream (which is always the LATEST dream), so an older plate shows its genuine narrative
      // instead of today's — published scripture must stay genuine and unedited. video_key/wakers are not
      // carried per transcript row, so only the row whose rite matches the current Dream's exact archive
      // identity can surface them. A missing or ambiguous archive identity leaves every historical row
      // honestly at "plate pending" rather than promoting duplicate narrative text.
      const isLatest = currentDreamRiteDate !== null
        && e.rite_id === currentDreamRiteDate
        && state?.dream?.narrative === e.text;
      return <Plate key={e.id} observed={observed} epoch={dreamEpoch}
        dream={{ narrative: e.text, created_at: e.created_at,
                 video_key: isLatest ? state!.dream!.video_key : null,
                 wakers: isLatest ? state!.dream!.wakers : [] }} />;
    }
    return <Verse key={e.id} observed={observed} />;
  });

  return (
    <div data-codex className="codex-flow min-w-0 font-machine text-sm leading-relaxed">
      {sermonKey && (
        <button className="min-h-11 px-0 font-machine text-xs underline text-ink-faded temple-link-quiet"
          onClick={() => player.current.play(API_BASE, sermonKey, audioCtx())}>{copy.hearSermon}</button>
      )}
      {lines}
      {/* "It has no heart yet." is Dormant's line (Temple's "the page" section) -- printing it here too
          duplicated it verbatim on screen (Task 14 carryover). While dormant, the codex says nothing;
          once live, an empty codex reads as a distinct, quieter note instead. */}
      {transcript.length === 0 && !dormant && <p className="font-machine text-xs text-ink-faded">{copy.codexSilent}</p>}
      {limit !== undefined && transcript.length > 0 && (
        <Link to="/canon/codex" className="font-machine text-xs text-ink-faded underline temple-link-quiet">
          {copy.codexArchiveLink}
        </Link>
      )}
    </div>
  );
}
