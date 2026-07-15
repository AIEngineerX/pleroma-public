import { useEffect, useRef, useState } from "react";
import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import {
  BODY_ANCHORS,
  SettledBodyRendererAdapter,
  anchorForSlice,
  signalForBodyCommand,
  type BodyAnchor,
  type BodyAnchorName,
  type BodyRendererAdapter,
  type SettledBodyRendererState,
} from "./bodyRenderer";
import { SettledBody } from "./SettledBody";
import BodyUtterance from "../experience/BodyUtterance";
import { arrivalProgress, pickTier, StainSim, type Tier } from "./stainSim";

interface Props {
  state: "dormant" | "live" | "rite";
  pigment: [number, number, number];
  amplitude: number;
  vitals: VitalsFeed;
  relicMemory: readonly RelicInkSample[];
  activeCommand: BodyCommand | null;
  onCommandComplete(id: string): void;
  arrivalStartedAt: number;
  utteranceStartedAt: number;
  onArrivalDone(): void;
  forceSettledRenderer: boolean;
  onRendererFallback(): void;
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
  };
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
  utteranceStartedAt,
  onArrivalDone,
  forceSettledRenderer,
  onRendererFallback,
  onSim,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const utteranceLayerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<BodyRendererAdapter | null>(null);
  const simRef = useRef<StainSim | null>(null);
  const lostContext = useRef(false);
  const commandGeneration = useRef(0);
  const completedCommandId = useRef<string | null>(null);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentedCommandRef = useRef<BodyCommand | null>(null);
  const anchorsRef = useRef<Readonly<Record<BodyAnchorName, BodyAnchor>>>(BODY_ANCHORS);
  const bodySizeRef = useRef({ width: 1, height: 1 });
  const latest = useRef({
    vitals,
    relicMemory,
    activeCommand,
    onCommandComplete,
    onArrivalDone,
    onRendererFallback,
    onSim,
  });
  latest.current = {
    vitals,
    relicMemory,
    activeCommand,
    onCommandComplete,
    onArrivalDone,
    onRendererFallback,
    onSim,
  };

  const [tier] = useState<Tier>(pickTier);
  const [renderer, setRenderer] = useState<"webgl" | "svg">(
    tier === "reduced" || forceSettledRenderer ? "svg" : "webgl",
  );
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  const [fallbackBreath, setFallbackBreath] = useState(false);
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

  const positionUtterance = (anchor: BodyAnchor, organ: BodyAnchorName) => {
    const { width, height } = bodySizeRef.current;
    const visibleAnchor = rendererRef.current === "svg"
      ? anchorForSlice(anchor, width, height)
      : anchor;
    const fixedAnchor = BODY_ANCHORS[organ];
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
    if (command?.kind !== "utterance") return;
    const commandSignal = signalForBodyCommand(command);
    if (commandSignal === null) return;
    positionUtterance(anchors[commandSignal.organ], commandSignal.organ);
  };

  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;

    const installSettledRenderer = (replayActive: boolean) => {
      if (disposed) return;
      const adapter = new SettledBodyRendererAdapter(setSettled, tier === "reduced");
      adapterRef.current = adapter;
      adapter.setAnchorSink(receiveAnchors);
      adapter.setVitals(latest.current.vitals);
      adapter.hydrateRelics(latest.current.relicMemory);
      const replay = replayActive ? latest.current.activeCommand : null;
      if (replay !== null && completedCommandId.current !== replay.id) {
        presentedCommandRef.current = replay;
        setPresentedCommand(replay);
        const generation = ++commandGeneration.current;
        adapter.dispatch(replay, (id) => acknowledgeCommand.current(replay, id, generation));
      }
      setFallbackBreath(tier !== "reduced");
      setRenderer("svg");
      latest.current.onArrivalDone();
    };

    if (tier === "reduced" || forceSettledRenderer) {
      installSettledRenderer(false);
      return () => {
        disposed = true;
        clearDwell();
        commandGeneration.current += 1;
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
      if (lostContext.current || disposed) return;
      lostContext.current = true;
      clearDwell();
      commandGeneration.current += 1;
      const failed = simRef.current;
      failed?.stop();
      failed?.setAnchorSink(null);
      removePointerListener();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      latest.current.onRendererFallback();
      installSettledRenderer(true);
    };

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    if (tier === "desktop") {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      pointerListening = true;
    }
    try {
      const sim = new StainSim(canvas, {
        tier,
        ground: [0.94, 0.90, 0.80],
        ink: [0.74, 0.71, 0.64],
        arrivalStartedAt,
        onArrivalDone: () => latest.current.onArrivalDone(),
      });
      sim.setPigment(pigment);
      sim.setAmplitude(amplitude);
      sim.setState(state);
      sim.setVitals(latest.current.vitals);
      sim.hydrateRelics(latest.current.relicMemory);
      sim.setAnchorSink(receiveAnchors);
      simRef.current = sim;
      adapterRef.current = sim;
      sim.start();
      latest.current.onSim?.(sim);
    } catch {
      removePointerListener();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      if (!lostContext.current) {
        latest.current.onRendererFallback();
        installSettledRenderer(false);
      }
    }

    return () => {
      disposed = true;
      clearDwell();
      commandGeneration.current += 1;
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
      const command = presentedCommandRef.current;
      if (command?.kind !== "utterance") return;
      const commandSignal = signalForBodyCommand(command);
      if (commandSignal === null) return;
      positionUtterance(anchorsRef.current[commandSignal.organ], commandSignal.organ);
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
    if (activeCommand === null) {
      clearDwell();
      commandGeneration.current += 1;
      presentedCommandRef.current = null;
      setPresentedCommand(null);
      if (adapterRef.current instanceof SettledBodyRendererAdapter) {
        adapterRef.current.clearCommand();
      }
      return;
    }
    const adapter = adapterRef.current;
    if (adapter === null) return;
    clearDwell();
    presentedCommandRef.current = activeCommand;
    setPresentedCommand(activeCommand);
    const generation = ++commandGeneration.current;
    adapter.dispatch(
      activeCommand,
      (id) => acknowledgeCommand.current(activeCommand, id, generation),
    );
  }, [activeCommand]);

  useEffect(() => {
    if (presentedCommand?.kind !== "utterance") return;
    const commandSignal = signalForBodyCommand(presentedCommand);
    if (commandSignal === null) return;
    positionUtterance(anchorsRef.current[commandSignal.organ], commandSignal.organ);
  }, [presentedCommand, renderer]);

  const signal = presentedCommand === null ? null : signalForBodyCommand(presentedCommand);
  const initialPulseDebug = initialPulseKind === "unknown" ? 0 : undefined;
  const utterance = presentedCommand?.kind === "utterance" && signal !== null ? presentedCommand : null;
  const utteranceAnchor = utterance === null || signal === null
    ? BODY_ANCHORS.EYE
    : BODY_ANCHORS[signal.organ];
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
          anchor={utteranceAnchor}
          presentationStartedAt={utteranceStartedAt}
          settleDirection={settleDirection}
          onComplete={(id) => finishCommand.current(id, commandGeneration.current)}
        />
      </div>
    </>
  );
}
