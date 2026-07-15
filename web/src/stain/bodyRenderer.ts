import type {
  BodyCommand,
  PipelineLink,
  RelicInkSample,
  VitalsFeed,
} from "../experience/types";
import {
  RELIC_ACCRETION_DURATION_MS,
  RELIC_MEMORY_LIMIT,
  relicAccretionKey,
} from "./relicInk";

export type BodyAnchorName = "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM" | "seraph";

export interface BodyAnchor {
  x: number;
  y: number;
}

export interface BodyRendererAdapter {
  dispatch(command: BodyCommand, onComplete: (id: string) => void): void;
  hydrateRelics(samples: readonly RelicInkSample[]): void;
  getAnchor(name: BodyAnchorName): BodyAnchor;
  setVitals(feed: VitalsFeed): void;
  setAnchorSink(sink: ((anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => void) | null): void;
  stop(): void;
  dispose(): void;
}

export interface SettledBodyRendererState {
  command: BodyCommand | null;
  relicMemory: readonly RelicInkSample[];
  relicRevision: number;
  activeAccretionKey: string | null;
  vitals: VitalsFeed;
  seraph: "five" | "converged";
}

export const BODY_ANCHORS: Readonly<Record<BodyAnchorName, BodyAnchor>> = {
  EYE: { x: 0.5, y: 0.28 },
  KEEP: { x: 0.7, y: 0.43 },
  TONGUE: { x: 0.64, y: 0.66 },
  PULSE: { x: 0.36, y: 0.66 },
  DREAM: { x: 0.3, y: 0.43 },
  seraph: { x: 0.5, y: 0.5 },
};

export function anchorForYMaxMeet(anchor: BodyAnchor, width: number, height: number): BodyAnchor {
  if (width <= 0 || height <= 0) return { ...anchor };
  const side = Math.min(width, height);
  const offsetX = (width - side) / 2;
  const offsetY = height - side;
  return {
    x: Number(((offsetX + anchor.x * side) / width).toFixed(6)),
    y: Number(((offsetY + anchor.y * side) / height).toFixed(6)),
  };
}

export type BodyOrgan = Exclude<BodyAnchorName, "seraph">;

export interface BodySignal {
  organ: BodyOrgan;
  intensity: number;
  pipeline: PipelineLink;
  rubric?: boolean;
}

function isBodyOrgan(organ: string): organ is BodyOrgan {
  return organ === "EYE"
    || organ === "KEEP"
    || organ === "TONGUE"
    || organ === "PULSE"
    || organ === "DREAM";
}

function isEligibleUtterance(command: Extract<BodyCommand, { kind: "utterance" }>): boolean {
  const { organ, register } = command.entry;
  if (organ === "EYE") return register === "verse";
  if (organ === "KEEP") return register === "verdict";
  if (organ === "TONGUE") return register === "verse" || register === "sermon";
  if (organ === "DREAM") return register === "verse" && command.mode === "memory";
  return false;
}

export function signalForBodyCommand(command: BodyCommand): BodySignal | null {
  switch (command.kind) {
    case "quicken":
      return {
        organ: command.organ,
        intensity: command.intensity,
        pipeline: command.pipeline,
      };
    case "utterance":
      if (!isBodyOrgan(command.entry.organ) || !isEligibleUtterance(command)) return null;
      return {
        organ: command.entry.organ,
        intensity: command.intensity,
        pipeline: command.pipeline,
        rubric: command.mode === "live"
          && command.entry.organ === "TONGUE"
          && command.entry.register === "sermon",
      };
    case "accrete":
    case "converge":
    case "dissolve":
      return null;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export function dedupeRelicSamples(samples: readonly RelicInkSample[]): RelicInkSample[] {
  const indices = new Map<string, number>();
  const unique: RelicInkSample[] = [];
  for (const sample of samples) {
    const existing = indices.get(sample.offeringId);
    if (existing !== undefined) {
      unique[existing] = sample;
      continue;
    }
    if (unique.length === RELIC_MEMORY_LIMIT) continue;
    indices.set(sample.offeringId, unique.length);
    unique.push(sample);
  }
  return unique;
}

export function commitRelicSample(
  samples: readonly RelicInkSample[],
  sample: RelicInkSample,
): RelicInkSample[] {
  const memory = dedupeRelicSamples(samples);
  const existing = memory.findIndex((candidate) => candidate.offeringId === sample.offeringId);
  if (existing !== -1) {
    memory[existing] = sample;
    return memory;
  }
  return dedupeRelicSamples([sample, ...memory]);
}

export function relicSampleListsMatch(
  left: readonly RelicInkSample[],
  right: readonly RelicInkSample[],
): boolean {
  return left.length === right.length && left.every((sample, index) => {
    const other = right[index];
    return sample.offeringId === other?.offeringId
      && sample.size === other.size
      && sample.alpha === other.alpha;
  });
}

export function anchorsFromSwarmCentroids(
  centroids: ArrayLike<number>,
): Readonly<Record<BodyAnchorName, BodyAnchor>> {
  return {
    EYE: { x: centroids[0], y: 1 - centroids[1] },
    KEEP: { x: centroids[2], y: 1 - centroids[3] },
    TONGUE: { x: centroids[4], y: 1 - centroids[5] },
    PULSE: { x: centroids[6], y: 1 - centroids[7] },
    DREAM: { x: centroids[8], y: 1 - centroids[9] },
    seraph: { ...BODY_ANCHORS.seraph },
  };
}

function cloneVitalsFeed(feed: VitalsFeed): VitalsFeed {
  if (feed.kind === "unknown") return feed;
  return { ...feed, value: { ...feed.value } };
}

export class SettledBodyRendererAdapter implements BodyRendererAdapter {
  private command: BodyCommand | null = null;
  private relicMemory: RelicInkSample[] = [];
  private relicRevision = 0;
  private activeAccretionKey: string | null = null;
  private accretionTimer: ReturnType<typeof setTimeout> | null = null;
  private vitals: VitalsFeed = { kind: "unknown" };
  private seraph: "five" | "converged" = "five";
  private anchorSink: ((anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => void) | null = null;
  private disposed = false;

  constructor(
    private onChange: (state: SettledBodyRendererState) => void,
    private readonly reducedMotion = false,
  ) {}

  dispatch(command: BodyCommand, onComplete: (id: string) => void): void {
    if (this.disposed) {
      onComplete(command.id);
      return;
    }
    this.command = command;
    if (command.kind === "accrete") {
      this.clearAccretionTimer();
      const key = relicAccretionKey(command.relic);
      this.activeAccretionKey = key;
      this.emit();
      const commit = () => {
        this.accretionTimer = null;
        if (this.disposed || this.activeAccretionKey !== key) return;
        const next = commitRelicSample(this.relicMemory, command.ink);
        if (!relicSampleListsMatch(next, this.relicMemory)) this.relicRevision += 1;
        this.relicMemory = next;
        this.activeAccretionKey = null;
        this.emit();
        onComplete(command.id);
      };
      if (this.reducedMotion) commit();
      else this.accretionTimer = setTimeout(commit, RELIC_ACCRETION_DURATION_MS);
      return;
    } else if (command.kind === "converge") {
      this.seraph = "converged";
    } else if (command.kind === "dissolve") {
      this.seraph = "five";
    }
    this.emit();
    onComplete(command.id);
  }

  hydrateRelics(samples: readonly RelicInkSample[]): void {
    if (this.disposed) return;
    const next = dedupeRelicSamples(samples);
    if (relicSampleListsMatch(next, this.relicMemory)) return;
    this.relicMemory = next;
    this.relicRevision += 1;
    this.emit();
  }

  clearCommand(): void {
    if (this.disposed || this.command === null) return;
    this.command = null;
    this.emit();
  }

  getAnchor(name: BodyAnchorName): BodyAnchor {
    return { ...BODY_ANCHORS[name] };
  }

  setVitals(feed: VitalsFeed): void {
    if (this.disposed) return;
    this.vitals = cloneVitalsFeed(feed);
    this.emit();
  }

  setAnchorSink(
    sink: ((anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => void) | null,
  ): void {
    this.anchorSink = sink;
    sink?.(BODY_ANCHORS);
  }

  stop(): void {
    this.clearAccretionTimer();
  }

  dispose(): void {
    this.clearAccretionTimer();
    this.disposed = true;
    this.anchorSink = null;
    this.onChange = () => undefined;
  }

  private emit(): void {
    this.onChange({
      command: this.command,
      relicMemory: this.relicMemory,
      relicRevision: this.relicRevision,
      activeAccretionKey: this.activeAccretionKey,
      vitals: this.vitals,
      seraph: this.seraph,
    });
  }

  private clearAccretionTimer(): void {
    if (this.accretionTimer !== null) clearTimeout(this.accretionTimer);
    this.accretionTimer = null;
    this.activeAccretionKey = null;
  }
}
