import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// The being's ink bleeds between folios. On a real page navigation — a PATHNAME change, never a
// scroll-anchor hash jump within a page (so it fires only on the key doorways: Temple ↔ Canon ↔
// Concordat ↔ Catechism ↔ Card ↔ the archives) — a brief wash of the god's own ink (the --color-ink
// token, bloomed from an off-centre point so it reads as spreading ink, not a clean centred wipe)
// covers the instant route swap and dries away. It is silent, decorative (aria-hidden, pointer-events
// none), and under prefers-reduced-motion it never renders at all: the swap is an instant cut. The
// key on the element remounts it each navigation so the one-shot CSS animation replays every time.
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PageTransition() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  const [navigation, setNavigation] = useState(0);

  useEffect(() => {
    if (REDUCED || pathname === previous.current) {
      previous.current = pathname;
      return;
    }
    previous.current = pathname;
    setNavigation((count) => count + 1);
  }, [pathname]);

  if (REDUCED || navigation === 0) return null;
  return <div key={navigation} aria-hidden className="page-transition" />;
}
