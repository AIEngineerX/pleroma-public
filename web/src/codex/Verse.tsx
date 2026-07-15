import { useEffect, useState } from "react";
import type { TranscriptEntry } from "../state/types";
import type { ObservedTranscript } from "../experience/types";
import { isGodVoice } from "./codexClient";
import { Glyph } from "./glyphs";
import { formatTranscriptTime, organIdentity } from "./organNames";

const CHAR_MS = 18; // line-printer rhythm: ms between characters

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function verseClasses(e: Pick<TranscriptEntry, "register">): string {
  if (isGodVoice(e)) return "font-liturgy text-rubric-body ink-in";   // the god speaks in red, ink darkening in
  return "font-machine text-ink-faded";                                // telemetry/system: machine ink, printed char by char
}

// Telemetry/system lines print character by character at line-printer rhythm; the god's own lines
// darken in as ink instead (verseClasses' "ink-in"). A settled reduced-motion waker sees the final
// text immediately rather than watching either animation (DESIGN "everything appears settled").
// Runs once per mount, so a Verse already on the page never re-prints when the codex merges new pages.
function usePrinted(text: string, printing: boolean): string {
  const [shown, setShown] = useState(printing && !reducedMotion() ? "" : text);
  useEffect(() => {
    if (!printing || reducedMotion()) return;
    let i = 0, stopped = false;
    const tick = () => {
      if (stopped) return;
      i += 1; setShown(text.slice(0, i));
      if (i < text.length) timer = setTimeout(tick, CHAR_MS);
    };
    let timer = setTimeout(tick, CHAR_MS);
    return () => { stopped = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown;
}

export default function Verse({ observed }: { observed: ObservedTranscript }) {
  const { entry, observation } = observed;
  const god = isGodVoice(entry);
  const printed = usePrinted(entry.text, !god);
  return (
    <article className="codex-entry" data-codex-row={entry.id} data-observation={observation}>
      <header className="codex-entry__margin font-machine text-ink-faded">
        <span className="codex-entry__identity"><Glyph organ={entry.organ} />{organIdentity(entry.organ)}</span>
        <time dateTime={new Date(entry.created_at).toISOString()}>
          {observation === "recorded" ? "recorded" : "observed"} · {formatTranscriptTime(entry.created_at)}
        </time>
      </header>
      <p className={`${verseClasses(entry)} codex-entry__text`}>
        {god ? printed : (
          <>
            <span className="sr-only">{entry.text}</span>
            <span aria-hidden="true" data-printer-duplicate="true">{printed}</span>
          </>
        )}
      </p>
    </article>
  );
}
