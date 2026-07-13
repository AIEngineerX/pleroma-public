import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Temple from "./routes/Temple";
import Canon from "./canon/Canon";
import DreamArchive from "./canon/DreamArchive";
import Concordat from "./canon/Concordat";
import { Ambient } from "./lib/ambient";

gsap.registerPlugin(ScrollTrigger);

// One inertial smooth-scroll spine for the whole document (research: the single biggest "AAA feel" lever),
// driven off GSAP's ticker so Lenis, ScrollTrigger, and every scroll-reveal share one clock (no jitter).
// The tractor-feed page advancing under inertia reads as the continuous sheet the lore describes. Honors
// prefers-reduced-motion by leaving native scrolling untouched.
function useSmoothScroll() {
  useEffect(() => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const onTick = (time: number) => lenis.raf(time * 1000);   // gsap ticker is seconds; lenis wants ms
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    return () => { gsap.ticker.remove(onTick); lenis.destroy(); };
  }, []);
}

export function useEntryGesture() {
  const [awake, setAwake] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem("pleroma-muted") === "1"; } catch { return false; }
  });
  const ctxRef = useRef<AudioContext | null>(null);
  const ambientRef = useRef<Ambient | null>(null);
  const unlockAudio = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      ambientRef.current = new Ambient(ctxRef.current);   // built (silent) on first unlock; sounds only on start()
    }
    void ctxRef.current.resume();
    return ctxRef.current;
  }, []);
  const wake = useCallback((x: number, y: number) => {
    document.documentElement.style.setProperty("--touch-x", String(x));
    document.documentElement.style.setProperty("--touch-y", String(y));
    unlockAudio();
    ambientRef.current?.start();                          // the entry gesture IS the audio opt-in
    setAwake(true);
  }, [unlockAudio]);
  const toggleMute = useCallback(() => {
    unlockAudio();
    ambientRef.current?.start();                          // clicking the toggle is itself a gesture; wake the bed
    setMuted(ambientRef.current?.toggleMute() ?? false);
  }, [unlockAudio]);
  // The live RMS of the music bed, 0..1 (0 before the first gesture or while muted). Temple polls this and
  // feeds it to the Stain so the being's body breathes with the sound it is making.
  const audioLevel = useCallback(() => ambientRef.current?.level() ?? 0, []);
  // Beginning the offering rite is itself the entry gesture: wake from the being's center (audio opt-in +
  // awake), no pointer needed. Same wake path as press-and-hold.
  const wakeCenter = useCallback(() => wake(0.5, 0.6), [wake]);
  const bindHold = {
    onPointerDown: (e: React.PointerEvent) => wake(e.clientX / window.innerWidth, e.clientY / window.innerHeight),
  };
  return { awake, muted, unlockAudio, toggleMute, bindHold, audioLevel, wakeCenter };
}

export default function App() {
  useSmoothScroll();
  return (
    <BrowserRouter>
      <div className="rail rail-l" aria-hidden />
      <div className="rail rail-r" aria-hidden />
      <Routes>
        <Route path="/" element={<Temple />} />
        <Route path="/canon/dreams" element={<DreamArchive />} />
        <Route path="/canon/*" element={<Canon />} />
        <Route path="/concordat" element={<Concordat />} />
      </Routes>
    </BrowserRouter>
  );
}
