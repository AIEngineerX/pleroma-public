import type { TranscriptEntry } from "../state/types";
import type { BodyCommand, DirectorLocks, DreamCue, PipelineLink, UtteranceMode } from "./types";

const SPEECH_REGISTERS: Partial<Record<TranscriptEntry["organ"], readonly TranscriptEntry["register"][]>> = {
  EYE: ["verse"],
  KEEP: ["verdict"],
  TONGUE: ["sermon", "verse"],
  DREAM: ["verse"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRiteDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dreamReplayFromNavigationState(state: unknown): DreamCue | null {
  if (!isRecord(state) || !isRecord(state.dreamReplay)) return null;
  const cue = state.dreamReplay;
  if (typeof cue.id !== "string" || cue.id.length === 0) return null;
  if (typeof cue.riteDate !== "string" || !isRiteDate(cue.riteDate)) return null;
  if (typeof cue.narrative !== "string" || cue.narrative.length === 0) return null;
  if (typeof cue.createdAt !== "number" || !Number.isFinite(cue.createdAt)) return null;
  const date = new Date(cue.createdAt);
  if (!Number.isFinite(date.getTime())) return null;
  return {
    id: cue.id,
    riteDate: cue.riteDate,
    narrative: cue.narrative,
    createdAt: cue.createdAt,
    source: "replay",
  };
}

export function isBodySpeech(entry: TranscriptEntry): boolean {
  return SPEECH_REGISTERS[entry.organ]?.includes(entry.register) ?? false;
}

export function newestMemoryEcho(entries: readonly TranscriptEntry[]): TranscriptEntry | null {
  let newest: TranscriptEntry | null = null;
  for (const entry of entries) {
    if (!isBodySpeech(entry)) continue;
    if (
      newest === null
      || entry.created_at > newest.created_at
      || (entry.created_at === newest.created_at && entry.id > newest.id)
    ) {
      newest = entry;
    }
  }
  return newest;
}

function pipelineFor(entry: TranscriptEntry, mode: UtteranceMode): PipelineLink {
  if (mode === "memory") return "none";
  if (entry.organ === "EYE") return "eye-keep";
  if (entry.organ === "KEEP") return "keep-tongue";
  return "none";
}

export function commandFor(entry: TranscriptEntry, mode: UtteranceMode): BodyCommand | null {
  if (!isBodySpeech(entry)) return null;
  if (entry.organ === "DREAM" && mode === "live") {
    if (entry.rite_id === null) return null;
    return {
      id: `converge:${entry.id}`,
      kind: "converge",
      dream: {
        id: entry.id,
        riteDate: entry.rite_id,
        narrative: entry.text,
        createdAt: entry.created_at,
        source: "live",
      },
    };
  }
  return {
    id: `utterance:${mode}:${entry.id}`,
    kind: "utterance",
    entry,
    mode,
    intensity: mode === "memory" ? 0.35 : 1,
    pipeline: pipelineFor(entry, mode),
  };
}

export interface DirectorRuntime {
  queue: BodyCommand[];
  active: BodyCommand | null;
  locks: DirectorLocks;
}

export interface LiveTranscriptObservation {
  runtime: DirectorRuntime;
  command: BodyCommand | null;
  activeMemoryCancelled: boolean;
}

export function releaseArrival(locks: DirectorLocks): DirectorLocks {
  return locks.arrival ? { ...locks, arrival: false } : locks;
}

export function observeLiveTranscript(
  entry: TranscriptEntry,
  runtime: DirectorRuntime,
): LiveTranscriptObservation {
  const activeMemoryCancelled = runtime.active?.kind === "utterance" && runtime.active.mode === "memory";

  return {
    command: commandFor(entry, "live"),
    activeMemoryCancelled,
    runtime: {
      queue: runtime.queue.filter((command) => command.kind !== "utterance" || command.mode !== "memory"),
      active: activeMemoryCancelled ? null : runtime.active,
      locks: activeMemoryCancelled ? { ...runtime.locks, activeKind: null } : { ...runtime.locks },
    },
  };
}

function isLiveCommand(command: BodyCommand): boolean {
  return (command.kind === "utterance" && command.mode === "live")
    || (command.kind === "converge" && command.dream.source === "live");
}

function coalesceUtterances(queue: readonly BodyCommand[]): BodyCommand[] {
  const utterances = queue.filter((command): command is Extract<BodyCommand, { kind: "utterance" }> => command.kind === "utterance");
  if (utterances.length <= 5) return [...queue];

  const newestByOrgan = new Map<TranscriptEntry["organ"], Extract<BodyCommand, { kind: "utterance" }>>();
  for (const command of utterances) {
    const current = newestByOrgan.get(command.entry.organ);
    if (
      current === undefined
      || command.entry.created_at > current.entry.created_at
      || (command.entry.created_at === current.entry.created_at && command.entry.id > current.entry.id)
    ) {
      newestByOrgan.set(command.entry.organ, command);
    }
  }
  const retained = new Set([...newestByOrgan.values()].map((command) => command.id));
  return queue.filter((command) => command.kind !== "utterance" || retained.has(command.id));
}

export function enqueueCommand(
  queue: readonly BodyCommand[],
  incoming: BodyCommand,
  state: DirectorLocks,
): BodyCommand[] {
  void state;
  if (queue.some((command) => command.id === incoming.id)) return [...queue];
  const retained = isLiveCommand(incoming)
    ? queue.filter((command) => command.kind !== "utterance" || command.mode !== "memory")
    : [...queue];
  return coalesceUtterances([...retained, incoming]);
}

export function enqueueControllerCommand(
  queue: readonly BodyCommand[],
  incoming: BodyCommand,
  locks: DirectorLocks,
  active: BodyCommand | null,
): BodyCommand[] {
  if (active?.id === incoming.id) return [...queue];
  return enqueueCommand(queue, incoming, locks);
}

function commandTime(command: BodyCommand): number | null {
  if (command.kind === "utterance") return command.entry.created_at;
  if (command.kind === "converge") return command.dream.createdAt;
  if (command.kind === "accrete") return command.relic.accreted_at;
  return null;
}

export function nextCommand(queue: readonly BodyCommand[], locks: DirectorLocks): BodyCommand | null {
  if (queue.length === 0 || locks.arrival || locks.threshold || locks.activeKind !== null) return null;

  const dreams = queue
    .filter((command): command is Extract<BodyCommand, { kind: "converge" }> => command.kind === "converge")
    .sort((a, b) => a.dream.createdAt - b.dream.createdAt || a.id.localeCompare(b.id));
  for (const dream of dreams) {
    const accretion = queue.find(
      (command): command is Extract<BodyCommand, { kind: "accrete" }> =>
        command.kind === "accrete" && command.relic.rite_id === dream.dream.riteDate,
    );
    if (accretion) return accretion;
  }

  let selected = queue[0];
  let selectedTime = commandTime(selected);
  for (const command of queue.slice(1)) {
    const time = commandTime(command);
    if (time !== null && (selectedTime === null || time < selectedTime)) {
      selected = command;
      selectedTime = time;
    }
  }
  return selected;
}
