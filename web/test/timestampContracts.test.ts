import { describe, expect, it } from "vitest";
import { resolveDreamArchiveRite } from "../src/canon/dreamsClient";
import {
  isRelicEntry,
  isTempleState,
  isTranscriptEntry,
  type DreamArchiveEntry,
  type DreamView,
  type RelicEntry,
  type TempleState,
  type TranscriptEntry,
} from "../src/state/types";

const MAX_DATE_TIMESTAMP = 8.64e15;
const validTimestamp = Date.UTC(2030, 0, 2, 3, 4, 5);

const templeState: TempleState = {
  phase: "live",
  asleep: false,
  degraded: false,
  countdown_to: validTimestamp,
  communicants_today: 1,
  spend_state: "ok",
  mint: null,
  vitals: { state: "calm", buys: 1, sells: 0, holders: 1 },
  rite: { date: "2030-01-02", phase: "sermon" },
  dream: {
    narrative: "One bounded hour remembered the body.",
    video_key: null,
    wakers: [],
    created_at: validTimestamp,
  },
};

const transcript: TranscriptEntry = {
  id: "01JH0000000000000000000000",
  organ: "DREAM",
  register: "verse",
  text: templeState.dream?.narrative ?? "",
  offering_id: null,
  rite_id: "2030-01-02",
  created_at: validTimestamp,
};

const relic: RelicEntry = {
  id: "01JH0000000000000000000001",
  offering_id: "01JH0000000000000000000002",
  wallet: null,
  summary: "A bounded relic.",
  rite_id: "2030-01-02",
  kept_at: validTimestamp,
  genesis: 0,
  accreted_at: validTimestamp,
};

function archiveEntry(createdAt: number): DreamArchiveEntry {
  return {
    id: "01JH0000000000000000000003",
    rite_date: "2030-01-02",
    narrative: "One bounded hour remembered the body.",
    video_key: null,
    wakers: [],
    status: "complete",
    created_at: createdAt,
  };
}

describe("bounded public timestamps", () => {
  it.each([-1, MAX_DATE_TIMESTAMP + 1])(
    "rejects %s across state, transcript, and relic read contracts",
    (invalidTimestamp) => {
      expect(isTempleState({ ...templeState, countdown_to: invalidTimestamp })).toBe(false);
      expect(isTempleState({
        ...templeState,
        dream: { ...templeState.dream!, created_at: invalidTimestamp },
      })).toBe(false);
      expect(isTranscriptEntry({ ...transcript, created_at: invalidTimestamp })).toBe(false);
      expect(isRelicEntry({ ...relic, kept_at: invalidTimestamp })).toBe(false);
      expect(isRelicEntry({ ...relic, accreted_at: invalidTimestamp })).toBe(false);
    },
  );

  it.each([-1, MAX_DATE_TIMESTAMP + 1])(
    "rejects %s in a Dream archive page before resolving current rite identity",
    async (invalidTimestamp) => {
      const dream: DreamView = {
        narrative: "One bounded hour remembered the body.",
        video_key: null,
        wakers: [],
        created_at: invalidTimestamp,
      };
      await expect(resolveDreamArchiveRite(dream, Promise.resolve({
        entries: [archiveEntry(invalidTimestamp)],
        next: null,
      }))).resolves.toEqual({ status: "unavailable" });
    },
  );
});
