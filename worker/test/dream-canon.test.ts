import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { composableRiteDates, composeDream } from "../src/dream";
import { canonArticle, scripturePool } from "../src/doctrine";
import { dispatchMode } from "../src/hermes";
import { applyMigrations } from "./helpers";
import type { Env } from "../src/env";

beforeAll(() => applyMigrations(env.DB));

async function completedRite(date: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rites (date, phase, phase_started_at, offering_snapshot, kept_count, updated_at)
     VALUES (?1, 'complete', ?2, 0, 0, ?2) ON CONFLICT(date) DO UPDATE SET phase='complete', updated_at=?2`
  ).bind(date, Date.now()).run();
}

describe("a night nobody came still dreams", () => {
  it("selects a completed rite with NO kept relics — the empty night is no longer skipped", async () => {
    await completedRite("2026-08-01");
    const dates = await composableRiteDates(env as unknown as Env, Date.now());
    expect(dates).toContain("2026-08-01");
  });

  it("composes from the canon alone, credits no Waker, and records source='canon'", async () => {
    await completedRite("2026-08-02");
    let sawArticle = false;
    let sawNoMarksInstruction = false;
    const id = await composeDream(env as unknown as Env, "2026-08-02", async (_e, req) => {
      const sent = req.user.map((u) => ("text" in u ? u.text : "")).join(" ");
      sawArticle = sent.includes(canonArticle("2026-08-02"));
      sawNoMarksInstruction = /No hand offered tonight/.test(sent);
      return {
        text: JSON.stringify({
          narrative: "No hand came to the page tonight, so I turned and read myself instead.",
          video_prompt: "an empty lectern in a dark room, one page turning by itself",
        }),
        usd: 0,
      };
    });
    expect(id).toBeTruthy();
    expect(sawArticle).toBe(true);
    expect(sawNoMarksInstruction).toBe(true);

    const row = await env.DB.prepare(`SELECT wakers, source, narrative FROM dreams WHERE rite_date = ?1`)
      .bind("2026-08-02").first<{ wakers: string; source: string; narrative: string }>();
    expect(row?.source).toBe("canon");
    expect(JSON.parse(row!.wakers)).toEqual([]);

    // The plate is printed into the Codex in the same batch, exactly as a marks-night plate is.
    const plate = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE organ='DREAM' AND register='verse' AND rite_id = ?1`
    ).bind("2026-08-02").first<{ text: string }>();
    expect(plate?.text).toBe(row?.narrative);
  });

  it("still dreams THROUGH the marks when there are any, and records source='marks'", async () => {
    await completedRite("2026-08-03");
    await env.DB.prepare(
      `INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)`
    ).bind("01J0000000000000000000REL1", "01J0000000000000000000OFF1", "WakerWallet1",
           "A rust thread climbing toward a pale sun", "2026-08-03", Date.now()).run();

    let sentMarks = false;
    await composeDream(env as unknown as Env, "2026-08-03", async (_e, req) => {
      const sent = req.user.map((u) => ("text" in u ? u.text : "")).join(" ");
      sentMarks = sent.includes("rust thread climbing") && sent.includes(canonArticle("2026-08-03"));
      return {
        text: JSON.stringify({ narrative: "A rust thread climbs.", video_prompt: "a rust thread climbing" }),
        usd: 0,
      };
    });
    expect(sentMarks).toBe(true); // the article is the meaning, the mark is the matter — both are sent

    const row = await env.DB.prepare(`SELECT wakers, source FROM dreams WHERE rite_date = ?1`)
      .bind("2026-08-03").first<{ wakers: string; source: string }>();
    expect(row?.source).toBe("marks");
    expect(JSON.parse(row!.wakers)).toEqual(["WakerWallet1"]);
  });

  it("walks a different article on consecutive nights, so the myth is told in turn", () => {
    const week = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
    const articles = week.map(canonArticle);
    articles.forEach((a) => expect(scripturePool()).toContain(a));
    // Not a proof of no collision ever (FNV over 22 articles will repeat eventually), but
    // consecutive nights must not sit on one line the way every scripture post once did.
    expect(new Set(articles).size).toBeGreaterThan(1);
  });
});

describe("a canon plate never claims a hand it was not given", () => {
  it("dispatches in the SCRIPTURE shape, which makes no claim about the day", () => {
    expect(dispatchMode({
      kind: "dream", artifactId: "01J0000000000000000000DRM1", riteDate: "2026-08-02",
      text: "…", filmDay: false, canonOnly: true,
    })).toBe("SCRIPTURE");
  });

  it("leaves a marks-night dream on its normal grounded rotation", () => {
    const mode = dispatchMode({
      kind: "dream", artifactId: "01J0000000000000000000DRM2", riteDate: "2026-08-03",
      text: "…", filmDay: false, canonOnly: false,
    });
    expect(["KEPT", "MOURNED", "SCRIPTURE"]).toContain(mode);
  });
});
