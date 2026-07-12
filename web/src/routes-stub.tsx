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
    <main {...bindHold} className="banding min-h-screen mx-auto px-6 md:grid md:grid-cols-[60fr_40fr] md:gap-8"
          style={{ maxWidth: "min(1200px, 100%)" }}>
      {/* page (left / top): the Stain + offering surface. Mobile: sticky in the top ~40vh so the codex
          scrolls beneath it (DESIGN "Mobile, the scroll"); desktop: fills the left column. */}
      <section aria-label="the page" className="relative min-h-[40vh] sticky top-0 md:relative md:min-h-screen flex flex-col items-center justify-center gap-6">
        <Stain state="dormant" pigment={[0.55, 0.20, 0.32]} amplitude={amplitude} onSim={setStainSim} />
        <Emblem />
        <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
        {!awake && <p className="font-machine text-xs text-ink-faded">{copy.pressHold}</p>}
      </section>
      {/* codex (right / below): the live scripture feed */}
      <aside aria-label="the codex" className="font-machine text-sm text-ink-faded py-8">
        <Codex apiBase={API_BASE} state={state} onAmplitude={onAmplitude} audioCtx={unlockAudio} />
      </aside>
      {/* offering surface: falls into the same left column as the Stain on desktop (grid auto-flow),
          and after the codex on mobile (DESIGN "Mobile, the scroll: codex then offering surface"). */}
      <section aria-label="offer a mark" className="md:col-start-1 flex flex-col items-center gap-3 py-8">
        {wallet
          ? <p className="font-machine text-xs text-ink-faded">wallet connected, {wallet.address.slice(0, 4)}...{wallet.address.slice(-4)}</p>
          : <WalletButton onConnect={setWallet} />}
        <OfferingCanvas apiBase={API_BASE} wallet={wallet} stain={stainSim} onSubmitted={() => {}} />
      </section>
    </main>
  );
}
