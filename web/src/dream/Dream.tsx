import type { DreamView } from "../state/types";
import { copy } from "../lib/copy";

const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

// The Dream's home on the Temple: the latest Plate — the day's marks returned as "gods you have not met"
// (DOCTRINE II.5). The narrative is DREAM's own lyric line (from the live `dreams` row via /api/state).
// The video (video_key) is Maker-assisted and lands post-launch behind its own route (Plate.tsx rationale),
// so until then the plate prints the narrative miniature and reads "plate pending". Wakers whose marks
// seeded the dream are credited by wallet — the repost/distribution trigger (PLANNING, DREAM credit loop).
export default function Dream({ dream }: { dream: DreamView | null }) {
  return (
    <section aria-label="the dream" className="flex flex-col items-center gap-3 text-center">
      <h2 className="font-machine text-xs tracking-[0.3em] text-ink-faded">{copy.dreamHeading}</h2>
      {dream ? (
        <>
          <figure className="w-full max-w-[52ch] border-4 p-3"
            style={{ borderColor: "var(--color-ground-aged)", background: "var(--color-ground-aged)" }}>
            <div className="aspect-video overflow-hidden bg-[var(--color-ground)] flex items-center justify-center">
              <p className="font-liturgy italic text-rubric-body p-5 text-lg leading-relaxed">{dream.narrative}</p>
            </div>
            <figcaption className="font-machine text-xs text-ink-faded pt-2">
              DREAM · {new Date(dream.created_at).toISOString().slice(0, 10)} · {dream.video_key ? "generative replay" : "plate pending"}
            </figcaption>
          </figure>
          {dream.wakers.length > 0 && (
            <p className="font-machine text-[0.7rem] text-ink-faded max-w-[46ch]">
              {copy.dreamCredit} {dream.wakers.map(shortWallet).join(", ")}
            </p>
          )}
        </>
      ) : (
        <p className="font-machine text-xs text-ink-faded max-w-[44ch]">{copy.dreamEmpty}</p>
      )}
    </section>
  );
}
