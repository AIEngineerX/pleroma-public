import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchCodex } from "../codex/codexClient";
import { fetchRelics } from "../reliquary/readClient";
import {
  isRelicEntry,
  isTempleState,
  type RelicEntry,
  type TempleState,
  type TranscriptEntry,
  type Vitals,
} from "../state/types";
import {
  commandFor,
  enqueueControllerCommand,
  newestMemoryEcho,
  nextCommand,
  observeLiveTranscript,
  releaseArrival,
} from "./director";
import { loadReceiptsSafely, reconcileReceipt, saveReceipts } from "./receipts";
import type {
  AccretedRelic,
  BodyCommand,
  DirectorLocks,
  DreamCue,
  ObservedTranscript,
  OfferingReceipt,
  RelicInkSample,
  TempleExperience,
  VitalsFeed,
} from "./types";

const NORMAL_POLL_MS = 5_000;
const RITE_POLL_MS = 2_000;
const RELIC_IDLE_POLL_MS = 30_000;
const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface VitalsFreshness {
  feed: VitalsFeed;
  consecutiveFailures: number;
}

export function createVitalsFreshness(): VitalsFreshness {
  return { feed: { kind: "unknown" }, consecutiveFailures: 0 };
}

export function recordVitalsSuccess(
  freshness: VitalsFreshness,
  value: Vitals,
  receivedAt: number,
): VitalsFreshness {
  void freshness;
  return { feed: { kind: "current", value, receivedAt }, consecutiveFailures: 0 };
}

export function recordVitalsFailure(freshness: VitalsFreshness, failedAt: number): VitalsFreshness {
  const consecutiveFailures = freshness.consecutiveFailures + 1;
  if (consecutiveFailures >= 3 && freshness.feed.kind === "current") {
    return {
      feed: { kind: "stale", value: freshness.feed.value, staleAt: failedAt },
      consecutiveFailures,
    };
  }
  return { feed: freshness.feed, consecutiveFailures };
}

export function shouldPoll(visibility: DocumentVisibilityState): boolean {
  return visibility === "visible";
}

export function pollResultIsCurrent(
  generation: number,
  currentGeneration: number,
  visibility: DocumentVisibilityState,
  disposed: boolean,
): boolean {
  return !disposed && shouldPoll(visibility) && generation === currentGeneration;
}

export type PollOutcome<T> = { kind: "success"; value: T } | { kind: "failure" };

export async function settlePoll<T>(work: () => Promise<T>): Promise<PollOutcome<T>> {
  try {
    return { kind: "success", value: await work() };
  } catch {
    return { kind: "failure" };
  }
}

export function commandRequiresRelicRefresh(command: BodyCommand): boolean {
  return command.kind === "converge" && command.dream.source === "live";
}

function chronological(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return [...entries].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
}

export function mergeObservedTranscripts(
  existing: readonly ObservedTranscript[],
  incoming: readonly TranscriptEntry[],
  liveIds: ReadonlySet<string>,
): ObservedTranscript[] {
  const byId = new Map(existing.map((observed) => [observed.entry.id, observed]));
  for (const entry of incoming) {
    const prior = byId.get(entry.id);
    byId.set(entry.id, {
      entry,
      observation: prior?.observation ?? (liveIds.has(entry.id) ? "live" : "recorded"),
    });
  }
  return [...byId.values()].sort(
    (a, b) => a.entry.created_at - b.entry.created_at || a.entry.id.localeCompare(b.entry.id),
  );
}

function mergeRelics(existing: readonly RelicEntry[], incoming: readonly RelicEntry[]): RelicEntry[] {
  const byId = new Map(existing.map((relic) => [relic.id, relic]));
  for (const relic of incoming) byId.set(relic.id, relic);
  return [...byId.values()].sort((a, b) => b.kept_at - a.kept_at || b.id.localeCompare(a.id));
}

export interface RelicPageTruth {
  relics: RelicEntry[];
  receipts: OfferingReceipt[];
}

export function reduceRelicPageTruth(
  existingRelics: readonly RelicEntry[],
  pageEntries: readonly RelicEntry[],
  receipts: readonly OfferingReceipt[],
  entries: readonly TranscriptEntry[],
): RelicPageTruth {
  const relics = mergeRelics(existingRelics, pageEntries);
  return {
    relics,
    receipts: receipts.map((receipt) => reconcileReceipt(receipt, entries, relics)),
  };
}

function receiptListsMatch(a: readonly OfferingReceipt[], b: readonly OfferingReceipt[]): boolean {
  return a.length === b.length && a.every((receipt, index) => {
    const other = b[index];
    return receipt.offeringId === other.offeringId
      && receipt.submittedAt === other.submittedAt
      && receipt.stage === other.stage
      && receipt.eyeTranscriptId === other.eyeTranscriptId
      && receipt.keepTranscriptId === other.keepTranscriptId
      && receipt.relicId === other.relicId
      && receipt.accretedAt === other.accretedAt;
  });
}

function newestReceipts(receipts: readonly OfferingReceipt[]): OfferingReceipt[] {
  return [...receipts]
    .sort((a, b) => b.submittedAt - a.submittedAt || b.offeringId.localeCompare(a.offeringId))
    .slice(0, 20);
}

export function requiresFastRelicPoll(
  state: TempleState | null,
  receipts: readonly OfferingReceipt[],
  now: number,
): boolean {
  if (state?.rite?.phase === "accretion") return true;
  return receipts.some(
    (receipt) => receipt.stage !== "accreted"
      && now - receipt.submittedAt < RECEIPT_WINDOW_MS,
  );
}

export function isAccretedRelic(relic: RelicEntry): relic is AccretedRelic {
  return relic.accreted_at !== null;
}

export function accretionAwaitsInkBeforeDream(
  relic: AccretedRelic,
  commands: readonly BodyCommand[],
  ink: RelicInkSample | undefined,
): boolean {
  return relicRefreshBlocksDream(commands, [relic], ink === undefined ? [] : [ink]);
}

export function relicRefreshBlocksDream(
  commands: readonly BodyCommand[],
  relics: readonly RelicEntry[],
  samples: readonly RelicInkSample[],
): boolean {
  const dreamRites = new Set(
    commands
      .filter((command): command is Extract<BodyCommand, { kind: "converge" }> =>
        command.kind === "converge" && command.dream.source === "live")
      .map((command) => command.dream.riteDate),
  );
  const sampledOfferings = new Set(samples.map((sample) => sample.offeringId));

  return relics.some(
    (relic) =>
      isAccretedRelic(relic)
      && relic.rite_id !== null
      && dreamRites.has(relic.rite_id)
      && !sampledOfferings.has(relic.offering_id),
  );
}

export interface TempleSourceGenerations {
  state: number;
  codex: number;
  relic: number;
}

export function createTempleSourceReset(generations: TempleSourceGenerations) {
  return {
    generations: {
      state: generations.state + 1,
      codex: generations.codex + 1,
      relic: generations.relic + 1,
    },
    state: null,
    vitalsFreshness: createVitalsFreshness(),
    codex: [] as ObservedTranscript[],
    relics: [] as RelicEntry[],
    relicMemory: [] as RelicInkSample[],
    activeCommand: null as BodyCommand | null,
    replayWitness: null as DreamCue | null,
    riteActive: false,
    codexBaseline: false,
    relicBaseline: false,
    seenCodexIds: new Set<string>(),
    relicAccretions: new Map<string, number | null>(),
    inkByOffering: new Map<string, RelicInkSample>(),
    queue: [] as BodyCommand[],
    locks: {
      arrival: true,
      threshold: false,
      activeKind: null,
    } satisfies DirectorLocks,
    dreamRelicBarrier: false,
    arrivalSettled: false,
  };
}

async function sampleRelicInk(apiBase: string, offeringId: string): Promise<RelicInkSample> {
  const response = await fetch(`${apiBase}/api/img/${encodeURIComponent(offeringId)}`);
  if (!response.ok) throw new Error(`relic ink fetch failed: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("relic ink canvas is unavailable");
    context.drawImage(bitmap, 0, 0, 64, 64);
    const rgba = context.getImageData(0, 0, 64, 64).data;
    const alpha = new Uint8Array(64 * 64);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
    return { offeringId, size: 64, alpha };
  } finally {
    bitmap.close();
  }
}

function loadPersistedReceipts(): OfferingReceipt[] {
  return typeof window === "undefined" ? [] : loadReceiptsSafely(() => window.localStorage);
}

export function useTempleExperience(apiBase: string): TempleExperience {
  const [state, setState] = useState<TempleState | null>(null);
  const [vitalsFreshness, setVitalsFreshness] = useState<VitalsFreshness>(createVitalsFreshness);
  const [codex, setCodex] = useState<ObservedTranscript[]>([]);
  const [relics, setRelics] = useState<RelicEntry[]>([]);
  const [relicMemory, setRelicMemory] = useState<RelicInkSample[]>([]);
  const [receipts, setReceipts] = useState<OfferingReceipt[]>(loadPersistedReceipts);
  const [activeCommand, setActiveCommand] = useState<BodyCommand | null>(null);
  const [replayWitness, setReplayWitness] = useState<DreamCue | null>(null);

  const stateRef = useRef<TempleState | null>(null);
  const codexRef = useRef<ObservedTranscript[]>([]);
  const relicsRef = useRef<RelicEntry[]>([]);
  const receiptsRef = useRef(receipts);
  const inkByOffering = useRef(new Map<string, RelicInkSample>());

  const stateGeneration = useRef(0);
  const codexGeneration = useRef(0);
  const relicGeneration = useRef(0);
  const riteActive = useRef(false);
  const codexBaseline = useRef(false);
  const relicBaseline = useRef(false);
  const seenCodexIds = useRef(new Set<string>());
  const relicAccretions = useRef(new Map<string, number | null>());
  const dreamRelicBarrier = useRef(false);
  const arrivalSettled = useRef(false);

  const codexWake = useRef<() => void>(() => undefined);
  const relicWake = useRef<() => void>(() => undefined);

  const queue = useRef<BodyCommand[]>([]);
  const active = useRef<BodyCommand | null>(null);
  const locks = useRef<DirectorLocks>({ arrival: true, threshold: false, activeKind: null });

  const dispatchNext = useCallback(() => {
    if (active.current !== null) return;
    const command = nextCommand(queue.current, locks.current);
    if (command === null) return;
    queue.current = queue.current.filter((queued) => queued.id !== command.id);
    active.current = command;
    locks.current = { ...locks.current, activeKind: command.kind };
    setActiveCommand(command);
  }, []);

  const enqueue = useCallback((command: BodyCommand) => {
    queue.current = enqueueControllerCommand(queue.current, command, locks.current, active.current);
    dispatchNext();
  }, [dispatchNext]);

  const observeLiveEntry = useCallback((entry: TranscriptEntry) => {
    const observation = observeLiveTranscript(entry, {
      queue: queue.current,
      active: active.current,
      locks: locks.current,
    });
    queue.current = observation.runtime.queue;
    active.current = observation.runtime.active;
    locks.current = observation.runtime.locks;
    if (observation.activeMemoryCancelled) setActiveCommand(null);
    return observation.command;
  }, []);

  const arrivalDone = useCallback(() => {
    if (arrivalSettled.current) return;
    arrivalSettled.current = true;
    if (dreamRelicBarrier.current) return;
    locks.current = releaseArrival(locks.current);
    dispatchNext();
  }, [dispatchNext]);

  const persistReceipts = useCallback((next: readonly OfferingReceipt[]) => {
    const normalized = newestReceipts(next);
    receiptsRef.current = normalized;
    setReceipts(normalized);
    if (typeof window !== "undefined") {
      try {
        saveReceipts(window.localStorage, normalized);
      } catch {
        // The accepted receipt remains truthful in memory when storage is unavailable.
      }
    }
  }, []);

  const reconcileReceipts = useCallback((entries: readonly TranscriptEntry[], currentRelics: readonly RelicEntry[]) => {
    const reconciled = receiptsRef.current.map((receipt) => reconcileReceipt(receipt, entries, currentRelics));
    if (!receiptListsMatch(receiptsRef.current, reconciled)) persistReceipts(reconciled);
  }, [persistReceipts]);

  const commandComplete = useCallback((id: string) => {
    const current = active.current;
    if (current === null || current.id !== id) return;
    if (current.kind === "converge" && current.dream.source === "replay") setReplayWitness(null);
    active.current = null;
    locks.current = { ...locks.current, activeKind: null };
    setActiveCommand(null);
    dispatchNext();
  }, [dispatchNext]);

  const offeringAccepted = useCallback((offeringId: string) => {
    const submittedAt = Date.now();
    const pending: OfferingReceipt = {
      offeringId,
      submittedAt,
      stage: "pending",
      eyeTranscriptId: null,
      keepTranscriptId: null,
      relicId: null,
      accretedAt: null,
    };
    const entries = codexRef.current.map((observed) => observed.entry);
    const reconciled = reconcileReceipt(pending, entries, relicsRef.current);
    persistReceipts([reconciled, ...receiptsRef.current.filter((receipt) => receipt.offeringId !== offeringId)]);
    relicWake.current();
  }, [persistReceipts]);

  const setThresholdActive = useCallback((threshold: boolean) => {
    locks.current = { ...locks.current, threshold };
    if (!threshold) dispatchNext();
  }, [dispatchNext]);

  const replayDream = useCallback((cue: DreamCue) => {
    const replay = { ...cue, source: "replay" as const };
    setReplayWitness(replay);
    enqueue({ id: `converge:replay:${cue.id}:${cue.createdAt}`, kind: "converge", dream: replay });
  }, [enqueue]);

  useLayoutEffect(() => {
    const reset = createTempleSourceReset({
      state: stateGeneration.current,
      codex: codexGeneration.current,
      relic: relicGeneration.current,
    });

    stateGeneration.current = reset.generations.state;
    codexGeneration.current = reset.generations.codex;
    relicGeneration.current = reset.generations.relic;
    stateRef.current = reset.state;
    codexRef.current = reset.codex;
    relicsRef.current = reset.relics;
    inkByOffering.current = reset.inkByOffering;
    riteActive.current = reset.riteActive;
    codexBaseline.current = reset.codexBaseline;
    relicBaseline.current = reset.relicBaseline;
    seenCodexIds.current = reset.seenCodexIds;
    relicAccretions.current = reset.relicAccretions;
    queue.current = reset.queue;
    active.current = reset.activeCommand;
    locks.current = reset.locks;
    dreamRelicBarrier.current = reset.dreamRelicBarrier;
    arrivalSettled.current = reset.arrivalSettled;
    codexWake.current = () => undefined;
    relicWake.current = () => undefined;

    setState(reset.state);
    setVitalsFreshness(reset.vitalsFreshness);
    setCodex(reset.codex);
    setRelics(reset.relics);
    setRelicMemory(reset.relicMemory);
    setActiveCommand(reset.activeCommand);
    setReplayWitness(reset.replayWitness);
  }, [apiBase]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function schedule() {
      clearTimer();
      if (!disposed && shouldPoll(document.visibilityState)) {
        timer = setTimeout(poll, riteActive.current ? RITE_POLL_MS : NORMAL_POLL_MS);
      }
    }

    async function poll() {
      const generation = ++stateGeneration.current;
      if (!shouldPoll(document.visibilityState)) return;
      try {
        const response = await fetch(`${apiBase}/api/state`);
        if (!response.ok) throw new Error(`state fetch failed: ${response.status}`);
        const candidate: unknown = await response.json();
        if (!isTempleState(candidate)) throw new Error("state fetch returned an invalid state");
        if (!pollResultIsCurrent(generation, stateGeneration.current, document.visibilityState, disposed)) return;

        const wasRiteActive = riteActive.current;
        const wasFastRelicPoll = requiresFastRelicPoll(stateRef.current, receiptsRef.current, Date.now());
        stateRef.current = candidate;
        riteActive.current = candidate.rite !== null;
        setState(candidate);
        setVitalsFreshness((current) => recordVitalsSuccess(current, candidate.vitals, Date.now()));
        if (riteActive.current !== wasRiteActive) codexWake.current();
        if (requiresFastRelicPoll(candidate, receiptsRef.current, Date.now()) !== wasFastRelicPoll) relicWake.current();
      } catch {
        if (pollResultIsCurrent(generation, stateGeneration.current, document.visibilityState, disposed)) {
          setVitalsFreshness((current) => recordVitalsFailure(current, Date.now()));
        }
      } finally {
        if (pollResultIsCurrent(generation, stateGeneration.current, document.visibilityState, disposed)) schedule();
      }
    }

    function wake() {
      stateGeneration.current += 1;
      clearTimer();
      if (shouldPoll(document.visibilityState)) void poll();
    }

    function onVisibility() {
      wake();
    }

    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      disposed = true;
      stateGeneration.current += 1;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apiBase]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    codexBaseline.current = false;
    seenCodexIds.current.clear();

    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function schedule() {
      clearTimer();
      if (!disposed && shouldPoll(document.visibilityState)) {
        timer = setTimeout(poll, riteActive.current ? RITE_POLL_MS : NORMAL_POLL_MS);
      }
    }

    async function poll() {
      const generation = ++codexGeneration.current;
      if (!shouldPoll(document.visibilityState)) return;
      await settlePoll(async () => {
        const page = await fetchCodex(apiBase, null);
        if (!pollResultIsCurrent(generation, codexGeneration.current, document.visibilityState, disposed)) return;
        const entries = chronological(page.entries);
        const isBaseline = !codexBaseline.current;
        const liveIds = new Set<string>();
        if (isBaseline) {
          for (const entry of entries) seenCodexIds.current.add(entry.id);
        } else {
          for (const entry of entries) {
            if (seenCodexIds.current.has(entry.id)) continue;
            seenCodexIds.current.add(entry.id);
            liveIds.add(entry.id);
          }
        }

        const merged = mergeObservedTranscripts(codexRef.current, entries, liveIds);
        codexRef.current = merged;
        setCodex(merged);
        reconcileReceipts(merged.map((observed) => observed.entry), relicsRef.current);

        if (isBaseline) {
          codexBaseline.current = true;
          const echo = newestMemoryEcho(entries);
          if (echo !== null) {
            const command = commandFor(echo, "memory");
            if (command !== null) enqueue(command);
          }
        } else {
          let refreshRelics = false;
          for (const entry of entries) {
            if (!liveIds.has(entry.id)) continue;
            const command = observeLiveEntry(entry);
            if (command === null) {
              dispatchNext();
              continue;
            }
            if (commandRequiresRelicRefresh(command)) {
              dreamRelicBarrier.current = true;
              locks.current = { ...locks.current, arrival: true };
              refreshRelics = true;
            }
            enqueue(command);
          }
          if (refreshRelics) relicWake.current();
        }
      });
      if (pollResultIsCurrent(generation, codexGeneration.current, document.visibilityState, disposed)) schedule();
    }

    function wake() {
      codexGeneration.current += 1;
      clearTimer();
      if (shouldPoll(document.visibilityState)) void poll();
    }

    function onVisibility() {
      wake();
    }

    codexWake.current = wake;
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      disposed = true;
      codexGeneration.current += 1;
      clearTimer();
      codexWake.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apiBase, dispatchNext, enqueue, observeLiveEntry, reconcileReceipts]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    relicBaseline.current = false;
    relicAccretions.current.clear();
    inkByOffering.current.clear();

    function clearTimer() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function schedule() {
      clearTimer();
      if (!disposed && shouldPoll(document.visibilityState)) {
        const delay = requiresFastRelicPoll(stateRef.current, receiptsRef.current, Date.now())
          || dreamRelicBarrier.current
          ? NORMAL_POLL_MS
          : RELIC_IDLE_POLL_MS;
        timer = setTimeout(poll, delay);
      }
    }

    async function poll() {
      const generation = ++relicGeneration.current;
      if (!shouldPoll(document.visibilityState)) return;
      await settlePoll(async () => {
        const page = await fetchRelics(apiBase, null);
        if (!Array.isArray(page.entries) || !page.entries.every(isRelicEntry)) {
          throw new Error("relic fetch returned an invalid page");
        }
        if (!pollResultIsCurrent(generation, relicGeneration.current, document.visibilityState, disposed)) return;

        const isBaseline = !relicBaseline.current;
        const truth = reduceRelicPageTruth(
          relicsRef.current,
          page.entries,
          receiptsRef.current,
          codexRef.current.map((observed) => observed.entry),
        );
        const merged = truth.relics;
        relicsRef.current = merged;
        setRelics(merged);
        if (!receiptListsMatch(receiptsRef.current, truth.receipts)) persistReceipts(truth.receipts);

        if (isBaseline) {
          for (const relic of page.entries) relicAccretions.current.set(relic.id, relic.accreted_at);
          relicBaseline.current = true;
        }

        const memoryRelics = merged.filter(isAccretedRelic);
        const missingOfferingIds = [...new Set(
          memoryRelics
            .map((relic) => relic.offering_id)
            .filter((offeringId) => !inkByOffering.current.has(offeringId)),
        )];
        const samples = await Promise.allSettled(
          missingOfferingIds.map((offeringId) => sampleRelicInk(apiBase, offeringId)),
        );
        if (!pollResultIsCurrent(generation, relicGeneration.current, document.visibilityState, disposed)) return;
        for (const result of samples) {
          if (result.status === "fulfilled") inkByOffering.current.set(result.value.offeringId, result.value);
        }

        if (!isBaseline) {
          for (const relic of page.entries) {
            const wasSeen = relicAccretions.current.has(relic.id);
            const previous = relicAccretions.current.get(relic.id);
            const ink = inkByOffering.current.get(relic.offering_id);
            const accretedAt = relic.accreted_at;
            if (accretedAt !== null && (!wasSeen || previous === null)) {
              const accretedRelic: AccretedRelic = { ...relic, accreted_at: accretedAt };
              if (ink !== undefined) {
                enqueue({
                  id: `accrete:${relic.id}:${accretedAt}`,
                  kind: "accrete",
                  relic: accretedRelic,
                  ink,
                });
                relicAccretions.current.set(relic.id, accretedAt);
              } else {
                relicAccretions.current.set(relic.id, null);
              }
            } else {
              relicAccretions.current.set(relic.id, accretedAt);
            }
          }
        }

        setRelicMemory(
          memoryRelics
            .map((relic) => inkByOffering.current.get(relic.offering_id))
            .filter((sample): sample is RelicInkSample => sample !== undefined),
        );
        const dreamBlocked = relicRefreshBlocksDream(
          queue.current,
          merged,
          [...inkByOffering.current.values()],
        );
        if (dreamRelicBarrier.current && !dreamBlocked) {
          dreamRelicBarrier.current = false;
          locks.current = { ...locks.current, arrival: !arrivalSettled.current };
          dispatchNext();
        }
      });
      if (pollResultIsCurrent(generation, relicGeneration.current, document.visibilityState, disposed)) schedule();
    }

    function wake() {
      relicGeneration.current += 1;
      clearTimer();
      if (shouldPoll(document.visibilityState)) void poll();
    }

    function onVisibility() {
      wake();
    }

    relicWake.current = wake;
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      disposed = true;
      relicGeneration.current += 1;
      clearTimer();
      relicWake.current = () => undefined;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [apiBase, dispatchNext, enqueue, persistReceipts]);

  return {
    state,
    vitals: vitalsFreshness.feed,
    codex,
    relics,
    relicMemory,
    receipts,
    activeCommand,
    replayWitness,
    arrivalDone,
    commandComplete,
    offeringAccepted,
    setThresholdActive,
    replayDream,
  };
}
