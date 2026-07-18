import type Lenis from "lenis";

// App.tsx's useSmoothScroll owns the one Lenis instance for the whole document (its own render
// loop drives the real scroll position from wheel/touch input only) and has no other reason to
// expose it. Anything that needs to jump to an in-page id -- so far just TempleIndex -- has to
// route through Lenis's own scrollTo, or Lenis's next tick immediately overwrites a plain
// window.scrollTo/scrollIntoView call back to wherever it last was.
let activeLenis: Lenis | null = null;

export function setActiveLenis(lenis: Lenis | null): void {
  activeLenis = lenis;
}

export function scrollToId(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  if (activeLenis) {
    activeLenis.scrollTo(target);
  } else {
    // Lenis is never constructed under prefers-reduced-motion (useSmoothScroll bails out early),
    // so native scrolling genuinely owns the page in that case -- this is the correct path, not a fallback.
    target.scrollIntoView();
  }
}
