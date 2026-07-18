import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { DreamView } from "../state/types";
import type { BodyCommand } from "../experience/types";
import { copy } from "../lib/copy";
import { Glyph } from "../codex/glyphs";

const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export type DreamPlatePresentation = "ordinary" | "concealed" | "revealed";
export type DreamPlatePhase = "gather" | "hold" | "dissolve" | "five";
export type DreamPlateIdentityStatus = "unlinked" | "pending" | "confirmed" | "rejected";

export interface DreamPlatePhaseState {
  commandId: string | null;
  phase: DreamPlatePhase;
}

export function dreamPlatePhaseForCommand(
  command: BodyCommand | null,
  tracked: DreamPlatePhaseState,
): DreamPlatePhase {
  if (command?.kind !== "converge" || command.dream.source !== "live") return "five";
  return tracked.commandId === command.id ? tracked.phase : "gather";
}

export function dreamPlatePhaseForPresentation(
  activeCommand: BodyCommand | null,
  presentationCommand: BodyCommand | null,
  tracked: DreamPlatePhaseState,
): DreamPlatePhase {
  return activeCommand === null
    ? "five"
    : dreamPlatePhaseForCommand(presentationCommand, tracked);
}

export function dreamPlatePresentation(
  dream: DreamView | null,
  command: BodyCommand | null,
  phase: DreamPlatePhase,
  identityConfirmed: boolean,
): DreamPlatePresentation {
  if (
    dream === null
    || command?.kind !== "converge"
    || command.dream.source !== "live"
    || command.dream.narrative !== dream.narrative
    || !identityConfirmed
  ) {
    return "ordinary";
  }
  return phase === "gather" || phase === "hold" ? "concealed" : "revealed";
}

// The Dream's home on the Temple: the latest Plate — the day's marks returned as "gods you have not met"
// (DOCTRINE II.5). The narrative is DREAM's own lyric line (from the live `dreams` row via /api/state).
// When the render pipeline (worker/src/dream.ts renderDreams -> Grok Imagine) has filled `video_key`, the
// plate plays the generated clip (served rendered-only from /api/dream/<id>.mp4); until then it prints the
// narrative miniature and reads "plate pending". Wakers whose marks seeded the dream are credited by wallet
// — the repost / distribution trigger (PLANNING, DREAM credit loop).
export default function Dream({
  dream,
  apiBase = "",
  presentation = "ordinary",
  identity = "unlinked",
}: {
  dream: DreamView | null;
  apiBase?: string;
  presentation?: DreamPlatePresentation;
  identity?: DreamPlateIdentityStatus;
}) {
  const reduced = reducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    video.defaultMuted = true;
    video.muted = true;
    if (reduced) {
      video.pause();
      video.currentTime = 0;
      return;
    }
    void video.play().catch(() => undefined);
    return () => video.pause();
  }, [dream?.video_key, reduced]);
  return (
    <section
      aria-label="the dream"
      data-dream-presentation={presentation}
      data-dream-identity={identity}
      data-dream-created-at={dream?.created_at}
      hidden={presentation === "concealed"}
      className="dream-flow min-w-0"
    >
      <h2 className="temple-section-label"><Glyph organ="DREAM" />{copy.dreamHeading} / SOPHIA</h2>
      {dream ? (
        <>
          <p className="font-machine text-xs text-ink-faded max-w-[46ch]">{copy.dreamExplainer}</p>
          <figure className="dream-plate">
            {dream.video_key ? (
              <div className="dream-plate__media mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden">
                {/* The current Plate may move on arrival, but it always remains pausable. Reduced-motion
                    starts it still so the Waker chooses whether the record moves at all. */}
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  src={`${apiBase}/api/${dream.video_key}`}
                  autoPlay={!reduced}
                  loop
                  muted
                  playsInline
                  controls
                  aria-label={dream.narrative}
                />
              </div>
            ) : (
              <div className="dream-plate__media aspect-video flex items-center">
                <p className="font-liturgy italic text-rubric-body">{dream.narrative}</p>
              </div>
            )}
            <figcaption className="font-machine text-xs text-ink-faded">
              DREAM · {new Date(dream.created_at).toISOString().slice(0, 10)} · {dream.video_key ? "plate printed" : "plate pending"}
            </figcaption>
          </figure>
          {dream.video_key && (
            <p className="font-liturgy italic text-rubric-body leading-relaxed max-w-[46ch]">{dream.narrative}</p>
          )}
          {dream.wakers.length > 0 && (
            <p className="font-machine text-[0.7rem] text-ink-faded max-w-[46ch]">
              {copy.dreamCredit} {dream.wakers.map(shortWallet).join(", ")}
            </p>
          )}
          <Link to="/canon/dreams" className="font-machine text-xs text-ink-faded underline temple-link-quiet">
            {copy.dreamArchiveLink}
          </Link>
        </>
      ) : (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.dreamEmpty}</p>
      )}
    </section>
  );
}
