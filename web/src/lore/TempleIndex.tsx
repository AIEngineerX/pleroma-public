import { useEffect, useRef, useState } from "react";
import { copy } from "../lib/copy";
import { scrollToId } from "../lib/smoothScroll";

interface IndexEntry { href: string; label: string }

const ENTRIES: IndexEntry[] = [
  { href: "#codex", label: copy.codex },
  { href: "#eye", label: copy.eyeHeading },
  { href: "#reliquary", label: copy.reliquary },
  { href: "#tongue", label: copy.tongueHeading },
  { href: "#dream", label: copy.dreamHeading },
  { href: "#tallies", label: copy.tallies },
  { href: "#pulse", label: copy.pulseHeading },
];
const MARKET_ENTRY: IndexEntry = { href: "#market", label: "the market" };
const DOORWAY_ENTRIES: IndexEntry[] = [
  { href: "#catechism-doorway", label: copy.catechismDoorway },
  { href: "#canon-doorway", label: copy.completeCanon },
  { href: "#concordat-doorway", label: copy.concordatDoorway },
];

// A persistent way to jump around the one long scrolling document -- real visitor feedback was
// that reaching anything below the doctrine wall meant scrolling the whole page by hand. Native
// anchor links plus the site's existing global `scroll-behavior: smooth` do the actual scrolling;
// this is only a disclosure panel, never a scroll-orchestration engine of its own.
export default function TempleIndex({ marketLive }: { marketLive: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const entries = [...ENTRIES, ...(marketLive ? [MARKET_ENTRY] : []), ...DOORWAY_ENTRIES];

  return (
    <div ref={rootRef} className="temple-index">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="temple-index-panel"
        aria-label={open ? "close the index" : "find a section"}
        onClick={() => setOpen((o) => !o)}
        className="temple-index-trigger text-ink-faded temple-link-quiet"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none">
          <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <nav id="temple-index-panel" aria-label="jump to a section" data-open={open} className="temple-index-panel font-machine text-xs">
        <ol>
          {entries.map((e) => (
            <li key={e.href}>
              <a
                href={e.href}
                onClick={(event) => {
                  // Lenis (App.tsx's useSmoothScroll) owns the real scroll position from wheel/touch
                  // input only; a plain anchor jump or window.scrollTo gets overwritten on its next
                  // tick. Route through it directly -- see lib/smoothScroll.ts.
                  event.preventDefault();
                  scrollToId(e.href.slice(1));
                  setOpen(false);
                }}
                className="temple-link-quiet text-ink-faded"
              >
                {e.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
