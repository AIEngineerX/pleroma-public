import { describe, expect, it } from "vitest";
import * as templeExperienceModule from "../src/experience/useTempleExperience";
import {
  commandFor,
  enqueueControllerCommand,
  enqueueCommand,
  isBodySpeech,
  newestMemoryEcho,
  nextCommand,
  observeLiveTranscript,
  releaseArrival,
} from "../src/experience/director";
import type {
  AccretedRelic,
  BodyCommand,
  DirectorLocks,
  DreamCue,
  ObservedTranscript,
  OfferingReceipt,
  RelicInkSample,
  VitalsFeed,
} from "../src/experience/types";
import {
  accretionAwaitsInkBeforeDream,
  activateRelicCommand,
  completeRelicCommand,
  commandRequiresRelicRefresh,
  createRelicAccretionLedger,
  createTempleSourceReset,
  createVitalsFreshness,
  isAccretedRelic,
  mergeObservedTranscripts,
  pollResultIsCurrent,
  planRelicRefresh,
  RELIC_SAMPLE_CONCURRENCY,
  recordVitalsFailure,
  recordVitalsSuccess,
  reduceRelicPageTruth,
  relicMemoryFromLedger,
  relicRefreshBlocksDream,
  requiresFastRelicPoll,
  runRelicSampleQueue,
  settleRelicSample,
  settlePoll,
  shouldPoll,
} from "../src/experience/useTempleExperience";
import { RELIC_MEMORY_LIMIT, foldRelicSamples, relicAccretionKey } from "../src/stain/relicInk";
import type { RelicEntry, TranscriptEntry, Vitals } from "../src/state/types";

const unlocked: DirectorLocks = { arrival: false, threshold: false, activeKind: null };

function e(
  id: string,
  createdAt: number,
  organ: TranscriptEntry["organ"],
  register: TranscriptEntry["register"],
  riteId: string | null = null,
  offeringId: string | null = null,
): TranscriptEntry {
  return {
    id,
    organ,
    register,
    text: `${organ} ${id}`,
    offering_id: offeringId,
    rite_id: riteId,
    created_at: createdAt,
  };
}

function required<T>(value: T | null): T {
  expect(value).not.toBeNull();
  if (value === null) throw new Error("expected a command");
  return value;
}

function utterance(value: BodyCommand | null): Extract<BodyCommand, { kind: "utterance" }> {
  expect(value?.kind).toBe("utterance");
  if (value === null || value.kind !== "utterance") throw new Error("expected an utterance command");
  return value;
}

describe("experience director transcript truth", () => {
  it("publishes the shared observation and feed shapes", () => {
    const observation: ObservedTranscript = { entry: e("eye", 1, "EYE", "verse"), observation: "recorded" };
    const feed: VitalsFeed = { kind: "unknown" };
    expect(observation.observation).toBe("recorded");
    expect(feed.kind).toBe("unknown");
  });

  it("maps only genuine body speech to truthful commands", () => {
    expect(utterance(commandFor(e("eye", 1, "EYE", "verse"), "live")).pipeline).toBe("eye-keep");
    expect(utterance(commandFor(e("keep", 2, "KEEP", "verdict"), "memory")).pipeline).toBe("none");
    expect(utterance(commandFor(e("tongue", 3, "TONGUE", "sermon"), "live")).intensity).toBe(1);
    expect(commandFor(e("tongue-verse", 4, "TONGUE", "verse"), "live")?.kind).toBe("utterance");
    expect(commandFor(e("pulse", 5, "PULSE", "telemetry"), "live")).toBeNull();
    expect(commandFor(e("priest", 6, "PRIEST", "system"), "live")).toBeNull();
    expect(commandFor(e("dream-memory", 7, "DREAM", "verse", "2030-01-01"), "memory")?.kind).toBe("utterance");
    expect(commandFor(e("dream-live", 8, "DREAM", "verse", "2030-01-01"), "live")?.kind).toBe("converge");
  });

  it("uses memory intensity and requires a rite for live DREAM convergence", () => {
    expect(utterance(commandFor(e("memory", 1, "EYE", "verse"), "memory")).intensity).toBe(0.35);
    expect(commandFor(e("orphan-dream", 2, "DREAM", "verse"), "live")).toBeNull();
  });

  it("converges only a genuine live DREAM while the same baseline row remains an echo", () => {
    const dream = e("dream-sequence", 3, "DREAM", "verse", "2030-01-02");
    expect(commandFor(dream, "memory")).toMatchObject({
      kind: "utterance",
      mode: "memory",
      pipeline: "none",
    });
    expect(commandFor(dream, "live")).toMatchObject({
      kind: "converge",
      dream: { id: dream.id, source: "live", riteDate: "2030-01-02" },
    });
  });

  it("recognizes body speech and chooses only the newest eligible memory echo", () => {
    const entries = [
      e("eye", 1, "EYE", "verse"),
      e("dream", 4, "DREAM", "verse", "2030-01-01"),
      e("pulse", 6, "PULSE", "telemetry"),
      e("priest", 7, "PRIEST", "system"),
    ];
    expect(isBodySpeech(entries[0])).toBe(true);
    expect(isBodySpeech(entries[2])).toBe(false);
    expect(newestMemoryEcho(entries)?.id).toBe("dream");
  });
});

describe("experience director queue", () => {
  it("publishes a live canonical row immediately while ARRIVAL_DONE still gates its body command", () => {
    const entry = e("arrival-eye", 2, "EYE", "verse");
    const arrival = { ...unlocked, arrival: true };
    const observed = mergeObservedTranscripts([], [entry], new Set([entry.id]));
    const command = required(commandFor(entry, "live"));
    const queue = enqueueCommand([], command, arrival);

    expect(observed).toEqual([{ entry, observation: "live" }]);
    expect(nextCommand(queue, arrival)).toBeNull();
    expect(nextCommand(queue, releaseArrival(arrival))).toBe(command);
  });

  it("queues during arrival and withholds work while any visual lock is active", () => {
    const command = required(commandFor(e("eye", 1, "EYE", "verse"), "live"));
    const arrival = { ...unlocked, arrival: true };
    const queue = enqueueCommand([], command, arrival);
    expect(queue).toEqual([command]);
    expect(nextCommand(queue, arrival)).toBeNull();
    expect(nextCommand(queue, { ...unlocked, threshold: true })).toBeNull();
    expect(nextCommand(queue, { ...unlocked, activeKind: "utterance" })).toBeNull();
  });

  it("cancels queued memory when a live row arrives", () => {
    const memory = required(commandFor(e("memory", 1, "EYE", "verse"), "memory"));
    const live = required(commandFor(e("live", 2, "TONGUE", "sermon"), "live"));
    const queue = enqueueCommand(enqueueCommand([], memory, unlocked), live, unlocked);
    expect(queue).toEqual([live]);
  });

  it("runs same-rite accretion before DREAM, then DREAM before later ordinary speech", () => {
    const riteDate = "2030-01-01";
    const speech = required(commandFor(e("speech", 30, "TONGUE", "sermon"), "live"));
    const dream = required(commandFor(e("dream", 20, "DREAM", "verse", riteDate), "live"));
    const relic: AccretedRelic = {
      id: "relic",
      offering_id: "offering",
      wallet: null,
      summary: "a kept mark",
      rite_id: riteDate,
      kept_at: 10,
      genesis: 0,
      accreted_at: 21,
    };
    const ink: RelicInkSample = { offeringId: "offering", size: 64, alpha: new Uint8Array(64 * 64) };
    const accrete: BodyCommand = { id: "accrete:relic", kind: "accrete", relic, ink };
    expect(nextCommand([speech, dream, accrete], unlocked)).toBe(accrete);
    expect(nextCommand([speech, dream], unlocked)).toBe(dream);
  });

  it("holds an asynchronously arrived live DREAM through a Relic refresh", () => {
    const riteDate = "2030-01-01";
    const dream = required(commandFor(e("dream", 20, "DREAM", "verse", riteDate), "live"));
    const waiting = { ...unlocked, arrival: commandRequiresRelicRefresh(dream) };
    let queue = enqueueCommand([], dream, waiting);
    expect(nextCommand(queue, waiting)).toBeNull();

    const relic: AccretedRelic = {
      id: "relic",
      offering_id: "offering",
      wallet: null,
      summary: "the same rite",
      rite_id: riteDate,
      kept_at: 10,
      genesis: 0,
      accreted_at: 21,
    };
    const ink: RelicInkSample = { offeringId: "offering", size: 64, alpha: new Uint8Array(64 * 64) };
    const accrete: BodyCommand = { id: "accrete:relic", kind: "accrete", relic, ink };
    expect(accretionAwaitsInkBeforeDream(relic, [dream], undefined)).toBe(true);
    expect(accretionAwaitsInkBeforeDream(relic, [dream], relicAccretionKey(relic))).toBe(false);
    queue = enqueueCommand(queue, accrete, waiting);
    expect(nextCommand(queue, { ...waiting, arrival: false })).toBe(accrete);
  });

  it("drains all twelve same-rite accretions before one live DREAM and later speech", async () => {
    const riteDate = "2030-01-01";
    const dream = required(commandFor(e("dream-twelve", 1_000, "DREAM", "verse", riteDate), "live"));
    const speech = required(commandFor(e("speech-after-dream", 2_000, "TONGUE", "sermon"), "live"));
    const relics: AccretedRelic[] = Array.from({ length: 12 }, (_, index) => ({
      id: `rite-relic-${index}`,
      offering_id: `rite-offering-${index}`,
      wallet: null,
      summary: `same-rite relic ${index}`,
      rite_id: riteDate,
      kept_at: 100 + index,
      genesis: 0,
      accreted_at: 500 + index,
    }));
    const waiting = { ...unlocked, arrival: true };
    let commandQueue = enqueueCommand(enqueueCommand([], dream, waiting), speech, waiting);
    let ledger = createRelicAccretionLedger();
    const planned = planRelicRefresh(ledger, relics, 1, false, commandQueue);
    ledger = planned.ledger;

    expect(relicRefreshBlocksDream(commandQueue, relics, [])).toBe(true);
    expect(planned.requests).toHaveLength(12);

    let activeFetches = 0;
    let maxActiveFetches = 0;
    await runRelicSampleQueue(
      planned.requests,
      new AbortController().signal,
      async (request) => {
        activeFetches += 1;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeFetches -= 1;
        return {
          offeringId: request.relic.offering_id,
          size: 64,
          alpha: new Uint8Array(64 * 64).fill(120),
        } satisfies RelicInkSample;
      },
      (request, ink) => {
        const settled = settleRelicSample(ledger, request, ink, 1);
        ledger = settled.ledger;
        expect(settled.command).not.toBeNull();
        if (settled.command !== null) {
          commandQueue = enqueueControllerCommand(commandQueue, settled.command, waiting, null);
        }
      },
    );

    expect(maxActiveFetches).toBeLessThanOrEqual(RELIC_SAMPLE_CONCURRENCY);
    expect(relicRefreshBlocksDream(
      commandQueue,
      relics,
      [...ledger.samplesByKey.keys()],
    )).toBe(false);

    const completed: BodyCommand[] = [];
    let locks = { ...waiting, arrival: false };
    while (commandQueue.length > 0) {
      const command = required(nextCommand(commandQueue, locks));
      commandQueue = commandQueue.filter((queued) => queued.id !== command.id);
      if (command.kind === "accrete") ledger = activateRelicCommand(ledger, command);
      locks = { ...locks, activeKind: command.kind };
      expect(nextCommand(commandQueue, locks)).toBeNull();
      completed.push(command);
      if (command.kind === "accrete") ledger = completeRelicCommand(ledger, command);
      locks = { ...locks, activeKind: null };
    }

    expect(completed.slice(0, 12).every((command) => command.kind === "accrete")).toBe(true);
    expect(ledger.incorporated.size).toBe(12);
    expect(completed.filter((command) => command.id === dream.id)).toHaveLength(1);
    expect(completed.at(-1)?.id).toBe(speech.id);
  });

  it("keeps a pre-baseline DREAM blocked only while matching accreted ink is missing", () => {
    const riteDate = "2030-01-01";
    const dream = required(commandFor(e("dream", 20, "DREAM", "verse", riteDate), "live"));
    const relic: AccretedRelic = {
      id: "relic",
      offering_id: "offering",
      wallet: null,
      summary: "same rite",
      rite_id: riteDate,
      kept_at: 10,
      genesis: 0,
      accreted_at: 21,
    };
    expect(relicRefreshBlocksDream([dream], [relic], [])).toBe(true);
    expect(relicRefreshBlocksDream([dream], [relic], [relicAccretionKey(relic)])).toBe(false);
    expect(relicRefreshBlocksDream([dream], [{ ...relic, accreted_at: null }], [])).toBe(false);
  });

  it("does not let an older sample for the same offering release a newer accretion DREAM", () => {
    const riteDate = "2030-01-01";
    const dream = required(commandFor(e("dream-new-timestamp", 220, "DREAM", "verse", riteDate), "live"));
    const newer: AccretedRelic = {
      id: "relic-newer",
      offering_id: "same-offering",
      wallet: null,
      summary: "the offering changed at accretion",
      rite_id: riteDate,
      kept_at: 100,
      genesis: 0,
      accreted_at: 200,
    };
    const older = { ...newer, accreted_at: 100 } satisfies AccretedRelic;

    expect(relicRefreshBlocksDream([dream], [newer], [relicAccretionKey(older)])).toBe(true);
    expect(accretionAwaitsInkBeforeDream(newer, [dream], relicAccretionKey(older))).toBe(true);
  });

  it("cancels queued and active memory for every genuine live row before command mapping", () => {
    const memory = utterance(commandFor(e("memory", 1, "EYE", "verse"), "memory"));
    const runtime = {
      queue: [memory],
      active: memory,
      locks: { ...unlocked, activeKind: "utterance" as const },
    };
    for (const row of [e("pulse", 2, "PULSE", "telemetry"), e("priest", 3, "PRIEST", "system")]) {
      const observed = observeLiveTranscript(row, runtime);
      expect(observed.command).toBeNull();
      expect(observed.runtime.queue).toEqual([]);
      expect(observed.runtime.active).toBeNull();
      expect(observed.runtime.locks.activeKind).toBeNull();
      expect(observed.activeMemoryCancelled).toBe(true);
    }
  });

  it("does not queue an incoming command whose ID is already active", () => {
    const replay: BodyCommand = {
      id: "converge:replay:dream:100",
      kind: "converge",
      dream: { id: "dream", riteDate: "2030-01-01", narrative: "again", createdAt: 100, source: "replay" },
    };
    expect(enqueueControllerCommand([], replay, { ...unlocked, activeKind: "converge" }, replay)).toEqual([]);
    expect(enqueueControllerCommand([], replay, unlocked, null)).toEqual([replay]);
  });

  it("coalesces more than five queued utterances to the newest one per organ", () => {
    const organs: TranscriptEntry["organ"][] = ["EYE", "KEEP", "TONGUE", "EYE", "KEEP", "TONGUE"];
    const registers: TranscriptEntry["register"][] = ["verse", "verdict", "sermon", "verse", "verdict", "sermon"];
    let queue: BodyCommand[] = [];
    for (let index = 0; index < organs.length; index += 1) {
      const command = required(commandFor(e(`u${index + 1}`, index + 1, organs[index], registers[index]), "live"));
      queue = enqueueCommand(queue, command, unlocked);
    }
    expect(queue.map((command) => command.id)).toEqual([
      "utterance:live:u4",
      "utterance:live:u5",
      "utterance:live:u6",
    ]);
  });

  it("de-duplicates every command ID", () => {
    const command = required(commandFor(e("eye", 1, "EYE", "verse"), "live"));
    const once = enqueueCommand([], command, unlocked);
    expect(enqueueCommand(once, command, unlocked)).toEqual(once);
  });
});

describe("controller polling truth", () => {
  const starving: Vitals = { state: "starving", buys: 0, sells: 0, holders: 0 };
  const fed: Vitals = { state: "fed", buys: 2, sells: 1, holders: 8 };

  it("keeps PULSE unknown until success, stales on failure three, and recovers to current", () => {
    let freshness = createVitalsFreshness();
    expect(freshness).toEqual({ feed: { kind: "unknown" }, consecutiveFailures: 0 });

    freshness = recordVitalsSuccess(freshness, starving, 100);
    expect(freshness.feed).toEqual({ kind: "current", value: starving, receivedAt: 100 });

    freshness = recordVitalsFailure(freshness, 200);
    expect(freshness.feed).toEqual({ kind: "current", value: starving, receivedAt: 100 });
    freshness = recordVitalsFailure(freshness, 300);
    expect(freshness.feed).toEqual({ kind: "current", value: starving, receivedAt: 100 });
    freshness = recordVitalsFailure(freshness, 400);
    expect(freshness.feed).toEqual({ kind: "stale", value: starving, staleAt: 400 });

    freshness = recordVitalsSuccess(freshness, fed, 500);
    expect(freshness).toEqual({ feed: { kind: "current", value: fed, receivedAt: 500 }, consecutiveFailures: 0 });
  });

  it("pauses hidden tabs and accepts only the latest visible, undisposed generation", () => {
    expect(shouldPoll("hidden")).toBe(false);
    expect(shouldPoll("visible")).toBe(true);
    expect(pollResultIsCurrent(2, 2, "visible", false)).toBe(true);
    expect(pollResultIsCurrent(1, 2, "visible", false)).toBe(false);
    expect(pollResultIsCurrent(2, 2, "hidden", false)).toBe(false);
    expect(pollResultIsCurrent(2, 2, "visible", true)).toBe(false);

    let freshness = recordVitalsSuccess(createVitalsFreshness(), starving, 100);
    const ignored = [
      pollResultIsCurrent(1, 2, "visible", false),
      pollResultIsCurrent(2, 2, "hidden", false),
      pollResultIsCurrent(2, 2, "visible", true),
    ];
    for (const settles of ignored) {
      if (settles) freshness = recordVitalsFailure(freshness, 200);
    }
    expect(freshness.consecutiveFailures).toBe(0);
    expect(freshness.feed.kind).toBe("current");
  });

  it("settles a failed feed poll without rejecting its fire-and-forget chain", async () => {
    const outcome = await settlePoll(async () => {
      throw new Error("feed unavailable");
    });
    expect(outcome).toEqual({ kind: "failure" });
  });

  it("delivers relic samples incrementally through a small bounded scheduler", async () => {
    type RelicQueue = <Input, Output>(
      inputs: readonly Input[],
      signal: AbortSignal,
      sample: (input: Input, signal: AbortSignal) => Promise<Output>,
      deliver: (input: Input, output: Output | null) => void,
    ) => Promise<void>;
    const queueModule = templeExperienceModule as unknown as {
      RELIC_SAMPLE_CONCURRENCY?: number;
      runRelicSampleQueue?: RelicQueue;
    };
    const concurrency = queueModule.RELIC_SAMPLE_CONCURRENCY;
    const runQueue = queueModule.runRelicSampleQueue;
    expect(concurrency).toBe(4);
    expect(runQueue).toBeTypeOf("function");
    if (runQueue === undefined || concurrency === undefined) return;

    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      return { promise, resolve, reject };
    }

    const gates = Array.from({ length: 4 }, () => deferred<string>());
    const saturated = deferred<void>();
    const firstDelivered = deferred<void>();
    const started: number[] = [];
    const delivered: number[] = [];
    let active = 0;
    let maxActive = 0;
    const running = runQueue(
      [0, 1, 2, 3, 4, 5, 6],
      new AbortController().signal,
      async (input) => {
        started.push(input);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (active === concurrency) saturated.resolve();
        try {
          return input < gates.length ? await gates[input].promise : `ink-${input}`;
        } finally {
          active -= 1;
        }
      },
      (input) => {
        delivered.push(input);
        if (input === 0) firstDelivered.resolve();
      },
    );

    await saturated.promise;
    expect(started).toEqual([0, 1, 2, 3]);
    expect(delivered).toEqual([]);

    gates[0].resolve("ink-0");
    await firstDelivered.promise;
    expect(delivered[0]).toBe(0);
    expect(started).toContain(4);
    expect(maxActive).toBeLessThanOrEqual(concurrency);

    for (const index of [1, 2, 3]) gates[index].resolve(`ink-${index}`);
    await running;
    expect(new Set(delivered)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(maxActive).toBeLessThanOrEqual(concurrency);
  });

  it("keeps a young kept receipt on the fast cadence until it accretes", () => {
    const kept: OfferingReceipt = {
      offeringId: "offering",
      submittedAt: 100,
      stage: "kept",
      eyeTranscriptId: "eye",
      keepTranscriptId: "keep",
      relicId: "relic",
      accretedAt: null,
    };
    expect(requiresFastRelicPoll(null, [kept], 200)).toBe(true);
    expect(requiresFastRelicPoll(null, [{ ...kept, stage: "accreted", accretedAt: 180 }], 200)).toBe(false);
    expect(requiresFastRelicPoll(null, [kept], 100 + 24 * 60 * 60 * 1_000)).toBe(false);
  });

  it("admits only accreted relics into body memory", () => {
    const kept: RelicEntry = {
      id: "kept",
      offering_id: "offering",
      wallet: null,
      summary: "kept",
      rite_id: "2030-01-01",
      kept_at: 100,
      genesis: 0,
      accreted_at: null,
    };
    expect(isAccretedRelic(kept)).toBe(false);
    expect(isAccretedRelic({ ...kept, accreted_at: 200 })).toBe(true);
  });

  it("reduces Relic and receipt truth without waiting for ink sampling", () => {
    const pending: OfferingReceipt = {
      offeringId: "offering",
      submittedAt: 100,
      stage: "pending",
      eyeTranscriptId: null,
      keepTranscriptId: null,
      relicId: null,
      accretedAt: null,
    };
    const accreted: RelicEntry = {
      id: "relic",
      offering_id: "offering",
      wallet: null,
      summary: "truth first",
      rite_id: "2030-01-01",
      kept_at: 200,
      genesis: 0,
      accreted_at: 300,
    };
    const truth = reduceRelicPageTruth([], [accreted], [pending], []);
    expect(truth.relics).toEqual([accreted]);
    expect(truth.receipts[0]).toMatchObject({ stage: "accreted", relicId: "relic", accretedAt: 300 });
  });

  it("retries failed accreted ink on the next generation and incorporates only on command completion", () => {
    const kept: RelicEntry = {
      id: "relic",
      offering_id: "offering",
      wallet: null,
      summary: "truth before paint",
      rite_id: "2030-01-01",
      kept_at: 200,
      genesis: 0,
      accreted_at: null,
    };
    let ledger = createRelicAccretionLedger();

    const baseline = planRelicRefresh(ledger, [kept], 1, true);
    ledger = baseline.ledger;
    expect(baseline.requests).toEqual([]);

    const confirmed = { ...kept, accreted_at: 300 } satisfies AccretedRelic;
    const first = planRelicRefresh(ledger, [confirmed], 2, false);
    ledger = first.ledger;
    expect(first.requests).toHaveLength(1);
    expect(ledger.inFlight).toEqual(new Set(["offering\u001f300"]));
    expect(relicMemoryFromLedger(ledger)).toEqual([]);

    const failed = settleRelicSample(ledger, first.requests[0], null, 2);
    ledger = failed.ledger;
    expect(failed.command).toBeNull();
    expect(failed.hydrated).toBe(false);
    expect(ledger.inFlight.size).toBe(0);
    expect(relicMemoryFromLedger(ledger)).toEqual([]);

    const sameGeneration = planRelicRefresh(ledger, [confirmed], 2, false);
    ledger = sameGeneration.ledger;
    expect(sameGeneration.requests).toEqual([]);

    const retry = planRelicRefresh(ledger, [confirmed], 3, false);
    ledger = retry.ledger;
    expect(retry.requests).toHaveLength(1);
    const ink: RelicInkSample = {
      offeringId: confirmed.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill(180),
    };
    const succeeded = settleRelicSample(ledger, retry.requests[0], ink, 3);
    ledger = succeeded.ledger;
    expect(succeeded.command?.id).toBe("accrete:relic:300");
    expect(ledger.queued).toEqual(new Set(["offering\u001f300"]));
    expect(ledger.incorporated.size).toBe(0);
    expect(relicMemoryFromLedger(ledger)).toEqual([]);

    const whileQueued = planRelicRefresh(ledger, [confirmed], 4, false);
    ledger = whileQueued.ledger;
    expect(whileQueued.requests).toEqual([]);

    ledger = activateRelicCommand(ledger, succeeded.command!);
    expect(ledger.queued.size).toBe(0);
    expect(ledger.active).toEqual(new Set(["offering\u001f300"]));
    expect(relicMemoryFromLedger(ledger)).toEqual([]);
    const whileActive = planRelicRefresh(ledger, [confirmed], 5, false);
    ledger = whileActive.ledger;
    expect(whileActive.requests).toEqual([]);

    const other: BodyCommand = {
      ...succeeded.command!,
      id: "accrete:other:999",
      relic: { ...confirmed, id: "other", offering_id: "other-offering", accreted_at: 999 },
      ink: { ...ink, offeringId: "other-offering" },
    };
    expect(completeRelicCommand(ledger, other)).toBe(ledger);
    expect(ledger.active).toEqual(new Set(["offering\u001f300"]));
    expect(ledger.incorporated.size).toBe(0);

    ledger = completeRelicCommand(ledger, succeeded.command!);
    expect(ledger.active.size).toBe(0);
    expect(ledger.incorporated).toEqual(new Set(["offering\u001f300"]));
    expect(relicMemoryFromLedger(ledger)).toEqual([ink]);
    expect(planRelicRefresh(ledger, [confirmed], 6, false).requests).toEqual([]);

    // A visitor-triggered replay of this SAME already-incorporated relic (Stain.tsx's
    // "watch it enter the body again") carries a distinctly-prefixed "accrete:replay:..." id --
    // it can never equal the real "accrete:{id}:{accreted_at}" id completeRelicCommand checks for,
    // so both ledger functions treat it as a complete no-op: no re-queueing, no double-incorporation.
    const replay: BodyCommand = {
      id: `accrete:replay:${confirmed.offering_id}:${confirmed.accreted_at}`,
      kind: "accrete",
      relic: confirmed,
      ink,
    };
    expect(activateRelicCommand(ledger, replay)).toBe(ledger);
    expect(completeRelicCommand(ledger, replay)).toBe(ledger);
    expect(relicMemoryFromLedger(ledger)).toEqual([ink]);
  });

  it("hydrates baseline accreted relics quietly and ignores stale sampling settlements", () => {
    const confirmed: AccretedRelic = {
      id: "old-relic",
      offering_id: "old-offering",
      wallet: null,
      summary: "recorded memory",
      rite_id: null,
      kept_at: 100,
      genesis: 0,
      accreted_at: 120,
    };
    let ledger = createRelicAccretionLedger();
    const baseline = planRelicRefresh(ledger, [confirmed], 10, true);
    ledger = baseline.ledger;
    expect(baseline.requests).toHaveLength(1);

    const nextGeneration = planRelicRefresh(ledger, [confirmed], 11, false);
    ledger = nextGeneration.ledger;
    expect(nextGeneration.requests).toHaveLength(1);
    const ink: RelicInkSample = {
      offeringId: confirmed.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill(120),
    };

    const stale = settleRelicSample(ledger, baseline.requests[0], ink, 10);
    expect(stale.ledger).toBe(ledger);
    expect(stale.command).toBeNull();
    expect(relicMemoryFromLedger(stale.ledger)).toEqual([]);

    const current = settleRelicSample(ledger, nextGeneration.requests[0], ink, 11);
    expect(current.command).toBeNull();
    expect(current.hydrated).toBe(true);
    expect(current.ledger.incorporated).toEqual(new Set(["old-offering\u001f120"]));
    expect(relicMemoryFromLedger(current.ledger)).toEqual([ink]);
  });

  it("bounds quiet body memory to the newest fifty relics", () => {
    const entries: AccretedRelic[] = Array.from({ length: 51 }, (_, index) => ({
      id: `relic-${index}`,
      offering_id: `offering-${index}`,
      wallet: null,
      summary: `memory ${index}`,
      rite_id: null,
      kept_at: 1_000 - index,
      genesis: 0,
      accreted_at: 2_000 + index,
    }));
    let ledger = createRelicAccretionLedger();
    const planned = planRelicRefresh(ledger, entries, 20, true);
    ledger = planned.ledger;
    expect(planned.requests).toHaveLength(50);
    for (const request of [...planned.requests].reverse()) {
      const ink: RelicInkSample = {
        offeringId: request.relic.offering_id,
        size: 64,
        alpha: new Uint8Array(64 * 64).fill(32),
      };
      ledger = settleRelicSample(ledger, request, ink, 20).ledger;
    }
    expect(relicMemoryFromLedger(ledger).map((ink) => ink.offeringId)).toEqual(
      entries.slice(0, 50).map((entry) => entry.offering_id),
    );
    expect(relicMemoryFromLedger(ledger)).toHaveLength(50);
  });

  it("keeps rotating first-page relic truth, ledger keys, and decoded samples bounded", () => {
    const makeRelic = (sequence: number): AccretedRelic => ({
      id: `rotation-relic-${sequence}`,
      offering_id: `rotation-offering-${sequence}`,
      wallet: null,
      summary: `rotating memory ${sequence}`,
      rite_id: null,
      kept_at: sequence,
      genesis: 0,
      accreted_at: 10_000 + sequence,
    });
    const makeInk = (relic: AccretedRelic): RelicInkSample => ({
      offeringId: relic.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill((relic.kept_at % 200) + 1),
    });

    let page = Array.from({ length: 50 }, (_, index) => makeRelic(50 - index));
    let truth = reduceRelicPageTruth([], page, [], []);
    let ledger = createRelicAccretionLedger();
    const baseline = planRelicRefresh(ledger, truth.relics, 1, true);
    ledger = baseline.ledger;
    for (const request of baseline.requests) {
      ledger = settleRelicSample(ledger, request, makeInk(request.relic), 1).ledger;
    }

    for (let generation = 2; generation <= 76; generation += 1) {
      const newest = makeRelic(49 + generation);
      page = [newest, ...page.slice(0, 49)];
      truth = reduceRelicPageTruth(truth.relics, page, [], []);
      const planned = planRelicRefresh(ledger, truth.relics, generation, false);
      ledger = planned.ledger;
      expect(planned.requests).toHaveLength(1);
      const settled = settleRelicSample(
        ledger,
        planned.requests[0],
        makeInk(planned.requests[0].relic),
        generation,
      );
      ledger = settled.ledger;
      expect(settled.command).not.toBeNull();
      if (settled.command === null) throw new Error("expected rotating accretion command");
      ledger = activateRelicCommand(ledger, settled.command);
      ledger = completeRelicCommand(ledger, settled.command);
    }

    expect.soft(truth.relics).toEqual(page);
    expect.soft(truth.relics).toHaveLength(50);
    expect.soft(Object.hasOwn(ledger, "observedTimestamps")).toBe(false);
    expect.soft(Object.hasOwn(ledger, "memoryByKey")).toBe(false);
    for (const value of Object.values(ledger)) {
      if (value instanceof Map || value instanceof Set) {
        expect.soft(value.size).toBeLessThanOrEqual(50);
      } else if (Array.isArray(value)) {
        expect.soft(value).toHaveLength(50);
      }
    }

    const decodedSamples: RelicInkSample[] = [];
    for (const value of Object.values(ledger)) {
      if (!(value instanceof Map)) continue;
      for (const stored of value.values()) {
        if (
          typeof stored === "object"
          && stored !== null
          && "alpha" in stored
          && stored.alpha instanceof Uint8Array
        ) decodedSamples.push(stored as RelicInkSample);
      }
    }
    expect.soft(decodedSamples).toHaveLength(50);
    expect.soft(new Set(decodedSamples.map((sample) => sample.offeringId)).size).toBe(50);
  });

  it("caps an undrained animate backlog and exposes one refill slot after completion", () => {
    const makeRelic = (sequence: number): AccretedRelic => ({
      id: `backlog-relic-${sequence}`,
      offering_id: `backlog-offering-${sequence}`,
      wallet: null,
      summary: `backlog memory ${sequence}`,
      rite_id: null,
      kept_at: sequence,
      genesis: 0,
      accreted_at: 40_000 + sequence,
    });
    const makeInk = (relic: AccretedRelic): RelicInkSample => ({
      offeringId: relic.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill(90),
    });

    const baselinePage = Array.from({ length: 50 }, (_, index) => makeRelic(50 - index));
    let ledger = createRelicAccretionLedger();
    const baseline = planRelicRefresh(ledger, baselinePage, 1, true);
    ledger = baseline.ledger;
    for (const request of baseline.requests) {
      ledger = settleRelicSample(ledger, request, makeInk(request.relic), 1).ledger;
    }

    const secondPage = Array.from({ length: 50 }, (_, index) => makeRelic(150 - index));
    const second = planRelicRefresh(ledger, secondPage, 2, false);
    ledger = second.ledger;
    expect(second.requests).toHaveLength(RELIC_SAMPLE_CONCURRENCY);
    const commands: Extract<BodyCommand, { kind: "accrete" }>[] = [];
    for (const request of second.requests) {
      const settled = settleRelicSample(ledger, request, makeInk(request.relic), 2);
      ledger = settled.ledger;
      expect(settled.command).not.toBeNull();
      if (settled.command !== null) commands.push(settled.command);
    }

    const thirdPage = Array.from({ length: 50 }, (_, index) => makeRelic(250 - index));
    const blocked = planRelicRefresh(ledger, thirdPage, 3, false);
    ledger = blocked.ledger;
    expect(blocked.requests).toEqual([]);
    expect(ledger.queued.size).toBe(RELIC_SAMPLE_CONCURRENCY);
    expect(ledger.samplesByKey.size).toBeLessThanOrEqual(
      RELIC_MEMORY_LIMIT + RELIC_SAMPLE_CONCURRENCY,
    );
    for (const value of Object.values(ledger)) {
      if (value instanceof Map || value instanceof Set) {
        expect(value.size).toBeLessThanOrEqual(
          RELIC_MEMORY_LIMIT * 2 + RELIC_SAMPLE_CONCURRENCY,
        );
      }
    }

    ledger = activateRelicCommand(ledger, commands[0]);
    ledger = completeRelicCommand(ledger, commands[0]);
    const refill = planRelicRefresh(ledger, thirdPage, 4, false);
    expect(refill.requests).toHaveLength(1);
  });

  it("keeps fifty committed traces unchanged until a replacement sample completes", () => {
    const makeRelic = (sequence: number): AccretedRelic => ({
      id: `atomic-relic-${sequence}`,
      offering_id: `atomic-offering-${sequence}`,
      wallet: null,
      summary: `atomic memory ${sequence}`,
      rite_id: null,
      kept_at: sequence,
      genesis: 0,
      accreted_at: 20_000 + sequence,
    });
    const makeInk = (relic: AccretedRelic): RelicInkSample => ({
      offeringId: relic.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill((relic.kept_at % 180) + 20),
    });

    const baselinePage = Array.from({ length: 50 }, (_, index) => makeRelic(50 - index));
    let ledger = createRelicAccretionLedger();
    const baseline = planRelicRefresh(ledger, baselinePage, 1, true);
    ledger = baseline.ledger;
    for (const request of baseline.requests) {
      ledger = settleRelicSample(ledger, request, makeInk(request.relic), 1).ledger;
    }
    const priorMemory = relicMemoryFromLedger(ledger);
    const priorMask = foldRelicSamples(priorMemory);
    expect(priorMemory).toHaveLength(50);

    const newest = makeRelic(51);
    const nextPage = [newest, ...baselinePage.slice(0, 49)];
    const first = planRelicRefresh(ledger, nextPage, 2, false);
    ledger = first.ledger;
    expect(first.requests).toHaveLength(1);
    expect.soft(relicMemoryFromLedger(ledger)).toEqual(priorMemory);
    expect.soft(foldRelicSamples(relicMemoryFromLedger(ledger))).toEqual(priorMask);

    const failed = settleRelicSample(ledger, first.requests[0], null, 2);
    ledger = failed.ledger;
    expect(ledger.inFlight.size).toBe(0);
    expect.soft(relicMemoryFromLedger(ledger)).toEqual(priorMemory);
    expect.soft(foldRelicSamples(relicMemoryFromLedger(ledger))).toEqual(priorMask);

    const retry = planRelicRefresh(ledger, nextPage, 3, false);
    ledger = retry.ledger;
    expect(retry.requests).toHaveLength(1);
    const newestInk = makeInk(newest);
    const succeeded = settleRelicSample(ledger, retry.requests[0], newestInk, 3);
    ledger = succeeded.ledger;
    expect(succeeded.command).not.toBeNull();
    expect.soft(relicMemoryFromLedger(ledger)).toEqual(priorMemory);
    if (succeeded.command === null) throw new Error("expected replacement accretion command");

    ledger = activateRelicCommand(ledger, succeeded.command);
    expect.soft(relicMemoryFromLedger(ledger)).toEqual(priorMemory);
    ledger = completeRelicCommand(ledger, succeeded.command);

    const expectedMemory = [newestInk, ...priorMemory.slice(0, 49)];
    expect(relicMemoryFromLedger(ledger)).toEqual(expectedMemory);
    expect(foldRelicSamples(relicMemoryFromLedger(ledger))).toEqual(foldRelicSamples(expectedMemory));
    expect(relicMemoryFromLedger(ledger)).not.toContain(priorMemory[49]);
  });

  it("replaces an older timestamp for the same offering without consuming two memory slots", () => {
    const makeRelic = (sequence: number): AccretedRelic => ({
      id: `timestamp-relic-${sequence}`,
      offering_id: `timestamp-offering-${sequence}`,
      wallet: null,
      summary: `timestamp memory ${sequence}`,
      rite_id: null,
      kept_at: 1_000 - sequence,
      genesis: 0,
      accreted_at: 30_000 + sequence,
    });
    const makeInk = (relic: AccretedRelic): RelicInkSample => ({
      offeringId: relic.offering_id,
      size: 64,
      alpha: new Uint8Array(64 * 64).fill(40 + (relic.kept_at % 100)),
    });

    const baselinePage = Array.from({ length: 50 }, (_, index) => makeRelic(index));
    let ledger = createRelicAccretionLedger();
    const baseline = planRelicRefresh(ledger, baselinePage, 1, true);
    ledger = baseline.ledger;
    for (const request of baseline.requests) {
      ledger = settleRelicSample(ledger, request, makeInk(request.relic), 1).ledger;
    }

    const older = baselinePage[0];
    const newer = {
      ...older,
      id: "timestamp-relic-newer",
      accreted_at: older.accreted_at + 100,
    } satisfies AccretedRelic;
    const pending = makeRelic(99);
    const nextPage = [newer, ...baselinePage.slice(1, 49), pending];
    const planned = planRelicRefresh(ledger, nextPage, 2, false);
    ledger = planned.ledger;
    expect(planned.requests).toHaveLength(2);
    const newerRequest = planned.requests.find((request) => request.relic.id === newer.id);
    const pendingRequest = planned.requests.find((request) => request.relic.id === pending.id);
    expect(newerRequest).toBeDefined();
    expect(pendingRequest).toBeDefined();
    if (newerRequest === undefined || pendingRequest === undefined) {
      throw new Error("expected both timestamp replacement requests");
    }

    ledger = settleRelicSample(ledger, pendingRequest, null, 2).ledger;
    const settled = settleRelicSample(ledger, newerRequest, makeInk(newer), 2);
    ledger = settled.ledger;
    expect(settled.command).not.toBeNull();
    if (settled.command === null) throw new Error("expected newer timestamp command");
    ledger = activateRelicCommand(ledger, settled.command);
    ledger = completeRelicCommand(ledger, settled.command);

    const memory = relicMemoryFromLedger(ledger);
    expect(memory).toHaveLength(50);
    expect(new Set(memory.map((sample) => sample.offeringId)).size).toBe(50);
    expect(ledger.selectedKeys).toContain(relicAccretionKey(newer));
    expect(ledger.selectedKeys).not.toContain(relicAccretionKey(older));
    expect(ledger.samplesByKey.has(relicAccretionKey(older))).toBe(false);
  });

  it("creates a complete source reset and advances every generation", () => {
    const reset = createTempleSourceReset({ state: 4, codex: 7, relic: 11 });
    expect(reset.generations).toEqual({ state: 5, codex: 8, relic: 12 });
    expect(reset.state).toBeNull();
    expect(reset.vitalsFreshness).toEqual({ feed: { kind: "unknown" }, consecutiveFailures: 0 });
    expect(reset.codex).toEqual([]);
    expect(reset.relics).toEqual([]);
    expect(reset.relicMemory).toEqual([]);
    expect(reset.activeCommand).toBeNull();
    expect(reset.replayWitness).toBeNull();
    expect(reset.riteActive).toBe(false);
    expect(reset.codexBaseline).toBe(false);
    expect(reset.relicBaseline).toBe(false);
    expect(reset.seenCodexIds.size).toBe(0);
    expect(reset.relicAccretion.inFlight.size).toBe(0);
    expect(reset.relicAccretion.queued.size).toBe(0);
    expect(reset.relicAccretion.active.size).toBe(0);
    expect(reset.relicAccretion.incorporated.size).toBe(0);
    expect(reset.queue).toEqual([]);
    expect(reset.locks).toEqual({ arrival: true, threshold: false, activeKind: null });
    expect(reset.dreamRelicBarrier).toBe(false);
  });

  it("carries a complete DREAM cue shape for replay and convergence", () => {
    const cue: DreamCue = {
      id: "dream",
      riteDate: "2030-01-01",
      narrative: "the record converges",
      createdAt: 100,
      source: "replay",
    };
    expect(cue.source).toBe("replay");
  });
});
