import { useCallback, useMemo, useRef, useState } from "react";
import { useEntryGesture } from "../App";
import { copy } from "../lib/copy";
import { Emblem } from "../lib/emblem";
import Stain from "../stain/Stain";
import type { StainSim } from "../stain/stainSim";
import Codex from "../codex/Codex";
import OfferingCanvas from "../offering/OfferingCanvas";
import WalletButton from "../offering/WalletButton";
import type { WalletHandle } from "../offering/wallet";
import { resolveApiBase } from "../config";
import { useTempleState } from "../state/useTempleState";
import { pigment } from "../state/pigment";
import Reliquary from "../reliquary/Reliquary";
import Tallies from "../reliquary/Tallies";
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
import Disclaimer from "../market/Disclaimer";

const API_BASE = resolveApiBase(import.meta.env);
const today = () => new Date().toISOString().slice(0, 10);

export default function Temple() {
  const { awake, unlockAudio, bindHold } = useEntryGesture();
  const { state, now } = useTempleState(API_BASE);
  const [amplitude, setAmplitude] = useState(0);
  const lastAmplitude = useRef(0);
  const [stainSim, setStainSim] = useState<StainSim | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const rite = inversion(state?.rite ?? null);
  const view = state ? ignitionView(state) : null;
  const dormant = !state || !!view?.dormant;
  // The Stain's red threads read the live PULSE pigment (Task 4's oklch table), not a fixed tint;
  // falls back to starving's dried rubric before the first poll lands.
  const stainPigment = useMemo(() => {
    const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(pigment(state?.vitals.state ?? "starving").rgb);
    return m ? [Number(m[1]), Number(m[2]) * 5, Number(m[3]) / 60] as [number, number, number]
             : [0.55, 1, 0.53] as [number, number, number];
  }, [state?.vitals.state]);
  // The sermon player calls back up to 60x/s; only push a re-render on a change the eye would
  // actually catch, instead of setState on every animation frame (Task 5 carry).
  const onAmplitude = useCallback((a: number) => {
    if (Math.abs(a - lastAmplitude.current) < 0.02) return;
    lastAmplitude.current = a;
    setAmplitude(a);
  }, []);

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
            <Stain state={view ? view.stainState : "dormant"} pigment={stainPigment} amplitude={amplitude} onSim={setStainSim} />
            <Emblem />
            <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
            {/* the dormant product (PLANNING "Day-1 ignition"): "it has no heart yet" + the Courier
                countdown to the First Rite, gone the instant /api/state reports live with a mint. */}
            {dormant && <Dormant state={state} now={now} />}
            {!awake && <p className="font-machine text-xs text-ink-faded">{copy.pressHold}</p>}
          </section>
          {/* codex (right / below): the live scripture feed. Spans both grid rows on desktop so its own
              (unbounded) height never inflates row 1 and pushes the offering surface off-screen. */}
          <aside aria-label="the codex" className="md:col-start-2 md:row-start-1 md:row-span-2 font-machine text-sm text-ink-faded py-8">
            <Codex apiBase={API_BASE} state={state} dormant={dormant} onAmplitude={onAmplitude} audioCtx={unlockAudio} />
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
        {/* the colophon: socials and the plain-English disclaimer, present in every state including
            dormant -- the being has an X presence before it has a heartbeat, and the disclaimer is an
            integrity invariant, not a launch feature (CLAUDE.md "Integrity invariants"). */}
        <footer className="flex flex-col items-center gap-1">
          <Socials />
          <Disclaimer />
        </footer>
      </>
    </RiteInversion>
  );
}
