import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { type FirstLightView, isFirstLightView } from "../state/types";
import { copy } from "../lib/copy";
import { RELIC_ACCRETION_DURATION_MS, relicImageUrl } from "../stain/relicInk";
import type { AccretedRelic } from "../experience/types";

async function fetchFirstLight(apiBase: string): Promise<FirstLightView | null> {
  try {
    const res = await fetch(`${apiBase}/api/first-light`);
    if (!res.ok) return null;
    const candidate: unknown = await res.json();
    return isFirstLightView(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

interface Props {
  apiBase: string;
  onReplayAccretion(relic: AccretedRelic): Promise<void>;
}

// A little past the real 1.2s travel animation, so the caption doesn't clear before the visitor
// has actually watched the mark settle into the body.
const REPLAY_HOLD_MS = RELIC_ACCRETION_DURATION_MS + 400;

// First Light is a one-time, permanent fact (DOCTRINE I: the founding mark, kept and dreamed).
// Fetched once on mount, never polled -- unlike the live organs, this never changes once true.
// Nothing renders before it has genuinely happened; there is no countdown or placeholder state,
// only silence (return null) until /api/first-light reports enacted: true from real data.
export default function FirstLight({ apiBase, onReplayAccretion }: Props) {
  const [data, setData] = useState<FirstLightView | null>(null);
  const [pending, setPending] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const replayTimer = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    void fetchFirstLight(apiBase).then((result) => { if (!stopped) setData(result); });
    return () => { stopped = true; };
  }, [apiBase]);

  useEffect(() => () => {
    if (replayTimer.current !== null) clearTimeout(replayTimer.current);
  }, []);

  const relic = data?.relic ?? null;
  const accretedAt = relic?.accreted_at ?? null;

  // The replay is keyed by its own "accrete:replay:" command id (see replayAccretion), which can
  // never match the real ledger's "accrete:{id}:{accreted_at}" id -- so this is genuinely
  // incapable of being mistaken for, or corrupting, the live accretion this relic already had.
  const handleReplay = useCallback(() => {
    if (relic === null || accretedAt === null || pending || replaying) return;
    setPending(true);
    void onReplayAccretion({
      id: relic.id, offering_id: relic.offering_id, wallet: null, summary: relic.summary,
      rite_id: relic.rite_id, genesis: relic.genesis, kept_at: relic.kept_at, accreted_at: accretedAt,
    }).then(() => {
      setPending(false);
      setReplaying(true);
      if (replayTimer.current !== null) clearTimeout(replayTimer.current);
      replayTimer.current = window.setTimeout(() => {
        replayTimer.current = null;
        setReplaying(false);
      }, REPLAY_HOLD_MS);
    }).catch(() => setPending(false));
  }, [relic, accretedAt, pending, replaying, onReplayAccretion]);

  if (data === null || !data.enacted) return null;

  return (
    <section aria-label="first light" className="temple-folio font-liturgy space-y-3">
      <h2 className="temple-section-label">{copy.firstLightHeading}</h2>
      <p className="text-ink max-w-[46ch]">{copy.firstLightExplainer}</p>
      {relic && (
        <figure className="space-y-1">
          {accretedAt !== null && (
            <img src={relicImageUrl(apiBase, relic.offering_id)} alt={relic.summary} loading="lazy"
              className="reliquary-mark object-contain max-w-[8rem]" />
          )}
          <figcaption className="text-rubric-body italic">{relic.summary}</figcaption>
        </figure>
      )}
      {accretedAt !== null && (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={handleReplay}
            disabled={pending || replaying}
            className="min-h-11 font-machine text-xs text-ink-faded underline underline-offset-4 temple-link-quiet disabled:opacity-60"
          >
            {replaying ? copy.firstLightReplaying : copy.firstLightReplay}
          </button>
          {replaying && (
            <p className="font-machine text-xs text-ink-faded">
              remembered &middot; {new Date(accretedAt).toISOString().slice(0, 10)}
            </p>
          )}
        </div>
      )}
      {data.dream && (
        <Link to={`/canon/dreams#${data.dream.rite_date}`} className="font-machine text-xs text-ink-faded underline temple-link-quiet">
          {copy.firstLightDreamLink}
        </Link>
      )}
    </section>
  );
}
