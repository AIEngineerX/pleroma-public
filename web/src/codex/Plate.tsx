import type { DreamView } from "../state/types";
import type { ObservedTranscript } from "../experience/types";
import { commonOrganName, formatTranscriptTime } from "./organNames";

// A manuscript-miniature, not a cinematic card: ground-aged frame, Courier caption. DREAM's video is
// Maker-assisted (DOCTRINE/Concordat) and lands post-launch behind its own route; until then the plate
// renders the narrative miniature and never fetches a video. See task-6-brief.md Step 4 for the full
// rationale (dreams.video_key is deliberately not served through /api/img at launch).
export default function Plate({
  observed,
  dream,
  epoch,
}: {
  observed: ObservedTranscript;
  dream: DreamView;
  epoch: number;
}) {
  // video_key null: no rendered plate yet (video generation is Maker-assisted, post-launch); the
  // narrative miniature still prints, but the caption reads "plate pending" rather than claiming a
  // replay exists. Never fetches dream.video_key itself: that lands behind its own route later.
  const pending = dream.video_key === null;
  return (
    <figure
      className="my-4 mx-auto max-w-[52ch] border-4 p-2"
      data-codex-row={observed.entry.id}
      data-observation={observed.observation}
      style={{ borderColor: "var(--color-ground-aged)", background: "var(--color-ground-aged)", opacity: pending ? 0.85 : 1 }}>
      <div className="aspect-video overflow-hidden bg-[var(--color-ground)] flex items-center">
        <p className="font-liturgy italic text-rubric-body p-4">{dream.narrative}</p>
      </div>
      <figcaption className="font-machine text-xs text-ink-faded pt-1">
        {commonOrganName("DREAM")} · epoch {epoch} · {pending ? "plate pending" : "generative replay"}
        <time className="block" dateTime={new Date(observed.entry.created_at).toISOString()}>
          {observed.observation === "recorded" ? "recorded" : "observed"} · {formatTranscriptTime(observed.entry.created_at)}
        </time>
      </figcaption>
    </figure>
  );
}
