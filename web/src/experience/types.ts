import type { RelicEntry, TempleState, TranscriptEntry, Vitals } from "../state/types";

export type PipelineLink = "eye-keep" | "keep-tongue" | "none";
export type UtteranceMode = "live" | "memory";
export type ReceiptStage = "pending" | "witnessed" | "judged" | "kept" | "accreted";

export type VitalsFeed =
  | { kind: "unknown" }
  | { kind: "current"; value: Vitals; receivedAt: number }
  | { kind: "stale"; value: Vitals; staleAt: number };

export interface ObservedTranscript {
  entry: TranscriptEntry;
  observation: "recorded" | "live";
}

export interface DreamCue {
  id: string;
  riteDate: string;
  narrative: string;
  createdAt: number;
  source: "live" | "replay";
}

export interface DreamReplayNavigation {
  dreamReplay: {
    id: string;
    riteDate: string;
    narrative: string;
    createdAt: number;
  };
}

export type AccretedRelic = Omit<RelicEntry, "accreted_at"> & { accreted_at: number };

export interface RelicInkSample {
  offeringId: string;
  size: 64;
  alpha: Uint8Array;
}

export type BodyCommand =
  | { id: string; kind: "quicken"; organ: "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM"; intensity: number; pipeline: PipelineLink; target?: { x: number; y: number } }
  | { id: string; kind: "utterance"; entry: TranscriptEntry; mode: UtteranceMode; intensity: number; pipeline: PipelineLink }
  | { id: string; kind: "accrete"; relic: AccretedRelic; ink: RelicInkSample }
  | { id: string; kind: "converge"; dream: DreamCue }
  | { id: string; kind: "dissolve" };

export interface DirectorLocks {
  arrival: boolean;
  threshold: boolean;
  activeKind: BodyCommand["kind"] | null;
}

export interface OfferingReceipt {
  offeringId: string;
  submittedAt: number;
  stage: ReceiptStage;
  eyeTranscriptId: string | null;
  keepTranscriptId: string | null;
  relicId: string | null;
  accretedAt: number | null;
}

export interface TempleExperience {
  state: TempleState | null;
  vitals: VitalsFeed;
  codex: ObservedTranscript[];
  relics: RelicEntry[];
  relicMemory: RelicInkSample[];
  receipts: OfferingReceipt[];
  activeCommand: BodyCommand | null;
  replayWitness: DreamCue | null;
  arrivalDone(): void;
  commandComplete(id: string): void;
  offeringAccepted(offeringId: string): void;
  setThresholdActive(active: boolean): void;
  replayDream(cue: DreamCue): void;
  replayAccretion(relic: AccretedRelic): Promise<void>;
}
