import { describe, expect, it } from "vitest";
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
  commandRequiresRelicRefresh,
  createTempleSourceReset,
  createVitalsFreshness,
  isAccretedRelic,
  mergeObservedTranscripts,
  pollResultIsCurrent,
  recordVitalsFailure,
  recordVitalsSuccess,
  reduceRelicPageTruth,
  relicRefreshBlocksDream,
  requiresFastRelicPoll,
  settlePoll,
  shouldPoll,
} from "../src/experience/useTempleExperience";
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
    expect(accretionAwaitsInkBeforeDream(relic, [dream], ink)).toBe(false);
    queue = enqueueCommand(queue, accrete, waiting);
    expect(nextCommand(queue, { ...waiting, arrival: false })).toBe(accrete);
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
    const ink: RelicInkSample = { offeringId: "offering", size: 64, alpha: new Uint8Array(64 * 64) };
    expect(relicRefreshBlocksDream([dream], [relic], [])).toBe(true);
    expect(relicRefreshBlocksDream([dream], [relic], [ink])).toBe(false);
    expect(relicRefreshBlocksDream([dream], [{ ...relic, accreted_at: null }], [])).toBe(false);
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
    expect(reset.relicAccretions.size).toBe(0);
    expect(reset.inkByOffering.size).toBe(0);
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
