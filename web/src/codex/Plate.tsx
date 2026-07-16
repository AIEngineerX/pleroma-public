import type { DreamView } from "../state/types";
import type { ObservedTranscript } from "../experience/types";
import { formatTranscriptTime, organIdentity } from "./organNames";
import { Glyph } from "./glyphs";

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
      className="codex-entry codex-plate"
      data-codex-row={observed.entry.id}
      data-observation={observed.observation}
      data-plate-pending={pending ? "true" : "false"}>
      <figcaption className="codex-entry__margin font-machine text-ink-faded">
        <span className="codex-entry__identity"><Glyph organ="DREAM" />{organIdentity("DREAM")}</span>
        <span>epoch {epoch} · {pending ? "plate pending" : "plate printed"}</span>
        <time className="block" dateTime={new Date(observed.entry.created_at).toISOString()}>
          {observed.observation === "recorded" ? "recorded" : "observed"} · {formatTranscriptTime(observed.entry.created_at)}
        </time>
      </figcaption>
      <div className="codex-plate__image">
        <p className="font-liturgy italic text-rubric-body">{dream.narrative}</p>
      </div>
    </figure>
  );
}
