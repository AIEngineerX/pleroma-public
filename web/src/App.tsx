import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Temple from "./routes/Temple";
import Canon from "./canon/Canon";
import DreamArchive from "./canon/DreamArchive";
import Concordat from "./canon/Concordat";
import { Ambient } from "./lib/ambient";
import {
  createPressHold,
  ENTRY_HOLD_MS,
  ENTRY_HOLD_SLOP_PX,
  type PressHold,
  type PressPoint,
} from "./entry/pressHold";

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

const INTERACTIVE_TARGETS = "button,a,input,textarea,select,summary,[role='button'],canvas";

function pointFromEvent(event: React.PointerEvent): PressPoint {
  const target = event.target;
  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    eligible:
      event.isPrimary &&
      event.button === 0 &&
      target instanceof Element &&
      !target.closest(INTERACTIVE_TARGETS),
  };
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const audioWindow = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

export function useEntryGesture() {
  const [awake, setAwake] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem("pleroma-muted") === "1"; } catch { return false; }
  });
  const [holdPoint, setHoldPoint] = useState<{ x: number; y: number } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const ambientRef = useRef<Ambient | null>(null);
  const ambientReadyRef = useRef(false);
  const controllerRef = useRef<PressHold | null>(null);
  const mountedRef = useRef(true);

  const setPlaybackState = useCallback((ambient: Ambient, playing: boolean) => {
    if (!mountedRef.current || ambientRef.current !== ambient) return;
    setAwake(playing);
    setMuted(ambient.isMuted());
  }, []);

  const primeAmbient = useCallback((): AudioContext | null => {
    if (!ambientReadyRef.current) {
      const Context = getAudioContextConstructor();
      let context: AudioContext | null = null;
      if (Context) {
        try { context = new Context(); } catch { context = null; }
      }
      ctxRef.current = context;
      ambientRef.current = new Ambient(ctxRef.current);
      ambientReadyRef.current = true;
    }
    if (ctxRef.current) void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const unlockAudio = useCallback((): AudioContext => {
    const context = primeAmbient();
    if (!context) throw new Error("Web Audio API unavailable");
    return context;
  }, [primeAmbient]);

  const wake = useCallback((x: number, y: number) => {
    document.documentElement.style.setProperty("--touch-x", String(x));
    document.documentElement.style.setProperty("--touch-y", String(y));
    primeAmbient();
    const ambient = ambientRef.current!;
    setMuted(ambient.isMuted());
    void ambient.start().then((playing) => setPlaybackState(ambient, playing));
  }, [primeAmbient, setPlaybackState]);

  const toggleMute = useCallback(() => {
    primeAmbient();
    const ambient = ambientRef.current!;
    if (awake && !ambient.isMuted()) {
      setMuted(ambient.toggleMute());
      return;
    }
    if (ambient.isMuted()) ambient.toggleMute();
    setMuted(false);
    setAwake(false);
    void ambient.start().then((playing) => setPlaybackState(ambient, playing));
  }, [awake, primeAmbient, setPlaybackState]);

  const audioLevel = useCallback(() => ambientRef.current?.level() ?? 0, []);
  const wakeCenter = useCallback(() => wake(0.5, 0.6), [wake]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = createPressHold({
      holdMs: ENTRY_HOLD_MS,
      slopPx: ENTRY_HOLD_SLOP_PX,
      onPrime: () => { primeAmbient(); },
      onPendingChange: (point) => setHoldPoint(point ? { x: point.x, y: point.y } : null),
      onCommit: (point) => wake(point.x / window.innerWidth, point.y / window.innerHeight),
    });
    controllerRef.current = controller;

    const onMove = (event: PointerEvent) => controller.move({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      eligible: true,
    });
    const onUp = (event: PointerEvent) => controller.up(event.pointerId);
    const onCancel = (event: PointerEvent) => controller.cancel(event.pointerId);
    const onLostCapture = (event: PointerEvent) => controller.cancel(event.pointerId);
    const onScroll = () => controller.scroll();

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    window.addEventListener("lostpointercapture", onLostCapture, { passive: true });
    window.addEventListener("wheel", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("wheel", onScroll);
      window.removeEventListener("scroll", onScroll);
      controller.dispose();
      controllerRef.current = null;
      ambientRef.current?.dispose();
      ambientRef.current = null;
      ambientReadyRef.current = false;
      const context = ctxRef.current;
      ctxRef.current = null;
      if (context && context.state !== "closed") void context.close();
    };
  }, [primeAmbient, wake]);

  const bindHold = {
    onPointerDown: (event: React.PointerEvent) => {
      controllerRef.current?.down(pointFromEvent(event));
    },
  };

  return { awake, muted, unlockAudio, toggleMute, bindHold, audioLevel, wakeCenter, holdPoint };
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
