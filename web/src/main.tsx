import { createRoot } from "react-dom/client";
import App from "./App";
// Self-hosted fonts (no Google CDN: no third-party request, no render-blocking stylesheet, no font flash).
import "@fontsource/gentium-book-plus/400.css";
import "@fontsource/gentium-book-plus/400-italic.css";
import "@fontsource/gentium-book-plus/700.css";
import "@fontsource/courier-prime/400.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

// Print-reveal: once the page has actually painted and the liturgy/machine fonts are ready, finish the
// preloader counter and lift the curtain so the temple "inks in" beneath it. A minimum dwell keeps the
// reveal from flashing on fast loads; index.html carries a failsafe that dismisses it if this never runs.
const w = window as unknown as {
  __plSet?: (v: number) => void; __plReveal?: () => void; __plTick?: number; __plFailsafe?: number;
};
const start = performance.now();
function reveal() {
  const el = document.getElementById("preload");
  if (!el || el.classList.contains("done")) return;
  w.__plSet?.(100);
  if (w.__plTick) clearInterval(w.__plTick);
  if (w.__plFailsafe) clearTimeout(w.__plFailsafe);
  el.classList.add("done");
  setTimeout(() => el.remove(), 1000);
}
w.__plReveal = reveal;
const fontsReady = (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
void fontsReady.then(() => {
  const wait = Math.max(0, 950 - (performance.now() - start));   // min dwell so the reveal reads as intentional
  setTimeout(() => requestAnimationFrame(reveal), wait);
});
