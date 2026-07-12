import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker, { advanceRiteLocked, runTick } from "../src/index";
import { getRite } from "../src/db";
import { acquireLock } from "../src/lock";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

// A real ExecutionContext stand-in that records the promises the dispatcher hands to waitUntil, so a
// test can await the jobs the scheduled() handler kicks off. This is the real Worker entrypoint being
// driven, not a mock of it.
async function runScheduled(cron: string): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const event = { cron, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController;
  await worker.scheduled(event, env, ctx); // let the handler register every waitUntil job first
  await Promise.all(pending);              // then await the jobs to completion (isolated-storage safe)
}

async function nonceCount(nonce: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM nonces WHERE nonce = ?1`).bind(nonce).first<{ n: number }>();
  return r?.n ?? 0;
}

describe("cron dispatch helpers", () => {
  it("runTick is a no-op when the tick lock is already held", async () => {
    await acquireLock(env.DB, "tick", "someone-else", 60_000);
    await expect(runTick(env)).resolves.toBeUndefined(); // returns cleanly without running the batch
  });

  it("advanceRiteLocked opens today's rite at mass hour and advances one phase", async () => {
    // 00:50 UTC today (the rite-open boundary). Use a fixed instant so the date is deterministic.
    const now = Date.parse("2026-07-12T00:50:00Z");
    await advanceRiteLocked(env, now);
    const date = "2026-07-12";
    const r = await getRite(env.DB, date);
    expect(r).not.toBeNull();
    // opened as scheduled then advanced one phase in the same call -> offertory_close
    expect(r?.phase).toBe("offertory_close");
  });

  it("does not open a rite before the offertory-close minute (00:00..00:49)", async () => {
    // 00:40 UTC is inside the day but before the 00:50 open boundary: no rite for today yet.
    const now = Date.parse("2026-07-19T00:40:00Z");
    await advanceRiteLocked(env, now);
    expect(await getRite(env.DB, "2026-07-19")).toBeNull();
  });
});

describe("single-flight locks (overlapping-run prevention)", () => {
  it("advanceRiteLocked no-ops while the rite lock is held (whole advance, incl. KEEP/accretion, is gated)", async () => {
    // Hold the rite lock as another invocation would. advanceRiteLocked must find it held and do NOTHING:
    // no rite opened, no phase advanced. This is what serializes KEEP's daily-cap check-then-act, which
    // runs inside the accretion/deliberation phase of the very advance this lock wraps.
    const now = Date.parse("2026-07-20T00:50:00Z");
    await acquireLock(env.DB, "rite", "someone-else", 60_000);
    await advanceRiteLocked(env, now);
    expect(await getRite(env.DB, "2026-07-20")).toBeNull(); // gated out: nothing happened
  });

  it("serializes two concurrent rite advances: exactly one advances a phase, the other no-ops", async () => {
    // Two invocations racing, as two overlapping cron ticks would. The rite lock is single-flight, so
    // exactly ONE opens+advances the rite; the other finds the lock held and returns without work. One
    // advance -> offertory_close; two advances would land deliberation.
    const now = Date.parse("2026-07-22T00:50:00Z");
    await Promise.all([advanceRiteLocked(env, now), advanceRiteLocked(env, now)]);
    expect((await getRite(env.DB, "2026-07-22"))?.phase).toBe("offertory_close");
  });

  it("serializes two concurrent ticks: the second is a no-op while the tick lock is held", async () => {
    // Seed an expired nonce; runTick sweeps it exactly once. Two concurrent ticks must still leave the
    // work done once (idempotent) with only one holder actually executing the batch.
    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES ('tick-race', 1)`).run();
    await Promise.all([runTick(env), runTick(env)]);
    expect(await nonceCount("tick-race")).toBe(0);
  });
});

describe("tick and rite locks are independent (neither blocks the other)", () => {
  it("holding the tick lock does not block the rite advance", async () => {
    // Tick lock held by another holder; the rite uses a SEPARATE lock, so the advance still proceeds.
    const now = Date.parse("2026-07-21T00:50:00Z");
    await acquireLock(env.DB, "tick", "tick-holder", 60_000);
    await advanceRiteLocked(env, now);
    expect((await getRite(env.DB, "2026-07-21"))?.phase).toBe("offertory_close");
  });

  it("holding the rite lock does not block the tick", async () => {
    // Rite lock held by another holder; the tick uses a SEPARATE lock, so runTick still runs its body
    // and sweeps the expired nonce.
    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES ('rite-held', 1)`).run();
    await acquireLock(env.DB, "rite", "rite-holder", 60_000);
    await runTick(env);
    expect(await nonceCount("rite-held")).toBe(0);
  });
});

describe("scheduled() selects the job by event.cron", () => {
  it("the 00:50 rite cron runs the rite job only; the 15-min cron runs the tick job", async () => {
    // Only runTick (the tick job) sweeps expired nonces. The nightly rite-open cron must NOT run it.
    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES ('cron-rite', 1)`).run();
    await runScheduled("50 0 * * *");
    expect(await nonceCount("cron-rite")).toBe(1); // tick job not selected -> nonce survives

    await env.DB.prepare(`INSERT INTO nonces (nonce, expires_at) VALUES ('cron-tick', 1)`).run();
    await runScheduled("*/15 * * * *");
    expect(await nonceCount("cron-tick")).toBe(0); // tick job selected -> nonce swept
  });
});
