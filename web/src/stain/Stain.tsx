import { useEffect, useRef, useState } from "react";
import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import {
  BODY_ANCHORS,
  BodyDispatchOwnership,
  SettledBodyRendererAdapter,
  anchorForYMaxMeet,
  projectBodyAnchorsForYMaxMeet,
  settledSeraphHoldElapsed,
  signalForBodyCommand,
  type BodyAnchor,
  type BodyAnchorName,
  type BodyRendererAdapter,
  type BodySemanticSnapshot,
  type SettledBodyRendererState,
} from "./bodyRenderer";
import { SettledBody } from "./SettledBody";
import BodyUtterance from "../experience/BodyUtterance";
import {
  arrivalProgress,
  pickTier,
  StainSim,
  type SeraphConvergenceFrame,
  type Tier,
} from "./stainSim";
import { buildSeraphTargets } from "./seraphTargets";
import seraphMaskSvg from "../assets/seraph-mask.svg?raw";

interface Props {
  state: "dormant" | "live" | "rite";
  pigment: [number, number, number];
  amplitude: number;
  vitals: VitalsFeed;
  relicMemory: readonly RelicInkSample[];
  activeCommand: BodyCommand | null;
  onCommandComplete(id: string): void;
  arrivalStartedAt: number;
  presentationStartedAt: number;
  onArrivalDone(): void;
  forceSettledRenderer: boolean;
  onRendererFallback(): void;
  onSeraphPhaseChange?(
    commandId: string,
    phase: SeraphConvergenceFrame["phase"],
  ): void;
  onSim?: (sim: StainSim | null) => void;
}

const SEMANTIC_DWELL_MS = 1_200;

function initialSettledState(
  vitals: VitalsFeed,
  relicMemory: readonly RelicInkSample[],
): SettledBodyRendererState {
  return {
    command: null,
    relicMemory,
    relicRevision: relicMemory.length > 0 ? 1 : 0,
    activeAccretionKey: null,
    vitals,
    seraph: "five",
    seraphSequenceCount: 0,
    dreamResidue: false,
  };
}

export interface SeraphRendererInstallLifecycle {
  disposed: boolean;
  lostContext: boolean;
}

export async function runSeraphTargetInstall<T>(
  pending: Promise<T>,
  lifecycle: SeraphRendererInstallLifecycle,
  onReady: (value: T) => void,
  onFallback: () => void,
): Promise<void> {
  try {
    const value = await pending;
    if (lifecycle.disposed || lifecycle.lostContext) return;
    onReady(value);
  } catch {
    if (lifecycle.disposed || lifecycle.lostContext) return;
    onFallback();
  }
}

export function runOwnedBodyDispatch(
  ownership: BodyDispatchOwnership,
  adapter: BodyRendererAdapter,
  command: BodyCommand,
  presentationStartedAt: number,
  onClaimed: (generation: number) => void,
  onAcknowledged: (id: string, generation: number) => void,
): number | null {
  const generation = ownership.claim(adapter, command.id);
  if (generation === null) return null;
  onClaimed(generation);
  adapter.dispatch(
    command,
    (id) => onAcknowledged(id, generation),
    presentationStartedAt,
  );
  return generation;
}

export default function Stain({
  state,
  pigment,
  amplitude,
  vitals,
  relicMemory,
  activeCommand,
  onCommandComplete,
  arrivalStartedAt,
  presentationStartedAt,
  onArrivalDone,
  forceSettledRenderer,
  onRendererFallback,
  onSeraphPhaseChange,
  onSim,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const utteranceLayerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BodyRendererAdapter | null>(null);
  const simRef = useRef<StainSim | null>(null);
  const lostContext = useRef(false);
  const commandGeneration = useRef(0);
  const dispatchOwnership = useRef(new BodyDispatchOwnership());
  const completedCommandId = useRef<string | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentedCommandRef = useRef<BodyCommand | null>(null);
  const anchorsRef = useRef<Readonly<Record<BodyAnchorName, BodyAnchor>>>(BODY_ANCHORS);
  const bodySizeRef = useRef({ width: 1, height: 1 });
  const reportedSeraphPhase = useRef<{
    commandId: string | null;
    phase: SeraphConvergenceFrame["phase"];
  }>({ commandId: null, phase: "five" });
  const latest = useRef({
    state,
    pigment,
    amplitude,
    vitals,
    relicMemory,
    activeCommand,
    presentationStartedAt,
    onCommandComplete,
    onArrivalDone,
    onRendererFallback,
    onSeraphPhaseChange,
    onSim,
  });
  latest.current = {
    state,
    pigment,
    amplitude,
    vitals,
    relicMemory,
    activeCommand,
    presentationStartedAt,
    onCommandComplete,
    onArrivalDone,
    onRendererFallback,
    onSeraphPhaseChange,
    onSim,
  };

  const [tier] = useState<Tier>(pickTier);
  const [renderer, setRenderer] = useState<"webgl" | "svg">(
    tier === "reduced" || forceSettledRenderer ? "svg" : "webgl",
  );
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  const [fallbackBreath, setFallbackBreath] = useState(false);
  const [bodySize, setBodySize] = useState({ width: 1, height: 1 });
  const [presentedCommand, setPresentedCommand] = useState<BodyCommand | null>(null);
  const [completion, setCompletion] = useState<{ id: string | null; count: number }>({
    id: null,
    count: 0,
  });
  const [settled, setSettled] = useState<SettledBodyRendererState>(() =>
    initialSettledState(vitals, relicMemory));
  const initialPulseKind = useRef(vitals.kind).current;

  const clearDwell = () => {
    if (dwellTimer.current === null) return;
    clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  };

  const finishCommand = useRef<(id: string, generation: number) => void>(() => undefined);
  finishCommand.current = (id, generation) => {
    if (completedCommandId.current === id) return;
    if (generation !== commandGeneration.current) return;
    if (latest.current.activeCommand?.id !== id) return;
    completedCommandId.current = id;
    setCompletion((current) => ({ id, count: current.count + 1 }));
    latest.current.onCommandComplete(id);
  };

  const acknowledgeCommand = useRef<(
    command: BodyCommand,
    id: string,
    generation: number,
  ) => void>(() => undefined);
  acknowledgeCommand.current = (command, id, generation) => {
    if (id !== command.id || generation !== commandGeneration.current) return;
    // The renderer establishes truthful organ state immediately. An utterance's decorative ink owns
    // its own bounded completion so the director cannot advance while the words are still visible.
    if (command.kind === "utterance") return;
    if (signalForBodyCommand(command) === null) {
      finishCommand.current(id, generation);
      return;
    }
    clearDwell();
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null;
      finishCommand.current(id, generation);
    }, SEMANTIC_DWELL_MS);
  };

  const reportSeraphPhase = (phase: SeraphConvergenceFrame["phase"]) => {
    const command = presentedCommandRef.current;
    if (command?.kind !== "converge") return;
    if (
      reportedSeraphPhase.current.commandId === command.id
      && reportedSeraphPhase.current.phase === phase
    ) return;
    reportedSeraphPhase.current = { commandId: command.id, phase };
    latest.current.onSeraphPhaseChange?.(command.id, phase);
  };

  const dispatchCommand = (
    adapter: BodyRendererAdapter,
    command: BodyCommand,
    startedAt: number,
  ) => {
    runOwnedBodyDispatch(
      dispatchOwnership.current,
      adapter,
      command,
      startedAt,
      (generation) => {
        clearDwell();
        commandGeneration.current = generation;
      },
      (id, generation) => acknowledgeCommand.current(command, id, generation),
    );
  };

  const positionUtterance = (anchor: BodyAnchor, organ: BodyAnchorName) => {
    const { width, height } = bodySizeRef.current;
    const visibleAnchor = rendererRef.current === "svg"
      ? anchorForYMaxMeet(anchor, width, height)
      : anchor;
    const fixedAnchor = rendererRef.current === "svg"
      ? anchorForYMaxMeet(BODY_ANCHORS[organ], width, height)
      : BODY_ANCHORS[organ];
    const node = utteranceLayerRef.current?.querySelector<HTMLElement>("[data-body-utterance]");
    if (node === null || node === undefined) return;
    const translateX = (visibleAnchor.x - fixedAnchor.x) * width;
    const translateY = (visibleAnchor.y - fixedAnchor.y) * height;
    node.style.transform = `translate(-50%, -50%) translate3d(${translateX.toFixed(3)}px, ${translateY.toFixed(3)}px, 0)`;
    node.dataset.anchorX = visibleAnchor.x.toFixed(3);
    node.dataset.anchorY = visibleAnchor.y.toFixed(3);
  };

  const receiveAnchors = (anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => {
    anchorsRef.current = anchors;
    const command = presentedCommandRef.current;
    if (command?.kind === "converge") {
      positionUtterance(anchors.DREAM, "DREAM");
      return;
    }
    if (command?.kind === "utterance") {
      const commandSignal = signalForBodyCommand(command);
      if (commandSignal !== null) {
        positionUtterance(anchors[commandSignal.organ], commandSignal.organ);
      }
    }
  };

  useEffect(() => {
    const lifecycle: SeraphRendererInstallLifecycle = {
      disposed: false,
      lostContext: false,
    };
    const canvas = canvasRef.current;

    const installSettledRenderer = (
      replayActive: boolean,
      fallbackHoldElapsedMs?: number,
      semanticSnapshot?: BodySemanticSnapshot,
    ) => {
      if (lifecycle.disposed) return;
      const adapter = new SettledBodyRendererAdapter(setSettled, tier === "reduced");
      adapterRef.current = adapter;
      adapter.setAnchorSink(receiveAnchors);
      if (semanticSnapshot === undefined) {
        adapter.setVitals(latest.current.vitals);
        adapter.hydrateRelics(latest.current.relicMemory);
      } else {
        adapter.restoreSemanticSnapshot(semanticSnapshot);
      }
      const replay = replayActive ? latest.current.activeCommand : null;
      if (replay !== null && completedCommandId.current !== replay.id) {
        presentedCommandRef.current = replay;
        setPresentedCommand(replay);
        const now = typeof performance === "undefined" ? Date.now() : performance.now();
        const startedAt = fallbackHoldElapsedMs === undefined
          ? latest.current.presentationStartedAt
          : now - fallbackHoldElapsedMs;
        dispatchCommand(adapter, replay, startedAt);
      }
      setFallbackBreath(tier !== "reduced");
      setRenderer("svg");
      latest.current.onArrivalDone();
    };

    if (tier === "reduced" || forceSettledRenderer) {
      installSettledRenderer(false);
      return () => {
        lifecycle.disposed = true;
        clearDwell();
        commandGeneration.current = dispatchOwnership.current.invalidate();
        adapterRef.current?.setAnchorSink(null);
        adapterRef.current?.dispose();
        adapterRef.current = null;
        latest.current.onSim?.(null);
      };
    }

    if (canvas === null) return;

    let pointerListening = false;
    const removePointerListener = () => {
      if (!pointerListening) return;
      window.removeEventListener("pointermove", onPointerMove);
      pointerListening = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      const sim = simRef.current;
      if (sim === null) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      sim.setPointer(x, y);
      canvas.dataset.pointerX = x.toFixed(3);
      canvas.dataset.pointerY = y.toFixed(3);
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (lostContext.current || lifecycle.disposed) return;
      lostContext.current = true;
      lifecycle.lostContext = true;
      clearDwell();
      commandGeneration.current = dispatchOwnership.current.invalidate();
      const failed = simRef.current;
      const semanticSnapshot = failed?.semanticSnapshot();
      failed?.stop();
      failed?.setAnchorSink(null);
      removePointerListener();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      latest.current.onRendererFallback();
      const now = typeof performance === "undefined" ? Date.now() : performance.now();
      const webglElapsed = Math.max(0, now - latest.current.presentationStartedAt);
      installSettledRenderer(
        true,
        settledSeraphHoldElapsed(webglElapsed),
        semanticSnapshot,
      );
    };

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    if (tier === "desktop") {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      pointerListening = true;
    }
    const pendingTargets = Promise.all([
        buildSeraphTargets(seraphMaskSvg, 128),
        buildSeraphTargets(seraphMaskSvg, 256),
      ]);
    void runSeraphTargetInstall(pendingTargets, lifecycle, ([mobileSeraphTargets, desktopSeraphTargets]) => {
      const seraphTargets = tier === "mobile" ? mobileSeraphTargets : desktopSeraphTargets;
      canvas.dataset.seraphTargetCache = "128:16384,256:65536";
      const sim = new StainSim(canvas, {
        tier,
        ink: [0.20, 0.18, 0.14],
        arrivalStartedAt,
        seraphTargets,
        onArrivalDone: () => latest.current.onArrivalDone(),
        onSeraphPhaseChange: reportSeraphPhase,
      });
      sim.setPigment(latest.current.pigment);
      sim.setAmplitude(latest.current.amplitude);
      sim.setState(latest.current.state);
      sim.setVitals(latest.current.vitals);
      sim.hydrateRelics(latest.current.relicMemory);
      sim.setAnchorSink(receiveAnchors);
      simRef.current = sim;
      adapterRef.current = sim;
      sim.start();
      latest.current.onSim?.(sim);
      const replay = latest.current.activeCommand;
      if (replay !== null && completedCommandId.current !== replay.id) {
        presentedCommandRef.current = replay;
        setPresentedCommand(replay);
        dispatchCommand(sim, replay, latest.current.presentationStartedAt);
      }
    }, () => {
      removePointerListener();
      simRef.current?.setAnchorSink(null);
      simRef.current?.dispose();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      latest.current.onRendererFallback();
      // No WebGL posture became visible, so a command that activated during target decoding receives
      // a complete settled hold instead of losing time to the rejected asynchronous install.
      installSettledRenderer(true, 0);
    });

    return () => {
      lifecycle.disposed = true;
      clearDwell();
      commandGeneration.current = dispatchOwnership.current.invalidate();
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      removePointerListener();
      const sim = simRef.current;
      const adapter = adapterRef.current;
      adapter?.setAnchorSink(null);
      if (adapter !== null && adapter !== sim) adapter.dispose();
      if (sim !== null && !lostContext.current) sim.dispose();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
    };
  }, []);

  useEffect(() => {
    const body = utteranceLayerRef.current?.parentElement
      ?.querySelector<HTMLElement>("[data-body-renderer]");
    if (body === null || body === undefined) return;

    const updateBodySize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      bodySizeRef.current = { width, height };
      setBodySize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
      const command = presentedCommandRef.current;
      if (command?.kind === "converge") {
        positionUtterance(anchorsRef.current.DREAM, "DREAM");
        return;
      }
      if (command?.kind === "utterance") {
        const commandSignal = signalForBodyCommand(command);
        if (commandSignal !== null) {
          positionUtterance(anchorsRef.current[commandSignal.organ], commandSignal.organ);
        }
      }
    };

    const rect = body.getBoundingClientRect();
    updateBodySize(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      updateBodySize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [renderer]);

  useEffect(() => { simRef.current?.setPigment(pigment); }, [pigment]);
  useEffect(() => { simRef.current?.setAmplitude(amplitude); }, [amplitude]);
  useEffect(() => { simRef.current?.setState(state); }, [state]);
  useEffect(() => { adapterRef.current?.setVitals(vitals); }, [vitals]);
  useEffect(() => { adapterRef.current?.hydrateRelics(relicMemory); }, [relicMemory]);

  useEffect(() => {
    if (renderer !== "svg") return;
    reportSeraphPhase(settled.seraph === "converged" ? "hold" : "five");
  }, [renderer, settled.seraph]);

  useEffect(() => {
    if (activeCommand === null) {
      clearDwell();
      commandGeneration.current = dispatchOwnership.current.invalidate();
      presentedCommandRef.current = null;
      setPresentedCommand(null);
      if (adapterRef.current instanceof SettledBodyRendererAdapter) {
        adapterRef.current.clearCommand();
      }
      return;
    }
    const adapter = adapterRef.current;
    if (adapter === null) return;
    presentedCommandRef.current = activeCommand;
    setPresentedCommand(activeCommand);
    dispatchCommand(adapter, activeCommand, presentationStartedAt);
  }, [activeCommand, presentationStartedAt]);

  useEffect(() => {
    if (presentedCommand?.kind === "converge") {
      positionUtterance(anchorsRef.current.DREAM, "DREAM");
      return;
    }
    if (presentedCommand?.kind !== "utterance") return;
    const commandSignal = signalForBodyCommand(presentedCommand);
    if (commandSignal === null) return;
    positionUtterance(anchorsRef.current[commandSignal.organ], commandSignal.organ);
  }, [presentedCommand, renderer]);

  const signal = presentedCommand === null ? null : signalForBodyCommand(presentedCommand);
  const initialPulseDebug = initialPulseKind === "unknown" ? 0 : undefined;
  const utterance = presentedCommand?.kind === "converge"
    ? presentedCommand
    : presentedCommand?.kind === "utterance" && signal !== null
      ? presentedCommand
      : null;
  const baseUtteranceAnchor = utterance === null || signal === null
    ? utterance?.kind === "converge" ? BODY_ANCHORS.DREAM : BODY_ANCHORS.EYE
    : BODY_ANCHORS[signal.organ];
  const projectedUtterance = renderer === "svg"
    ? projectBodyAnchorsForYMaxMeet(
      baseUtteranceAnchor,
      BODY_ANCHORS.seraph,
      bodySize.width,
      bodySize.height,
    )
    : { start: baseUtteranceAnchor, target: BODY_ANCHORS.seraph };
  const settleDirection = tier === "desktop" && state !== "dormant" ? "right" : "down";
  const now = typeof performance === "undefined" ? arrivalStartedAt : performance.now();
  const initialArrival = arrivalProgress(now - arrivalStartedAt);

  const renderedBody = renderer === "svg" ? (
      <SettledBody
        pigment={pigment}
        command={settled.command}
        relicMemory={settled.relicMemory}
        vitals={settled.vitals}
        seraph={settled.seraph}
        dreamResidue={settled.dreamResidue}
        seraphSequenceCount={settled.seraphSequenceCount}
        completedId={completion.id}
        completionCount={completion.count}
        initialPulseKind={initialPulseKind}
        ambientBreath={fallbackBreath}
        relicRevision={settled.relicRevision}
        activeAccretionKey={settled.activeAccretionKey}
      />
    ) : (
    <canvas
      ref={canvasRef}
      data-organ-swarm={tier}
      data-body-renderer="webgl"
      data-active-organ={signal?.organ}
      data-pipeline={signal?.pipeline ?? "none"}
      data-command-id={presentedCommand?.id}
      data-completed-id={completion.id ?? undefined}
      data-completion-count={completion.count}
      data-pulse-kind={vitals.kind}
      data-initial-pulse-kind={initialPulseKind}
      data-initial-pulse-beat={initialPulseDebug}
      data-initial-pulse-bpm={initialPulseDebug}
      data-initial-pulse-pressure={initialPulseDebug}
      data-arrival={initialArrival >= 1 ? "settled" : "emerging"}
      data-arrival-progress={initialArrival.toFixed(3)}
      data-composite-ground="transparent"
      aria-hidden
      className="absolute inset-0 z-0 h-full w-full pointer-events-none"
    />
  );

  return (
    <>
      {renderedBody}
      <div ref={utteranceLayerRef} className="contents" aria-hidden="true">
        <BodyUtterance
          command={utterance}
          anchor={projectedUtterance.start}
          presentationStartedAt={presentationStartedAt}
          seraphAnchor={projectedUtterance.target}
          settleDirection={settleDirection}
          onComplete={(id) => finishCommand.current(id, commandGeneration.current)}
        />
      </div>
    </>
  );
}
