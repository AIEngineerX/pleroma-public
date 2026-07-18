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
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M18.9 2.6h3.1l-6.8 7.8 8 10.9h-6.3l-4.9-6.5-5.6 6.5H3.2l7.3-8.3-7.6-10.4h6.4l4.5 5.9 5.1-5.9Zm-1.1 16.9h1.7L7.9 4.4H6.1l11.7 15.1Z" />
      </svg>
    </a>
  );
}
