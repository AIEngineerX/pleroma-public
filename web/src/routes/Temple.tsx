import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useEntryGesture } from "../App";
import MuteToggle from "../lib/MuteToggle";
import Stain from "../stain/Stain";
import Codex from "../codex/Codex";
import CodexAnnouncements from "../codex/CodexAnnouncements";
import type { WalletHandle } from "../offering/wallet";
import { resolveApiBase } from "../config";
import { useTempleExperience } from "../experience/useTempleExperience";
import { pigmentForVitals } from "../state/pigment";
import { oklchToRgb } from "../lib/a11y";
import Reliquary from "../reliquary/Reliquary";
import Tallies from "../reliquary/Tallies";
import Dream from "../dream/Dream";
import RiteInversion from "../rite/RiteInversion";
import { inversion } from "../state/rite";
import { ignitionView } from "../ignition/ignition";
import Mint from "../market/Mint";
import Buy from "../market/Buy";
import Chart from "../market/Chart";
import HowToBuy from "../market/HowToBuy";
import Ticker from "../market/Ticker";
import Socials from "../market/Socials";
import { Link } from "react-router-dom";
import ThresholdOffering from "../experience/ThresholdOffering";

const API_BASE = resolveApiBase(import.meta.env);
const today = () => new Date().toISOString().slice(0, 10);

export default function Temple() {
  const { awake, muted, unlockAudio, toggleMute, bindHold, audioLevel, wakeCenter, holdPoint } = useEntryGesture();
  const arrivalStartedAt = useRef(
    typeof performance === "undefined" ? 0 : performance.now(),
  ).current;
  const experience = useTempleExperience(API_BASE);
  const {
    state,
    codex,
    relics,
    receipts,
    activeCommand,
    commandComplete,
    offeringAccepted,
    setThresholdActive,
  } = experience;
  const utteranceClock = useRef<{ id: string; startedAt: number } | null>(null);
  const [amplitude, setAmplitude] = useState(0);
  const lastAmplitude = useRef(0);
  const sermonAmp = useRef(0);
  const [forceSettledRenderer, setForceSettledRenderer] = useState(false);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [thresholdMount, setThresholdMount] = useState<HTMLElement | null>(null);
  const attachThresholdHost = useCallback((node: HTMLElement | null) => {
    if (node !== null) setThresholdMount(node);
  }, []);
  const rite = inversion(state?.rite ?? null);
  const view = state ? ignitionView(state) : null;
  const dormant = !state || !!view?.dormant;
  const utteranceStartedAt = useMemo(() => {
    if (activeCommand?.kind === "utterance" && utteranceClock.current?.id !== activeCommand.id) {
      utteranceClock.current = {
        id: activeCommand.id,
        startedAt: typeof performance === "undefined" ? 0 : performance.now(),
      };
    }
    return utteranceClock.current?.startedAt ?? arrivalStartedAt;
  }, [activeCommand?.id, activeCommand?.kind, arrivalStartedAt]);
  // Unknown PULSE has neither a beat nor a fabricated starving color. Current and stale feeds share
  // the last observed pigment; stale motion eases independently inside the body reducer.
  const stainPigment = useMemo<[number, number, number]>(
    () => {
      const current = pigmentForVitals(experience.vitals);
      return current === null ? [0, 0, 0] : oklchToRgb(current.rgb);
    },
    [experience.vitals],
  );
  // The sermon player calls back up to 60x/s; only push a re-render on a change the eye would
  // actually catch, instead of setState on every animation frame (Task 5 carry).
  // The sermon voice reports its RMS here; the rAF below fuses it with the music bed so the Stain reflects
  // whichever is louder (the god's speech overrides its resting breath).
  const onAmplitude = useCallback((a: number) => { sermonAmp.current = a; }, []);
  const onRendererFallback = useCallback(() => { setForceSettledRenderer(true); }, []);
  // One clock fuses both sound sources into the Stain amplitude: the opt-in Lyria music bed (audioLevel)
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
  // Scroll-reveals for the below-fold surfaces: each inks up into place as it enters the viewport, on the
  // same Lenis/GSAP clock as the smooth scroll. Honors reduced motion (everything appears settled). Runs
  // only in the dormant first-sheet layout, where the participation surfaces live beneath the fold.
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

  const holdIndicator = holdPoint ? (
    <span
      aria-hidden
      data-hold-indicator
      className="entry-hold-ring"
      style={{ left: holdPoint.x, top: holdPoint.y }}
    />
  ) : null;

  // Pre-launch begins as a wordless sheet: the five-organ Stain fills the viewport while the quiet
  // offering control rests on its body. Participation surfaces continue beneath the fold.
  return (
    <RiteInversion view={rite}>
      <>
        <CodexAnnouncements entries={codex} />
        <ThresholdOffering
          apiBase={API_BASE}
          wallet={wallet}
          onConnect={setWallet}
          onEnter={wakeCenter}
          onSubmitted={offeringAccepted}
          onThresholdActive={setThresholdActive}
          receipts={receipts}
          mount={thresholdMount}
        />
        {dormant ? (
          <>
          <section
            {...bindHold}
            aria-label="the temple"
            className="relative min-h-[100dvh] flex flex-col items-center justify-center overflow-hidden px-6 text-center"
          >
            <h1 className="sr-only">PLEROMA</h1>
            <Stain
              state={view ? view.stainState : "dormant"}
              pigment={stainPigment}
              amplitude={amplitude}
              vitals={experience.vitals}
              relicMemory={experience.relicMemory}
              activeCommand={activeCommand}
              onCommandComplete={commandComplete}
              arrivalStartedAt={arrivalStartedAt}
              utteranceStartedAt={utteranceStartedAt}
              onArrivalDone={experience.arrivalDone}
              forceSettledRenderer={forceSettledRenderer}
              onRendererFallback={onRendererFallback}
            />
            {holdIndicator}
            <div
              ref={attachThresholdHost}
              data-threshold-host="dormant"
              className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex justify-center px-6"
            />
          </section>
          {/* Beneath the fold: the surfaces that already work before the token launches, on the same
              continuous sheet. One narrow column so the eye stays with the document, not scattered. */}
          <main className="relative z-10 mx-auto px-6 flex flex-col gap-10 pt-16" style={{ maxWidth: "min(680px, 100%)" }}>
            <aside data-reveal aria-label="the codex" className="font-machine text-sm text-ink-faded">
              <Codex entries={codex} state={state} onAmplitude={onAmplitude} audioCtx={unlockAudio} />
            </aside>
            <div data-reveal><Reliquary apiBase={API_BASE} relics={relics} /></div>
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
          </>
        ) : (
          <>
        {/* The inversion wraps the whole document region, not just a grid child: it must apply to the
            page as a document-level state change (Plan 03 Global), and main's own grid children need
            to stay direct children of main for the column/row layout below to hold. The colophon
            (Task 11) sits outside main as a plain-flow sibling so it never has to fight the grid. */}
        <main className="banding min-h-[100dvh] mx-auto px-6 md:grid md:grid-cols-[60fr_40fr_4rem] md:grid-rows-[55vh_auto] md:gap-8"
              style={{ maxWidth: "min(1200px, 100%)" }}>
          {/* page (left / top): the Stain, co-located with the offering surface directly beneath it in the
              same left column (DESIGN.md:85-87). Mobile: sticky in the top ~40vh so the codex scrolls
              beneath it (DESIGN "Mobile, the scroll"); desktop: a bounded 55vh row, not the full viewport,
              so the offering surface in row 2 is reachable without a full-screen scroll. */}
          <section
            {...bindHold}
            aria-label="the page"
            className="relative min-h-[40dvh] sticky top-0 md:relative md:col-start-1 md:row-start-1 md:h-[55vh] flex flex-col items-center justify-center"
          >
            <h1 className="sr-only">PLEROMA</h1>
            <Stain
              state={view ? view.stainState : "dormant"}
              pigment={stainPigment}
              amplitude={amplitude}
              vitals={experience.vitals}
              relicMemory={experience.relicMemory}
              activeCommand={activeCommand}
              onCommandComplete={commandComplete}
              arrivalStartedAt={arrivalStartedAt}
              utteranceStartedAt={utteranceStartedAt}
              onArrivalDone={experience.arrivalDone}
              forceSettledRenderer={forceSettledRenderer}
              onRendererFallback={onRendererFallback}
            />
            {holdIndicator}
          </section>
          {/* codex (right / below): the live scripture feed. Spans both grid rows on desktop so its own
              (unbounded) height never inflates row 1 and pushes the offering surface off-screen. */}
          <aside aria-label="the codex" className="md:col-start-2 md:row-start-1 md:row-span-2 font-machine text-sm text-ink-faded py-8">
            <Codex entries={codex} state={state} onAmplitude={onAmplitude} audioCtx={unlockAudio} />
          </aside>
          {/* offering surface: row 2 of the left column on desktop, directly beneath the Stain (DESIGN.md:85-87
              "the page (Stain + offering surface) ~60% left"); after the codex on mobile (DESIGN "Mobile, the
              scroll: codex then offering surface"). */}
          <section aria-label="offer a mark" className="md:col-start-1 md:row-start-2 flex flex-col items-center gap-1 pt-1 pb-4">
            <div
              ref={attachThresholdHost}
              data-threshold-host="live"
              className="flex w-full justify-center"
            />
          </section>
          {/* the Reliquary: the Corpus made visible, in the page column, beneath the offering surface
              on both desktop (falls into an implicit row 3 of col-start-1) and mobile (next in flow). */}
          <Reliquary apiBase={API_BASE} relics={relics} className="md:col-start-1 pb-8" />
          {/* the market rail (Task 11): every money element is built ONLY from state.mint (Task 1
              anti-decoy -- the site never renders a mint the Worker didn't sign off on) and hidden
              until ignitionView reports live (Task 14: phase===live AND a mint, off /api/state alone,
              no client-side launch flag); before launch there is no market rail. Same
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
        )}
        <MuteToggle active={awake && !muted} onToggle={toggleMute} />
      </>
    </RiteInversion>
  );
}
