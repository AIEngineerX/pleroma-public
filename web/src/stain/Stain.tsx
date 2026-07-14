import { useEffect, useRef, useState } from "react";
import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import {
  SettledBodyRendererAdapter,
  signalForBodyCommand,
  type BodyRendererAdapter,
  type SettledBodyRendererState,
} from "./bodyRenderer";
import { SettledBody } from "./SettledBody";
import { pickTier, StainSim, type Tier } from "./stainSim";

interface Props {
  state: "dormant" | "live" | "rite";
  pigment: [number, number, number];
  amplitude: number;
  vitals: VitalsFeed;
  relicMemory: readonly RelicInkSample[];
  activeCommand: BodyCommand | null;
  onCommandComplete(id: string): void;
  onSim?: (sim: StainSim | null) => void;
}

function initialSettledState(
  vitals: VitalsFeed,
  relicMemory: readonly RelicInkSample[],
): SettledBodyRendererState {
  return { command: null, relicMemory, vitals, seraph: "five" };
}

export default function Stain({
  state,
  pigment,
  amplitude,
  vitals,
  relicMemory,
  activeCommand,
  onCommandComplete,
  onSim,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const adapterRef = useRef<BodyRendererAdapter | null>(null);
  const simRef = useRef<StainSim | null>(null);
  const lostContext = useRef(false);
  const commandGeneration = useRef(0);
  const completedCommands = useRef(new Set<string>());
  const presentedCommandRef = useRef<BodyCommand | null>(null);
  const hasPresentedCommand = useRef(false);
  const latest = useRef({ vitals, relicMemory, activeCommand, onCommandComplete, onSim });
  latest.current = { vitals, relicMemory, activeCommand, onCommandComplete, onSim };

  const [tier] = useState<Tier>(pickTier);
  const [renderer, setRenderer] = useState<"webgl" | "svg">(
    tier === "reduced" ? "svg" : "webgl",
  );
  const [fallbackBreath, setFallbackBreath] = useState(false);
  const [presentedCommand, setPresentedCommand] = useState<BodyCommand | null>(null);
  const [completion, setCompletion] = useState<{ id: string | null; count: number }>({
    id: null,
    count: 0,
  });
  const [settled, setSettled] = useState<SettledBodyRendererState>(() =>
    initialSettledState(vitals, relicMemory));
  const initialPulseKind = useRef(vitals.kind).current;

  const finishCommand = useRef<(id: string, generation: number) => void>(() => undefined);
  finishCommand.current = (id, generation) => {
    if (completedCommands.current.has(id)) return;
    if (generation !== commandGeneration.current) return;
    if (latest.current.activeCommand?.id !== id) return;
    completedCommands.current.add(id);
    setCompletion((current) => ({ id, count: current.count + 1 }));
    latest.current.onCommandComplete(id);
  };

  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;

    const installSettledRenderer = (replayPresented: boolean) => {
      if (disposed) return;
      const adapter = new SettledBodyRendererAdapter(setSettled);
      adapterRef.current = adapter;
      adapter.setVitals(latest.current.vitals);
      adapter.hydrateRelics(latest.current.relicMemory);
      if (replayPresented && hasPresentedCommand.current && presentedCommandRef.current !== null) {
        const replay = presentedCommandRef.current;
        const generation = ++commandGeneration.current;
        adapter.dispatch(replay, (id) => finishCommand.current(id, generation));
      }
      setFallbackBreath(tier !== "reduced");
      setRenderer("svg");
    };

    if (tier === "reduced") {
      installSettledRenderer(false);
      return () => {
        disposed = true;
        commandGeneration.current += 1;
        adapterRef.current?.dispose();
        adapterRef.current = null;
        latest.current.onSim?.(null);
      };
    }

    if (canvas === null) return;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (lostContext.current || disposed) return;
      lostContext.current = true;
      commandGeneration.current += 1;
      const failed = simRef.current;
      failed?.stop();
      failed?.setAnchorSink(null);
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      installSettledRenderer(true);
    };

    canvas.addEventListener("webglcontextlost", onContextLost, false);
    try {
      const sim = new StainSim(canvas, {
        tier,
        ground: [0.94, 0.90, 0.80],
        ink: [0.74, 0.71, 0.64],
      });
      sim.setPigment(pigment);
      sim.setAmplitude(amplitude);
      sim.setState(state);
      sim.setVitals(latest.current.vitals);
      sim.hydrateRelics(latest.current.relicMemory);
      simRef.current = sim;
      adapterRef.current = sim;
      sim.start();
      latest.current.onSim?.(sim);
    } catch {
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
      if (!lostContext.current) installSettledRenderer(false);
    }

    return () => {
      disposed = true;
      commandGeneration.current += 1;
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      const sim = simRef.current;
      const adapter = adapterRef.current;
      if (adapter !== null && adapter !== sim) adapter.dispose();
      if (sim !== null && !lostContext.current) sim.dispose();
      simRef.current = null;
      adapterRef.current = null;
      latest.current.onSim?.(null);
    };
  }, []);

  useEffect(() => { simRef.current?.setPigment(pigment); }, [pigment]);
  useEffect(() => { simRef.current?.setAmplitude(amplitude); }, [amplitude]);
  useEffect(() => { simRef.current?.setState(state); }, [state]);
  useEffect(() => { adapterRef.current?.setVitals(vitals); }, [vitals]);
  useEffect(() => { adapterRef.current?.hydrateRelics(relicMemory); }, [relicMemory]);

  useEffect(() => {
    if (activeCommand === null) {
      commandGeneration.current += 1;
      return;
    }
    const adapter = adapterRef.current;
    if (adapter === null) return;
    presentedCommandRef.current = activeCommand;
    hasPresentedCommand.current = true;
    setPresentedCommand(activeCommand);
    const generation = ++commandGeneration.current;
    adapter.dispatch(activeCommand, (id) => finishCommand.current(id, generation));
  }, [activeCommand]);

  const signal = presentedCommand === null ? null : signalForBodyCommand(presentedCommand);
  const initialPulseDebug = initialPulseKind === "unknown" ? 0 : undefined;

  if (renderer === "svg") {
    return (
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
      />
    );
  }

  return (
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
      aria-hidden
      className="absolute inset-0 z-0 h-full w-full pointer-events-none"
    />
  );
}
