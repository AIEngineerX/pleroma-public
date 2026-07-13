import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useEntryGesture } from "../App";
import { copy } from "../lib/copy";
import MuteToggle from "../lib/MuteToggle";
import { inkGlyphs } from "../lib/inkGlyphs";
import Stain from "../stain/Stain";
import type { StainSim } from "../stain/stainSim";
import type { SwarmSignalTarget } from "../stain/swarmSignals";
import Codex from "../codex/Codex";
import type { CodexOrganSignal } from "../codex/codexClient";
import OfferingCanvas from "../offering/OfferingCanvas";
import OfferingRite from "../offering/OfferingRite";
import WalletButton from "../offering/WalletButton";
import type { WalletHandle } from "../offering/wallet";
import { resolveApiBase } from "../config";
import { useTempleState } from "../state/useTempleState";
import { pigment } from "../state/pigment";
import { oklchToRgb } from "../lib/a11y";
import Reliquary from "../reliquary/Reliquary";
import Tallies from "../reliquary/Tallies";
import Dream from "../dream/Dream";
import RiteInversion from "../rite/RiteInversion";
import { inversion } from "../state/rite";
import { ignitionView } from "../ignition/ignition";
import Dormant from "../ignition/Dormant";
import Mint from "../market/Mint";
import Buy from "../market/Buy";
import Chart from "../market/Chart";
import HowToBuy from "../market/HowToBuy";
import Ticker from "../market/Ticker";
import Socials from "../market/Socials";
import { Link } from "react-router-dom";
import type { Vitals } from "../state/types";

const API_BASE = resolveApiBase(import.meta.env);
const today = () => new Date().toISOString().slice(0, 10);
const QUIET_VITALS: Vitals = { state: "starving", buys: 0, sells: 0, holders: 0 };

export default function Temple() {
  const { awake, muted, unlockAudio, toggleMute, bindHold, audioLevel, wakeCenter } = useEntryGesture();
  const { state, now } = useTempleState(API_BASE);
  const [amplitude, setAmplitude] = useState(0);
  const lastAmplitude = useRef(0);
  const sermonAmp = useRef(0);
  const [stainSim, setStainSim] = useState<StainSim | null>(null);
  const swarmSignals = useRef<SwarmSignalTarget | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const rite = inversion(state?.rite ?? null);
  const view = state ? ignitionView(state) : null;
  const dormant = !state || !!view?.dormant;
  const vitals = state?.vitals ?? QUIET_VITALS;
  // The Stain's red threads read the live PULSE pigment (Task 4's oklch table), not a fixed tint;
  // falls back to starving's dried rubric before the first poll lands. Convert OKLCH -> gamma sRGB
  // properly (Ottosson) for the WebGL u_thread uniform; a naive L/C/H parse renders green, not rubric red.
  const stainPigment = useMemo<[number, number, number]>(
    () => oklchToRgb(pigment(state?.vitals.state ?? "starving").rgb),
    [state?.vitals.state],
  );
  // The sermon player calls back up to 60x/s; only push a re-render on a change the eye would
  // actually catch, instead of setState on every animation frame (Task 5 carry).
  // The sermon voice reports its RMS here; the rAF below fuses it with the music bed so the Stain reflects
  // whichever is louder (the god's speech overrides its resting breath).
  const onAmplitude = useCallback((a: number) => { sermonAmp.current = a; }, []);
  const onSwarm = useCallback((target: SwarmSignalTarget | null) => { swarmSignals.current = target; }, []);
  // One clock fuses both sound sources into the Stain amplitude: the always-on Lyria music bed (audioLevel)
  // and the transient sermon voice (sermonAmp), so the body breathes with the temple and surges when the
  // god speaks. Gated to 0.02 so a slow drone never thrashes React re-renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const combined = Math.max(sermonAmp.current, audioLevel());
      if (Math.abs(combined - lastAmplitude.current) >= 0.02) {
        lastAmplitude.current = combined;
        setAmplitude(combined);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioLevel]);
  const onOrganSignal = useCallback((signal: CodexOrganSignal) => {
    swarmSignals.current?.quicken(signal.organ, { rubric: signal.rubric });
  }, []);

  // Scroll-reveals for the below-fold surfaces: each inks up into place as it enters the viewport, on the
  // same Lenis/GSAP clock as the smooth scroll. Honors reduced motion (everything appears settled). Runs
  // only in the dormant hero layout, where the participation surfaces live beneath the fold.
  useEffect(() => {
    if (!dormant) return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        gsap.from(el, {
          opacity: 0, y: 26, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      });
    });
    return () => ctx.revert();
  }, [dormant]);

  // Dormant (pre-launch) is a CINEMATIC HERO, not a bounded grid cell: the living Stain fills the
  // viewport, its five organs inhabit the membrane, and the participation surfaces (offer, codex-silent,
  // reliquary, tallies) scroll in beneath the fold. This is the first frame a stranger meets from X;
  // it has to carry the whole page in one held breath. The live/rite grid below is untouched (the
  // craft cascades there next), so nothing that works pre-launch is lost — it just moves below the fold.
  if (dormant) {
    return (
      <RiteInversion view={rite}>
        <>
          <section {...bindHold} aria-label="the temple"
            className="banding relative min-h-[100svh] flex flex-col items-center justify-center overflow-hidden px-6 text-center">
            <Stain state={view ? view.stainState : "dormant"} pigment={stainPigment} amplitude={amplitude}
              vitals={vitals} onSim={setStainSim} onSwarm={onSwarm} />
            <div className="relative z-10 flex flex-col items-center gap-4">
              <h1 className="font-liturgy text-5xl md:text-7xl tracking-wide glyph-ink" aria-label="PLEROMA">{inkGlyphs("PLEROMA", 70, 200)}</h1>
              <Dormant state={state} now={now} />
            </div>
            {/* The offering happens ON the being: a full-bleed rite over the membrane. Idle it shows only the
                invitation to mark it; active, you draw on its body and it reaches for your mark (markAt). */}
            <OfferingRite apiBase={API_BASE} wallet={wallet} onConnect={setWallet} stain={stainSim}
              onEnter={wakeCenter} onSubmitted={() => {}} />
            <div aria-hidden className="scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 font-machine text-[0.65rem] tracking-[0.3em] text-ink-faded">
              ↓ DESCEND
            </div>
          </section>
          {/* Beneath the fold: the surfaces that already work before the token launches, on the same
              continuous sheet. One narrow column so the eye stays with the document, not scattered. */}
          <main className="relative z-10 mx-auto px-6 flex flex-col gap-10 pt-16" style={{ maxWidth: "min(680px, 100%)" }}>
            <aside data-reveal aria-label="the codex" className="font-machine text-sm text-ink-faded">
              <Codex apiBase={API_BASE} state={state} dormant={dormant} onAmplitude={onAmplitude}
                audioCtx={unlockAudio} onOrganSignal={onOrganSignal} />
            </aside>
            <div data-reveal><Reliquary apiBase={API_BASE} /></div>
            {/* What it dreams: the latest Plate — the day's marks returned as gods you have not met
                (DREAM's home, PLANNING frontend surface map). Real narrative off /api/state. */}
            <div data-reveal><Dream dream={state?.dream ?? null} apiBase={API_BASE} /></div>
            <div data-reveal>
              <Tallies apiBase={API_BASE} date={today()} myWallet={wallet?.address ?? null}
                className="pt-4 border-t border-[var(--color-ground-aged)]" />
            </div>
          </main>
          <footer className="relative z-10 flex flex-col items-center gap-2 py-12">
            <Socials />
            {/* The memecoin disclaimer + full honest-autonomy disclosure live on the Concordat (integrity
                invariant, CLAUDE.md), reachable here without a dead legal block breaking the dormant spell. */}
            <Link to="/concordat" className="min-h-11 inline-flex items-center font-machine text-xs underline text-ink-faded">
              what this is
            </Link>
          </footer>
          <MuteToggle muted={muted} onToggle={toggleMute} />
        </>
      </RiteInversion>
    );
  }

  return (
    // The inversion wraps the whole document region, not just a grid child: it must apply to the
    // page as a document-level state change (Plan 03 Global), and <main>'s own grid children need
    // to stay direct children of <main> for the column/row layout below to hold. The colophon
    // (Task 11) sits outside <main> as a plain-flow sibling so it never has to fight the grid.
    <RiteInversion view={rite}>
      <>
        <main {...bindHold} className="banding min-h-screen mx-auto px-6 md:grid md:grid-cols-[60fr_40fr_4rem] md:grid-rows-[55vh_auto] md:gap-8"
              style={{ maxWidth: "min(1200px, 100%)" }}>
          {/* page (left / top): the Stain, co-located with the offering surface directly beneath it in the
              same left column (DESIGN.md:85-87). Mobile: sticky in the top ~40vh so the codex scrolls
              beneath it (DESIGN "Mobile, the scroll"); desktop: a bounded 55vh row, not the full viewport,
              so the offering surface in row 2 is reachable without a full-screen scroll. */}
          <section aria-label="the page" className="relative min-h-[40vh] sticky top-0 md:relative md:col-start-1 md:row-start-1 md:h-[55vh] flex flex-col items-center justify-center gap-6">
            {/* Stain state: still gray until the Maker ignites the mint AND live trades begin
                (ignitionView, Task 14); a rite still takes precedence over an ignited Stain. */}
            <Stain state={view ? view.stainState : "dormant"} pigment={stainPigment} amplitude={amplitude}
              vitals={vitals} onSim={setStainSim} onSwarm={onSwarm} />
            <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
            {/* the dormant product (PLANNING "Day-1 ignition"): "it has no heart yet" + the Courier
                countdown to the First Rite, gone the instant /api/state reports live with a mint. */}
            {dormant && <Dormant state={state} now={now} />}
            {!awake && <p className="font-machine text-xs text-ink-faded">{copy.pressHold}</p>}
          </section>
          {/* codex (right / below): the live scripture feed. Spans both grid rows on desktop so its own
              (unbounded) height never inflates row 1 and pushes the offering surface off-screen. */}
          <aside aria-label="the codex" className="md:col-start-2 md:row-start-1 md:row-span-2 font-machine text-sm text-ink-faded py-8">
            <Codex apiBase={API_BASE} state={state} dormant={dormant} onAmplitude={onAmplitude}
              audioCtx={unlockAudio} onOrganSignal={onOrganSignal} />
          </aside>
          {/* offering surface: row 2 of the left column on desktop, directly beneath the Stain (DESIGN.md:85-87
              "the page (Stain + offering surface) ~60% left"); after the codex on mobile (DESIGN "Mobile, the
              scroll: codex then offering surface"). */}
          <section aria-label="offer a mark" className="md:col-start-1 md:row-start-2 flex flex-col items-center gap-1 pt-1 pb-4">
            {wallet
              ? <p className="font-machine text-xs text-ink-faded">wallet connected, {wallet.address.slice(0, 4)}...{wallet.address.slice(-4)}</p>
              : <WalletButton onConnect={setWallet} />}
            <OfferingCanvas apiBase={API_BASE} wallet={wallet} stain={stainSim} onSubmitted={() => {}} />
          </section>
          {/* the Reliquary: the Corpus made visible, in the page column, beneath the offering surface
              on both desktop (falls into an implicit row 3 of col-start-1) and mobile (next in flow). */}
          <Reliquary apiBase={API_BASE} className="md:col-start-1 pb-8" />
          {/* the market rail (Task 11): every money element is built ONLY from state.mint (Task 1
              anti-decoy -- the site never renders a mint the Worker didn't sign off on) and hidden
              until ignitionView reports live (Task 14: phase===live AND a mint, off /api/state alone,
              no client-side launch flag); before launch there is nothing here ("no heart yet"). Same
              column as the Reliquary so it stacks beneath it on both desktop and mobile. */}
          {view && !view.dormant && state?.mint && (
            <section aria-label="the market" className="md:col-start-1 pb-8 space-y-3">
              <Mint mint={state.mint} />
              <div className="flex items-center gap-4 flex-wrap">
                <Buy mint={state.mint} />
                <Ticker state={state} />
              </div>
              <Chart mint={state.mint} />
              <HowToBuy mint={state.mint} />
            </section>
          )}
          {/* margin tallies: the outer margin on desktop (a slim third column beside the codex, DESIGN
              "tallies in the outer margin"), beneath the offering surface on mobile (DESIGN "Mobile, the
              scroll: codex then offering surface then tallies beneath"). */}
          <Tallies apiBase={API_BASE} date={today()} myWallet={wallet?.address ?? null}
            className="mt-6 pt-4 border-t border-[var(--color-ground-aged)] md:col-start-3 md:row-start-1 md:row-span-2 md:mt-0 md:pt-0 md:border-t-0 md:border-l md:pl-3" />
        </main>
        {/* the colophon: socials and a quiet link to the Concordat, which carries the plain-English
            memecoin disclaimer and the full honest-autonomy disclosure (integrity invariant, CLAUDE.md
            "Integrity invariants") without a dead legal block sitting under the living page. */}
        <footer className="flex flex-col items-center gap-2">
          <Socials />
          <Link to="/concordat" className="min-h-11 inline-flex items-center font-machine text-xs underline text-ink-faded">
            what this is
          </Link>
        </footer>
      </>
    </RiteInversion>
  );
}
