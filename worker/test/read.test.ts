import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { addTranscript } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(async () => {
  await applyMigrations(env.DB);
  for (let i = 0; i < 3; i++) {
    await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
      text: `line ${i}`, offering_id: null, rite_id: null, created_at: 1000 + i });
  }
});

describe("read api", () => {
  it("pages the codex newest first", async () => {
    const res = await SELF.fetch("http://x/api/codex");
    const { entries } = await res.json<{ entries: Array<{ text: string }> }>();
    expect(entries[0].text).toBe("line 2");
  });

  it("reports dormant state", async () => {
    const res = await SELF.fetch("http://x/api/state");
    const s = await res.json<{ phase: string; asleep: boolean }>();
    expect(s.phase).toBe("dormant");
    expect(s.asleep).toBe(false);
  });
});
