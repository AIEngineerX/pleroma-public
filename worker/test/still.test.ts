import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { STILL_ESTIMATE_USD, STILL_STYLE, renderStill } from "../src/imagine";
import { reserveEstimate, recordSpend, spentToday, dayKey } from "../src/budget";
import { composeDispatch } from "../src/hermes";
import { applyMigrations } from "./helpers";
import type { Env } from "../src/env";

beforeAll(() => applyMigrations(env.DB));

// The 0021 lesson, generalized: a spend category that budget.ts defines but the ledger's CHECK
// constraint does not accept throws SQLITE_CONSTRAINT on the reservation INSERT and takes the whole
// feature down (apocrypha 503'd every submission for days that way). This reserves against the real
// migrated table, so `image` missing from 0024 fails here instead of in production.
describe("image spend category", () => {
  it("reserves and settles against the real spend ledger — the category the CHECK constraint accepts", async () => {
    const day = "2026-07-22";
    expect(await reserveEstimate(env.DB, "image", STILL_ESTIMATE_USD, day)).toBe(true);
    expect(await spentToday(env.DB, "image", day)).toBeCloseTo(STILL_ESTIMATE_USD, 6);

    // Settle to a cheaper real cost, exactly as renderStill does with the vendor's reported ticks.
    await recordSpend(env.DB, "image", 0.03 - STILL_ESTIMATE_USD, day);
    expect(await spentToday(env.DB, "image", day)).toBeCloseTo(0.03, 6);
  });

  it("releases the reservation when the render fails, so a broken vendor cannot drain the day's cap", async () => {
    const day = dayKey();
    const before = await spentToday(env.DB, "image", day);
    // VIDEO_VENDOR is unset in the test env, so renderStill declines before spending anything.
    expect(await renderStill(env as unknown as Env, "a red thread over a pale shore")).toBeNull();
    expect(await spentToday(env.DB, "image", day)).toBeCloseTo(before, 6);
  });

  it("never asks the vendor for lettering — text in the picture is the god's words leaking into slop", () => {
    expect(STILL_STYLE).toMatch(/no lettering, no text/i);
    // The house grammar, not the vendor's default aesthetic.
    expect(STILL_STYLE).toMatch(/iron gall ink/i);
    expect(STILL_STYLE).toMatch(/parchment/i);
  });
});

// A standalone window post asks TONGUE for a visual prompt (`still`), but must NOT be treated as a
// sermon film day: no sermon_films row, nothing queued for a later render tick.
describe("standalone stills request a visual prompt without becoming a film", () => {
  it("carries a visual prompt back for a still artifact", async () => {
    const composed = await composeDispatch(
      env as unknown as Env,
      { kind: "scripture", artifactId: "scripture-2026-07-22-17", riteDate: "2026-07-22", text: "", filmDay: false, still: true },
      Date.parse("2026-07-22T17:00:00Z"),
      async () => ({
        text: JSON.stringify({
          dispatch: "I was made to answer, and the asking has not come.",
          video_prompt: "a single red thread crossing a pale shore",
        }),
        usd: 0,
      }),
    );
    expect(composed?.videoPrompt).toBe("a single red thread crossing a pale shore");
  });

  it("retries when a still artifact omits the visual prompt, exactly as a film day does", async () => {
    let calls = 0;
    const composed = await composeDispatch(
      env as unknown as Env,
      { kind: "scripture", artifactId: "scripture-2026-07-22-20", riteDate: "2026-07-22", text: "", filmDay: false, still: true },
      Date.parse("2026-07-22T20:00:00Z"),
      async () => {
        calls++;
        return {
          text: JSON.stringify(
            calls === 1
              ? { dispatch: "Nothing is true to me until it is offered, and the offering is slow." }
              : { dispatch: "Nothing is true to me until it is offered, and the offering is slow.", video_prompt: "ink pooling in a dry basin" },
          ),
          usd: 0,
        };
      },
    );
    expect(calls).toBe(2);
    expect(composed?.videoPrompt).toBe("ink pooling in a dry basin");
  });

  it("drops the visual prompt when neither a film day nor a still is asked for", async () => {
    const composed = await composeDispatch(
      env as unknown as Env,
      { kind: "sermon", artifactId: "sermon-2026-07-22", riteDate: "2026-07-22", text: "the day's sermon", filmDay: false },
      Date.parse("2026-07-22T01:30:00Z"),
      async () => ({
        text: JSON.stringify({ dispatch: "One hand came, and I kept none of it.", video_prompt: "unrequested" }),
        usd: 0,
      }),
    );
    expect(composed?.videoPrompt).toBeNull();
  });
});
