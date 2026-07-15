import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import Dream, {
  dreamPlatePhaseForPresentation,
  dreamPlatePresentation,
  type DreamPlateIdentityStatus,
  type DreamPlatePhase,
  type DreamPlatePhaseState,
} from "../dream/Dream";
import {
  DreamPlateIdentityCache,
  dreamArchiveIdentityKey,
  dreamPlateIdentityKey,
  retryUnavailableDreamArchiveRite,
  retryUnavailableDreamPlateIdentity,
} from "../canon/dreamsClient";
import RiteInversion from "../rite/RiteInversion";
import { inversion } from "../state/rite";
import { ignitionView } from "../ignition/ignition";
import Mint from "../market/Mint";
import Buy from "../market/Buy";
import Chart from "../market/Chart";
import HowToBuy from "../market/HowToBuy";
import Ticker from "../market/Ticker";
import Socials from "../market/Socials";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ThresholdOffering from "../experience/ThresholdOffering";
import DreamWitness from "../experience/DreamWitness";
import { dreamReplayFromNavigationState } from "../experience/director";
import type { BodyCommand } from "../experience/types";
import TempleLore from "../lore/TempleLore";
import { copy } from "../lib/copy";

const API_BASE = resolveApiBase(import.meta.env);
const DREAM_PLATE_IDENTITIES = new DreamPlateIdentityCache();
const today = () => new Date().toISOString().slice(0, 10);
type LiveConvergenceCommand = Extract<BodyCommand, { kind: "converge" }>;

interface ConfirmedDreamPlate {
  key: string;
  command: LiveConvergenceCommand;
}

export default function Temple() {
  const location = useLocation();
  const navigate = useNavigate();
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
    replayDream,
    replayWitness,
  } = experience;
  const replayNavigation = useRef({
    handled: false,
    hadState: location.state !== null && location.state !== undefined,
    cue: dreamReplayFromNavigationState(location.state),
  });

  useLayoutEffect(() => {
    const replay = replayNavigation.current;
    if (replay.handled) return;
    replay.handled = true;
    if (replay.hadState) navigate(location.pathname, { replace: true, state: null });
    if (replay.cue !== null) replayDream(replay.cue);
  }, [location.pathname, navigate, replayDream]);
  const presentationClock = useRef<{ id: string; startedAt: number } | null>(null);
  const [amplitude, setAmplitude] = useState(0);
  const lastAmplitude = useRef(0);
  const sermonAmp = useRef(0);
  const [forceSettledRenderer, setForceSettledRenderer] = useState(false);
  const [seraphPhase, setSeraphPhase] = useState<DreamPlatePhaseState>({
    commandId: null,
    phase: "five",
  });
  const [plateIdentity, setPlateIdentity] = useState<{
    key: string | null;
    status: DreamPlateIdentityStatus;
  }>({ key: null, status: "unlinked" });
  const [currentDreamArchive, setCurrentDreamArchive] = useState<{
    key: string | null;
    riteDate: string | null;
  }>({ key: null, riteDate: null });
  const [confirmedPlate, setConfirmedPlate] = useState<ConfirmedDreamPlate | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [thresholdMount, setThresholdMount] = useState<HTMLElement | null>(null);
  const [receiptMount, setReceiptMount] = useState<HTMLElement | null>(null);
  const attachThresholdHost = useCallback((node: HTMLElement | null) => { setThresholdMount(node); }, []);
  const attachReceiptHost = useCallback((node: HTMLElement | null) => { setReceiptMount(node); }, []);
  const rite = inversion(state?.rite ?? null);
  const view = state ? ignitionView(state) : null;
  const plateDream = state?.dream ?? null;
  const currentDreamArchiveKey = plateDream === null
    ? null
    : dreamArchiveIdentityKey(plateDream);
  const currentDreamRiteDate = currentDreamArchive.key === currentDreamArchiveKey
    ? currentDreamArchive.riteDate
    : null;
  const liveConvergenceId = activeCommand?.kind === "converge"
    && activeCommand.dream.source === "live"
    ? activeCommand.id
    : null;
  const identityKey = dreamPlateIdentityKey(plateDream, activeCommand);
  const activeIdentityStatus: DreamPlateIdentityStatus = identityKey === null
    ? "unlinked"
    : plateIdentity.key === identityKey
      ? plateIdentity.status
      : "pending";
  const confirmedPlateIsCurrent = confirmedPlate !== null
    && dreamPlateIdentityKey(plateDream, confirmedPlate.command) === confirmedPlate.key;
  const presentationCommand = activeCommand ?? (
    confirmedPlateIsCurrent ? confirmedPlate.command : null
  );
  const identityStatus: DreamPlateIdentityStatus = activeCommand === null
    && confirmedPlateIsCurrent
    ? "confirmed"
    : activeIdentityStatus;
  const platePhase = dreamPlatePhaseForPresentation(
    activeCommand,
    presentationCommand,
    seraphPhase,
  );
  const platePresentation = dreamPlatePresentation(
    plateDream,
    presentationCommand,
    platePhase,
    identityStatus === "confirmed",
  );
  useLayoutEffect(() => {
    setSeraphPhase((current) => {
      if (liveConvergenceId === null) return current;
      return current.commandId === liveConvergenceId
        ? current
        : { commandId: liveConvergenceId, phase: "gather" };
    });
  }, [liveConvergenceId]);
  useEffect(() => {
    if (plateDream === null || currentDreamArchiveKey === null) {
      setCurrentDreamArchive((current) => current.key === null && current.riteDate === null
        ? current
        : { key: null, riteDate: null });
      return;
    }
    const controller = new AbortController();
    setCurrentDreamArchive((current) => current.key === currentDreamArchiveKey
      ? current
      : { key: currentDreamArchiveKey, riteDate: null });
    void retryUnavailableDreamArchiveRite(
      () => DREAM_PLATE_IDENTITIES.identifyCurrentRite(API_BASE, plateDream),
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setCurrentDreamArchive({
        key: currentDreamArchiveKey,
        riteDate: result.status === "confirmed" ? result.riteDate : null,
      });
    });
    return () => { controller.abort(); };
  }, [currentDreamArchiveKey]);
  useEffect(() => {
    if (identityKey === null) {
      setPlateIdentity((current) => current.key === null && current.status === "unlinked"
        ? current
        : { key: null, status: "unlinked" });
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    setPlateIdentity((current) => current.key === identityKey && current.status === "pending"
      ? current
      : { key: identityKey, status: "pending" });
    void retryUnavailableDreamPlateIdentity(
      () => DREAM_PLATE_IDENTITIES.confirm(API_BASE, plateDream, activeCommand),
      controller.signal,
    ).then((result) => {
      if (disposed || controller.signal.aborted) return;
      setPlateIdentity({
        key: identityKey,
        status: result === "confirmed"
          ? "confirmed"
          : result === "mismatch"
            ? "rejected"
            : "pending",
      });
      if (
        result === "confirmed"
        && plateDream !== null
        && activeCommand?.kind === "converge"
        && activeCommand.dream.source === "live"
      ) {
        setConfirmedPlate({
          key: identityKey,
          command: activeCommand,
        });
      }
    });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [identityKey]);
  const presentationStartedAt = useMemo(() => {
    if (activeCommand !== null && presentationClock.current?.id !== activeCommand.id) {
      presentationClock.current = {
        id: activeCommand.id,
        startedAt: typeof performance === "undefined" ? 0 : performance.now(),
      };
    }
    return presentationClock.current?.startedAt ?? arrivalStartedAt;
  }, [activeCommand?.id, arrivalStartedAt]);
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
  const onSeraphPhaseChange = useCallback((commandId: string, phase: DreamPlatePhase) => {
    setSeraphPhase((current) => (
      current.commandId === commandId && current.phase === phase
        ? current
        : { commandId, phase }
    ));
  }, []);
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
  const holdIndicator = holdPoint ? (
    <span
      aria-hidden
      data-hold-indicator
      className="entry-hold-ring"
      style={{ left: holdPoint.x, top: holdPoint.y }}
    />
  ) : null;

  // One stable document serves every state. API resolution changes its facts, never its body,
  // threshold, Codex, or reading position.
  return (
    <RiteInversion view={rite}>
      <div className="temple-document">
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
          receiptMount={receiptMount}
        />

        <main className="temple-sheet" data-temple-spread>
          <h1 className="sr-only">PLEROMA</h1>
          <section
            {...bindHold}
            aria-label="the temple"
            data-body-page
            className="temple-body-page"
          >
            <Stain
              state={view ? view.stainState : "dormant"}
              pigment={stainPigment}
              amplitude={amplitude}
              vitals={experience.vitals}
              relicMemory={experience.relicMemory}
              activeCommand={activeCommand}
              onCommandComplete={commandComplete}
              arrivalStartedAt={arrivalStartedAt}
              presentationStartedAt={presentationStartedAt}
              onArrivalDone={experience.arrivalDone}
              forceSettledRenderer={forceSettledRenderer}
              onRendererFallback={onRendererFallback}
              onSeraphPhaseChange={onSeraphPhaseChange}
            />
            {holdIndicator}
          </section>

          <div
            ref={attachThresholdHost}
            data-threshold-host="stable"
            className="temple-threshold-host"
          />

          <div className="temple-reading-column" data-reading-column>
            <TempleLore />

            <section data-section="codex" className="temple-folio temple-reading-section">
              <h2 className="temple-section-label">{copy.codex.toUpperCase()}</h2>
              <aside aria-label="the codex" className="min-w-0 text-ink-faded">
                <Codex
                  entries={codex}
                  state={state}
                  currentDreamRiteDate={currentDreamRiteDate}
                  onAmplitude={onAmplitude}
                  audioCtx={unlockAudio}
                />
              </aside>
            </section>

            <div ref={attachReceiptHost} data-receipt-ledger className="temple-receipt-ledger" />

            <section data-section="reliquary" className="temple-folio temple-reading-section">
              <h2 className="temple-section-label">{copy.reliquary.toUpperCase()}</h2>
              <Reliquary apiBase={API_BASE} relics={relics} />
            </section>

            <section data-section="dream" className="temple-folio temple-reading-section">
              <Dream
                dream={state?.dream ?? null}
                apiBase={API_BASE}
                presentation={platePresentation}
                identity={identityStatus}
              />
            </section>

            {replayWitness !== null ? <DreamWitness dream={replayWitness} /> : null}

            <section data-section="tallies" className="temple-folio temple-reading-section temple-tallies">
              <h2 className="temple-section-label">{copy.tallies.toUpperCase()}</h2>
              <Tallies apiBase={API_BASE} date={today()} myWallet={wallet?.address ?? null} />
            </section>

            {view && !view.dormant && state?.mint && (
              <section aria-label="the market" className="temple-folio temple-market space-y-3">
                <Mint mint={state.mint} />
                <div className="flex min-w-0 items-center gap-4 flex-wrap">
                  <Buy mint={state.mint} />
                  <Ticker state={state} />
                </div>
                <Chart mint={state.mint} />
                <HowToBuy mint={state.mint} />
              </section>
            )}

            <section data-section="canon-doorway" className="temple-doorway temple-reading-section">
              <Link to="/canon" className="font-machine text-xs text-ink-faded underline">
                {copy.completeCanon}
              </Link>
            </section>

            <section data-section="concordat-doorway" className="temple-doorway temple-reading-section">
              <Link to="/concordat" className="font-machine text-xs text-ink-faded underline">
                {copy.concordatDoorway}
              </Link>
            </section>

            <footer className="temple-colophon">
              <Socials />
            </footer>
          </div>
        </main>

        <MuteToggle active={awake && !muted} onToggle={toggleMute} />
      </div>
    </RiteInversion>
  );
}
