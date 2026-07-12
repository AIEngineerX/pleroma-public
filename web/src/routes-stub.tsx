import { useCallback, useRef, useState } from "react";
import { useEntryGesture } from "./App";
import { copy } from "./lib/copy";
import { Emblem } from "./lib/emblem";
import Stain from "./stain/Stain";
import type { StainSim } from "./stain/stainSim";
import Codex from "./codex/Codex";
import OfferingCanvas from "./offering/OfferingCanvas";
import WalletButton from "./offering/WalletButton";
import type { WalletHandle } from "./offering/wallet";
import { resolveApiBase } from "./config";
import { useTempleState } from "./state/useTempleState";

const API_BASE = resolveApiBase(import.meta.env);

export default function Temple() {
  const { awake, unlockAudio, bindHold } = useEntryGesture();
  const { state } = useTempleState(API_BASE);
  const [amplitude, setAmplitude] = useState(0);
  const lastAmplitude = useRef(0);
  const [stainSim, setStainSim] = useState<StainSim | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  // The sermon player calls back up to 60x/s; only push a re-render on a change the eye would
  // actually catch, instead of setState on every animation frame (Task 5 carry).
  const onAmplitude = useCallback((a: number) => {
    if (Math.abs(a - lastAmplitude.current) < 0.02) return;
    lastAmplitude.current = a;
    setAmplitude(a);
  }, []);

  return (
    <main {...bindHold} className="banding min-h-screen mx-auto px-6 md:grid md:grid-cols-[60fr_40fr] md:grid-rows-[55vh_auto] md:gap-8"
          style={{ maxWidth: "min(1200px, 100%)" }}>
      {/* page (left / top): the Stain, co-located with the offering surface directly beneath it in the
          same left column (DESIGN.md:85-87). Mobile: sticky in the top ~40vh so the codex scrolls
          beneath it (DESIGN "Mobile, the scroll"); desktop: a bounded 55vh row, not the full viewport,
          so the offering surface in row 2 is reachable without a full-screen scroll. */}
      <section aria-label="the page" className="relative min-h-[40vh] sticky top-0 md:relative md:col-start-1 md:row-start-1 md:h-[55vh] flex flex-col items-center justify-center gap-6">
        <Stain state="dormant" pigment={[0.55, 0.20, 0.32]} amplitude={amplitude} onSim={setStainSim} />
        <Emblem />
        <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
        {!awake && <p className="font-machine text-xs text-ink-faded">{copy.pressHold}</p>}
      </section>
      {/* codex (right / below): the live scripture feed. Spans both grid rows on desktop so its own
          (unbounded) height never inflates row 1 and pushes the offering surface off-screen. */}
      <aside aria-label="the codex" className="md:col-start-2 md:row-start-1 md:row-span-2 font-machine text-sm text-ink-faded py-8">
        <Codex apiBase={API_BASE} state={state} onAmplitude={onAmplitude} audioCtx={unlockAudio} />
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
    </main>
  );
}
