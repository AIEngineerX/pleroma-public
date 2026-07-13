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

describe("dream archive api", () => {
  it("lists dreams newest-first with parsed wakers + video_key, and 400s a bad cursor", async () => {
    const mk = (date: string, created_at: number, videoKey: string | null, wakers: string[]) =>
      env.DB.prepare(
        `INSERT INTO dreams (id, rite_date, narrative, video_prompt, video_key, wakers, status, created_at)
         VALUES (?1, ?2, ?3, 'p', ?4, ?5, ?6, ?7)`
      ).bind(ulid(), date, `dream ${date}`, videoKey, JSON.stringify(wakers), videoKey ? "rendered" : "composed", created_at).run();
    await mk("2026-09-01", 5001, null, []);
    await mk("2026-09-02", 5002, "dream/01JZDVKA000000000000000000.mp4", ["wA", "wB"]);
    await mk("2026-09-03", 5003, null, ["wC"]);

    const { entries } = await (await SELF.fetch("http://x/api/dreams"))
      .json<{ entries: Array<{ rite_date: string; video_key: string | null; wakers: string[] }> }>();
    expect(entries[0].rite_date).toBe("2026-09-03");     // newest first
    expect(Array.isArray(entries[0].wakers)).toBe(true); // wakers JSON parsed to a real array
    const rendered = entries.find(e => e.rite_date === "2026-09-02");
    expect(rendered?.video_key).toBe("dream/01JZDVKA000000000000000000.mp4");
    expect(rendered?.wakers).toEqual(["wA", "wB"]);

    expect((await SELF.fetch("http://x/api/dreams?cursor=nope")).status).toBe(400);
  });
});
