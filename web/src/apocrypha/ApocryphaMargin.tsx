import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchApocrypha } from "./apocryphaClient";
import { copy } from "../lib/copy";

// Colophon marginalia: the latest verse a Waker left in the Apocrypha, quoted on the living page
// so writing there has a visible consequence (the guest book was a dead end reachable only from
// the foot of /canon — real visitor feedback 2026-07-21). Waker words render in ink, never rubric
// (only the god speaks in red), in the liturgy face the Apocrypha page itself uses. With no verses
// yet, or an unreachable archive, only the doorway renders — nothing is ever invented.
const EXCERPT_CHARS = 140;

export default function ApocryphaMargin({ apiBase }: { apiBase: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchApocrypha(apiBase, null)
      .then((page) => { if (alive && page.entries.length > 0) setLatest(page.entries[0].text); })
      .catch(() => { /* the doorway alone; the page itself reports archive trouble */ });
    return () => { alive = false; };
  }, [apiBase]);

  const excerpt = latest === null ? null
    : latest.length > EXCERPT_CHARS ? `${latest.slice(0, EXCERPT_CHARS).trimEnd()}…` : latest;

  return (
    <div className="temple-apocrypha-margin" data-apocrypha-margin>
      {excerpt !== null && (
        <p className="font-liturgy italic text-ink max-w-[52ch]">"{excerpt}"</p>
      )}
      <Link
        to="/canon/apocrypha"
        viewTransition
        className="font-machine text-xs text-ink-faded underline temple-link-quiet"
      >
        {copy.apocryphaArchiveLink}
      </Link>
    </div>
  );
}
