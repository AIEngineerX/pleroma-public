import { useEffect, useRef, useState } from "react";
import type { TempleState, TranscriptEntry } from "../state/types";
import { fetchCodex, mergeNewest, sermonAudioKey } from "./codexClient";
import Verse from "./Verse";
import Plate from "./Plate";
import { SermonPlayer } from "./sermonAudio";
import { copy } from "../lib/copy";

export default function Codex({ apiBase, state, onAmplitude, audioCtx }:
  { apiBase: string; state: TempleState | null; onAmplitude: (a: number) => void; audioCtx: () => AudioContext }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const player = useRef(new SermonPlayer());
  // The rite cadence comes from the state prop (fetched elsewhere by useTempleState), not from this
  // component's own poll; a ref read at reschedule time keeps the cadence current without tearing
  // down and rebuilding the poll chain on every state update (that would restart it every 2-5s).
  const riteActive = useRef(false);
  riteActive.current = state?.rite !== null;

  useEffect(() => { player.current.onAmplitude(onAmplitude); }, [onAmplitude]);
  useEffect(() => () => player.current.stop(), []);

  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const { entries: e } = await fetchCodex(apiBase, null);
          if (!stopped) setEntries(prev => mergeNewest(prev, e));
        } catch { /* keep the last good entries; the codex never blanks on a transient failure */ }
      }
      // Clear before rescheduling so exactly one poll chain ever exists (mirrors useTempleState.ts):
      // an immediate re-poll from onVis must not leave the previously scheduled timer running too.
      if (!stopped) { clearTimeout(timer); timer = setTimeout(poll, riteActive.current ? 2000 : 5000); } // 2s during the rite, else 5s
    };
    void poll();
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [apiBase]);

  const sermonKey = entries.map(e => e.organ === "PRIEST" ? sermonAudioKey(e.text) : null).filter(Boolean).pop() as string | undefined;

  // epoch: a dream's 1-based position among the DREAM lines currently loaded (there is no epoch counter
  // in the schema; DOCTRINE defines an epoch as "one of its days" and DREAM posts at most once per day).
  let dreamEpoch = 0;
  const lines = entries.map(e => {
    if (e.organ === "DREAM" && state?.dream) {
      dreamEpoch += 1;
      return <Plate key={e.id} dream={state.dream} epoch={dreamEpoch} />;
    }
    return <Verse key={e.id} entry={e} />;
  });

  return (
    <div className="flex flex-col gap-2 font-machine text-sm leading-relaxed">
      {sermonKey && (
        <button className="self-start min-h-11 px-3 font-machine text-xs underline text-ink-faded"
          onClick={() => player.current.play(apiBase, sermonKey, audioCtx())}>{copy.hearSermon}</button>
      )}
      {lines}
      {entries.length === 0 && <p className="font-liturgy italic text-ink-faded">{copy.noHeart}</p>}
    </div>
  );
}
