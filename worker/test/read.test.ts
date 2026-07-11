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

type CodexPage = { entries: Array<{ id: string; text: string; created_at: number }>; next: string | null };

describe("read api", () => {
  it("pages the codex newest first", async () => {
    const res = await SELF.fetch("http://x/api/codex");
    const { entries } = await res.json<CodexPage>();
    expect(entries[0].text).toBe("line 2");
  });

  it("crosses created_at ties at the page boundary without skips or dups", async () => {
    // 55 rows; DESC ranks 48-52 share created_at so the 50-row page boundary
    // falls inside the tie group. Ranks 1-47 -> 2999..2953, 48-52 -> 2950, 53-55 -> 2949..2947.
    const inserted: string[] = [];
    for (let rank = 1; rank <= 55; rank++) {
      const created_at = rank <= 47 ? 3000 - rank : rank <= 52 ? 2950 : 3002 - rank;
      const id = ulid();
      inserted.push(id);
      await addTranscript(env.DB, { id, organ: "PRIEST", register: "system",
        text: `tie ${rank}`, offering_id: null, rite_id: null, created_at });
    }

    const p1 = await (await SELF.fetch("http://x/api/codex")).json<CodexPage>();
    expect(p1.entries.length).toBe(50);
    expect(p1.next).toMatch(/^\d+:[0-9A-HJKMNP-TV-Z]{26}$/);

    const p2 = await (await SELF.fetch(`http://x/api/codex?cursor=${p1.next}`)).json<CodexPage>();
    expect(p2.next).toBeNull();

    const all = [...p1.entries, ...p2.entries];
    const ids = all.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no dups across pages
    for (const id of inserted) expect(ids).toContain(id); // no skips: all 55 present
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      expect(
        a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id)
      ).toBe(true); // strict (created_at DESC, id DESC)
    }
  });

  it("rejects a malformed cursor", async () => {
    const res = await SELF.fetch("http://x/api/codex?cursor=abc");
    expect(res.status).toBe(400);
  });

  it("reports dormant state", async () => {
    const res = await SELF.fetch("http://x/api/state");
    const s = await res.json<{ phase: string; asleep: boolean }>();
    expect(s.phase).toBe("dormant");
    expect(s.asleep).toBe(false);
  });
});
