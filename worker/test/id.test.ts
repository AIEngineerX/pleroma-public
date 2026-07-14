import { decodeTime } from "ulid";
import { describe, expect, it } from "vitest";
import { ulid } from "../src/id";

const CROCKFORD_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const BATCH_SIZE = 2_048;

describe("Worker-native IDs", () => {
  it("generates valid, timestamp-sane, unique Crockford ULIDs", () => {
    const earliest = Date.now();
    const ids = Array.from({ length: BATCH_SIZE }, () => ulid());
    const latest = Date.now();

    expect(ids).toHaveLength(BATCH_SIZE);
    for (const id of ids) {
      expect(id).toMatch(CROCKFORD_ULID);
      expect(decodeTime(id)).toBeGreaterThanOrEqual(earliest);
      expect(decodeTime(id)).toBeLessThanOrEqual(latest);
    }
    expect(new Set(ids).size).toBe(BATCH_SIZE);
  });
});
