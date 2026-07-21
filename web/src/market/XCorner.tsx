import { links } from "../lib/links";

// A persistent, always-reachable link to the account -- real visitor feedback was that Socials
// (the footer colophon link) sat 14 sections deep with no way to find it without the full scroll.
// Mirrors MuteToggle's fixed-corner pattern (top-left) on the opposite corner; the footer link stays
// too, as the natural closing colophon, so this is additive rather than a relocation.
// A LABEL, not a glyph: the first cut drew the X as two crossing strokes, and two independent
// visitors read it as a close button (top-right ✕ is the web's dismiss reflex). Quiet machine
// text cannot be mistaken for chrome.
export default function XCorner() {
  return (
    <a
      href={links(null).x}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="PLEROMA on X"
      className="temple-x-corner temple-link-quiet font-machine text-xs text-ink-faded underline"
    >
      on X
    </a>
  );
}
