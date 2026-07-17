import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { addTranscript, insertOffering, insertRelic } from "../src/db";
import { applyMigrations } from "./helpers";
import migration17 from "../migrations/0017_first_congregation.sql?raw";

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

describe("tallies api — First Congregation (G9)", () => {
  it("names a wallet from its permanent first-ever rank, never from today's count order", async () => {
    // W3 is the LAST wallet to ever appear (highest first_seen) but offers the MOST today, so a
    // daily count-DESC list would rank it first -- exactly the bug the 0017 backfill closes. Its
    // real historical rank (#3) must win over its position in today's tally regardless.
    const wallets = [
      { address: "w1-first-ever", first_seen: 100 },
      { address: "w2-second-ever", first_seen: 200 },
      { address: "w3-last-ever", first_seen: 300 },
    ];
    for (const w of wallets) {
      await env.DB.prepare(`INSERT INTO wallets (address, first_seen, offering_count) VALUES (?1, ?2, 1)`)
        .bind(w.address, w.first_seen).run();
    }
    // Re-run just the 0017 backfill now that these wallets exist (the full applyMigrations chain
    // already ran once in this file's beforeAll, before any wallets existed to name).
    for (const stmt of migration17.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
      await env.DB.exec(stmt.replace(/\s+/g, " ").trim());
    }

    const date = "2026-08-01";
    const dayStart = Date.parse(date + "T00:00:00.000Z");
    const counts = { "w1-first-ever": 1, "w2-second-ever": 2, "w3-last-ever": 3 };
    for (const [wallet, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const id = ulid();
        await insertOffering(env.DB, { id, wallet, sig: null, image_key: `offerings/${id}`, sha256: id,
          status: "perceived", attempts: 0, created_at: dayStart + i, perceived_at: dayStart + i });
        // insertOffering's INSERT deliberately omits perceived_at (it starts NULL on the real path,
        // set later by publishPerception); set it directly here since getTallies requires it non-null.
        await env.DB.prepare(`UPDATE offerings SET perceived_at = ?2 WHERE id = ?1`).bind(id, dayStart + i).run();
      }
    }

    const res = await SELF.fetch(`http://x/api/tallies?date=${date}`);
    const { tallies } = await res.json<{ tallies: Array<{ wallet: string; count: number; name: string | null }> }>();
    const byWallet = Object.fromEntries(tallies.map(t => [t.wallet, t]));
    expect(byWallet["w1-first-ever"].name).toBe("First Congregation #1");
    expect(byWallet["w2-second-ever"].name).toBe("First Congregation #2");
    expect(byWallet["w3-last-ever"].name).toBe("First Congregation #3");
    // Today's count order (DESC) puts w3 first -- confirming the name above is NOT that daily index.
    expect(tallies[0].wallet).toBe("w3-last-ever");
  });
});

describe("first light api", () => {
  it("reports not-yet-enacted with no genesis relic", async () => {
    const res = await SELF.fetch("http://x/api/first-light");
    expect(await res.json()).toEqual({ enacted: false, relic: null, dream: null });
  });

  it("reports the genesis relic and the earliest dream once First Light happens", async () => {
    await insertOffering(env.DB, { id: "fl-off", wallet: "fl-wallet", sig: null, image_key: "offerings/fl-off",
      sha256: "fl-off", status: "kept", attempts: 0, created_at: 100, perceived_at: 100 });
    await insertRelic(env.DB, { id: "fl-relic", offering_id: "fl-off", wallet: "fl-wallet",
      summary: "a founding mark", rite_id: "2026-07-17", kept_at: 200, genesis: 1, accreted_at: 300 });
    // A later, non-genesis dream inserted first in created_at order to prove genesis picks the
    // EARLIEST dream ever, not merely "a" dream or the most recently inserted row.
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, status, created_at)
       VALUES ('later-dream', '2026-07-18', 'a later dream', 'p', 'composed', 500)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, status, created_at)
       VALUES ('genesis-dream', '2026-07-17', 'the first dream', 'p', 'composed', 400)`
    ).run();

    const res = await SELF.fetch("http://x/api/first-light");
    const body = await res.json<{ enacted: boolean; relic: { summary: string; accreted_at: number | null } | null;
      dream: { rite_date: string; narrative: string } | null }>();
    expect(body.enacted).toBe(true);
    expect(body.relic?.summary).toBe("a founding mark");
    expect(body.relic?.accreted_at).toBe(300);
    expect(body.dream?.rite_date).toBe("2026-07-17");
    expect(body.dream?.narrative).toBe("the first dream");
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
