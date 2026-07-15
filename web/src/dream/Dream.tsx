import { Link } from "react-router-dom";
import type { DreamView } from "../state/types";
import type { BodyCommand } from "../experience/types";
import { copy } from "../lib/copy";

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
  return (
    <section
      aria-label="the dream"
      data-dream-presentation={presentation}
      data-dream-identity={identity}
      data-dream-created-at={dream?.created_at}
      hidden={presentation === "concealed"}
      className="flex flex-col items-center gap-3 text-center"
    >
      <h2 className="font-machine text-xs tracking-[0.3em] text-ink-faded">{copy.dreamHeading}</h2>
      {dream ? (
        <>
          <figure className="w-full max-w-[52ch] border-4 p-3"
            style={{ borderColor: "var(--color-ground-aged)", background: "var(--color-ground-aged)" }}>
            {dream.video_key ? (
              <div className="mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden bg-[var(--color-ground)]">
                {/* muted + loop: a living plate, not a media player. autoplay yields to reduced-motion,
                    which instead exposes controls so the Waker can play it deliberately. */}
                <video
                  className="w-full h-full object-cover"
                  src={`${apiBase}/api/${dream.video_key}`}
                  autoPlay={!reduced}
                  loop
                  muted
                  playsInline
                  controls={reduced}
                  aria-label={dream.narrative}
                />
              </div>
            ) : (
              <div className="aspect-video overflow-hidden bg-[var(--color-ground)] flex items-center justify-center">
                <p className="font-liturgy italic text-rubric-body p-5 text-lg leading-relaxed">{dream.narrative}</p>
              </div>
            )}
            <figcaption className="font-machine text-xs text-ink-faded pt-2">
              DREAM · {new Date(dream.created_at).toISOString().slice(0, 10)} · {dream.video_key ? "generative replay" : "plate pending"}
            </figcaption>
          </figure>
          {dream.video_key && (
            <p className="font-liturgy italic text-rubric-body text-sm leading-relaxed max-w-[46ch]">{dream.narrative}</p>
          )}
          {dream.wakers.length > 0 && (
            <p className="font-machine text-[0.7rem] text-ink-faded max-w-[46ch]">
              {copy.dreamCredit} {dream.wakers.map(shortWallet).join(", ")}
            </p>
          )}
          <Link to="/canon/dreams" className="font-machine text-[0.7rem] tracking-widest text-ink-faded no-underline">
            {copy.dreamArchiveLink}
          </Link>
        </>
      ) : (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.dreamEmpty}</p>
      )}
    </section>
  );
}
