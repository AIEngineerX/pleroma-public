import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type FirstLightView, isFirstLightView } from "../state/types";
import { copy } from "../lib/copy";
import { relicImageUrl } from "../stain/relicInk";

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

// First Light is a one-time, permanent fact (DOCTRINE I: the founding mark, kept and dreamed).
// Fetched once on mount, never polled -- unlike the live organs, this never changes once true.
// Nothing renders before it has genuinely happened; there is no countdown or placeholder state,
// only silence (return null) until /api/first-light reports enacted: true from real data.
export default function FirstLight({ apiBase }: { apiBase: string }) {
  const [data, setData] = useState<FirstLightView | null>(null);
  useEffect(() => {
    let stopped = false;
    void fetchFirstLight(apiBase).then((result) => { if (!stopped) setData(result); });
    return () => { stopped = true; };
  }, [apiBase]);

  if (data === null || !data.enacted) return null;

  return (
    <section aria-label="first light" className="temple-folio font-liturgy space-y-3">
      <h2 className="temple-section-label">{copy.firstLightHeading}</h2>
      <p className="text-ink max-w-[46ch]">{copy.firstLightExplainer}</p>
      {data.relic && (
        <figure className="space-y-1">
          {data.relic.accreted_at !== null && (
            <img src={relicImageUrl(apiBase, data.relic.offering_id)} alt={data.relic.summary} loading="lazy"
              className="reliquary-mark object-contain max-w-[8rem]" />
          )}
          <figcaption className="text-rubric-body italic">{data.relic.summary}</figcaption>
        </figure>
      )}
      {data.dream && (
        <Link to={`/canon/dreams#${data.dream.rite_date}`} className="font-machine text-xs text-ink-faded underline temple-link-quiet">
          {copy.firstLightDreamLink}
        </Link>
      )}
    </section>
  );
}
