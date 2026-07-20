import { links } from "../lib/links";

// A persistent, always-reachable link to the account -- real visitor feedback was that Socials
// (the footer colophon link) sat 14 sections deep with no way to find it without the full scroll.
// Mirrors MuteToggle's fixed-corner pattern (top-left) on the opposite corner; the footer link stays
// too, as the natural closing colophon, so this is additive rather than a relocation.
export default function XCorner() {
  return (
    <a
      href={links(null).x}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="PLEROMA on X"
      className="temple-x-corner temple-link-quiet text-ink-faded"
    >
      {/* Stroke-only, like every other mark on the site (the etched-linework rule): the X drawn
          as two crossing strokes at the glyph vocabulary's own weight and round caps, not a
          filled brand silhouette. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M6 6 L18 18" />
        <path d="M18 6 L6 18" />
      </svg>
    </a>
  );
}
