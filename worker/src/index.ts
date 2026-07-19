import { ulid } from "./id";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { issueNonce, sweepNonces } from "./nonce";
import { handleOffering } from "./offerings";
import { acquireLock, releaseLock } from "./lock";
import { runEyeBatch, sweepQuarantine } from "./eye";
import { RITE_LEASE_MS, RITE_WORK_BUDGET_MS } from "./leases";
import { openRite, nonTerminalRites } from "./db";
import { advanceRite } from "./rite";
import { getCodex, getDreams, getFirstLight, getRelics, getState, getTallies } from "./read";
import { handlePulse } from "./pulse";
import { serveAudio, serveDreamVideo, serveOfferingImage } from "./media";
import { getApocrypha, handleApocryphaSubmit } from "./apocrypha";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", (c, next) => cors({ origin: c.env.CORS_ORIGIN })(c, next));
app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
app.get("/api/nonce", async (c) => c.json(await issueNonce(c.env.DB)));
app.post("/api/offerings", async (c) => {
  const clHeader = c.req.header("content-length");
  // A browser FormData upload always sets Content-Length. Requiring it closes the chunked-body bypass; the
  // cap rejects oversized bodies before formData() materializes them.
  if (!clHeader) return c.json({ error: "length required" }, 411);
  const len = Number(clHeader);
  if (!Number.isFinite(len) || len > 1_500_000) return c.json({ error: "image too large" }, 413); // 512KB image + multipart overhead
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  return handleOffering(c.env, await c.req.formData(), ip);
});
app.get("/api/codex", (c) => getCodex(c.env, c.req.query("cursor") ?? null));
app.get("/api/state", (c) => getState(c.env));
app.get("/api/relics", (c) => getRelics(c.env, c.req.query("cursor") ?? null));
app.get("/api/dreams", (c) => getDreams(c.env, c.req.query("cursor") ?? null));
app.get("/api/tallies", (c) => getTallies(c.env, c.req.query("date") ?? new Date().toISOString().slice(0, 10)));
app.get("/api/first-light", (c) => getFirstLight(c.env));
app.post("/api/pulse", (c) => handlePulse(c.env, c.req.raw));
app.get("/api/audio/*", (c) => serveAudio(c.env, c.req.path.slice("/api/".length)));
app.get("/api/dream/*", (c) => serveDreamVideo(c.env, c.req.path.slice("/api/".length)));
app.get("/api/img/:id", (c) => serveOfferingImage(c.env, c.req.param("id")));
app.post("/api/apocrypha", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad request" }, 400); }
  return handleApocryphaSubmit(c.env, body, ip);
});
app.get("/api/apocrypha", (c) => getApocrypha(c.env, c.req.query("cursor") ?? null));

// Maker-only on-demand trigger for the scheduled jobs. Guarded by ADMIN_SECRET (constant-time header
// compare); 404s when the secret is unset so the endpoint is invisible until provisioned. It runs the
// SAME lock-held functions the cron fires — the organs stay genuine and idempotent, this only changes
// WHEN they run, never WHAT they do. ?job=tick|rite|dream|all (default tick); ?date=YYYY-MM-DD targets a
// specific dream compose (defaults to today's UTC date).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
app.post("/api/admin/run", async (c) => {
  const secret = c.env.ADMIN_SECRET;
  if (!secret) return c.json({ error: "not found" }, 404);
  if (!timingSafeEqual(c.req.header("x-admin-secret") ?? "", secret)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const job = c.req.query("job") ?? "tick";
  const date = c.req.query("date") ?? undefined;
  const ran: string[] = [];
  if (job === "tick" || job === "all") { await runTick(c.env); ran.push("tick"); }
  if (job === "rite" || job === "all") { await advanceRiteLocked(c.env); ran.push("rite"); }
  if (job === "dream" || job === "all") { await runDreamLocked(c.env, date); ran.push("dream"); }
  if (ran.length === 0) return c.json({ error: "unknown job; use tick|rite|dream|all" }, 400);
  return c.json({ ok: true, ran, date: date ?? null });
});

const TICK_LEASE_MS = 10 * 60_000;
const RITE_OPEN_MINUTE_OF_DAY = 50; // 00:50 UTC (minute-of-day 50) = T-10m before the 01:00 rite hour

function utcDate(now: number): string { return new Date(now).toISOString().slice(0, 10); }

// EYE tick: moderation + perception + housekeeping sweeps, under the `tick` lock. A second concurrent
// invocation finds the lease held and returns immediately (single-flight). Each stage passes a deadline
// so the work stops before the 10-min lease / next 15-min tick boundary; unfinished, idempotent work is
// picked up next tick.
export async function runTick(env: Env, now: number = Date.now()): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "tick", holder, TICK_LEASE_MS))) return;
  const started = now;
  try {
    await runEyeBatch(env, started + 8 * 60_000);
    // Sweep uses the remaining lease (until ~9.5 min in, before the 10-min lease ends / next 15-min tick),
    // bounded so a large quarantine backlog can't overrun the lock and overlap the next tick.
    try { await sweepQuarantine(env, Date.now(), started + 9.5 * 60_000); }
    catch { /* best-effort; never fail the tick */ }
    try { await sweepNonces(env.DB); } catch { /* best-effort */ }
    // Holder count refresh + attended-flag reconciliation (Task 9): bounded, best-effort, no-op pre-launch
    // (no mint configured). A Helius outage or DAS error here must never fail the tick.
    if (env.PULSE_MINT) {
      try { const { reconcileHolders } = await import("./holders"); await reconcileHolders(env); }
      catch { /* best-effort; holder count is refreshed next tick */ }
    }
    // DREAM video render lifecycle (G1): kick tonight's composed dream and poll in-flight renders. No-op
    // when video is off (VIDEO_VENDOR unset). A Grok Imagine outage here must never fail the tick.
    if (env.VIDEO_VENDOR) {
      try { const { renderDreams } = await import("./dream"); await renderDreams(env, Date.now()); }
      catch { /* best-effort; the render resumes next tick (deadline is the backstop) */ }
    }
    // Auto-dispatch: rendered Plates and daily sermons post themselves to X, exactly once,
    // labeled automated on the account. Inert until the four X secrets exist; an X outage
    // here must never fail the tick (state is untouched, so the next tick retries).
    try { const { dispatchArtifacts } = await import("./hermes"); await dispatchArtifacts(env, Date.now()); }
    catch { /* best-effort; the dispatch retries next tick */ }
  } finally { await releaseLock(env.DB, "tick", holder); }
}

// Rite advance under the `rite` lock (SEPARATE from `tick` so a slow EYE batch never blocks the rite, and
// vice versa). This lock is single-flight AND it wraps the WHOLE advance — including the rite's KEEP /
// accretion phase — so KEEP's daily-cap check-then-act (read keptToday -> select room -> commit) and its
// LLM side-effects are serialized: a second concurrent invocation finds the lease held and returns without
// running, which is what makes the cap race-free under overlapping cron. Opens today's rite once the clock
// reaches the offertory-close minute (the `50 0 * * *` cron opens it too; opening here makes the tick
// self-healing if that cron was missed), then advances EVERY non-terminal rite one phase, oldest-first, so
// a rite stranded mid-phase by an outage that outlived its day is still carried to completion.
export async function advanceRiteLocked(
  env: Env, now: number = Date.now(), deadlineMs: number = Date.now() + RITE_WORK_BUDGET_MS,
): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "rite", holder, RITE_LEASE_MS))) return;
  try {
    const minuteOfDay = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
    // Real boundary: minutes 0..49 do not open a rite for "today" — its offertory window has not begun.
    // openRite is idempotent per date.
    if (minuteOfDay >= RITE_OPEN_MINUTE_OF_DAY) await openRite(env.DB, utcDate(now), now);
    // deadlineMs bounds the whole drain inside the rite lock lease (RITE_LEASE_MS). Without it, a multi-day
    // outage recovery (nonTerminalRites drains ALL stranded rites oldest-first in one lock hold) could run
    // several deliberation/sermon phases back-to-back and outlive the lease, letting the next tick acquire
    // the expired lock and run a second, concurrent advance for the same date. Stop draining once past the
    // budget; the remaining rites are idempotent and resume on the next tick. The same deadline flows into
    // each advanceRite -> runKeep so a single slow deliberation is bounded too.
    for (const rite of await nonTerminalRites(env.DB)) {
      if (Date.now() > deadlineMs) break;
      await advanceRite(env, rite.date, now, deadlineMs);
    }
  } finally { await releaseLock(env.DB, "rite", holder); }
}

// DREAM under its own `dream` lock (separate from `tick`/`rite` so it never blocks or is blocked by
// them). Composes for the date whose rite just completed: the Daily Rite for date D opens at 00:50
// UTC and advances via 15-min ticks, so by the 03:00 run it has had two hours of margin to reach
// `complete` — still the SAME UTC date D, so the default is simply today's date.
export async function runDreamLocked(env: Env, date?: string, now: number = Date.now()): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "dream", holder, 10 * 60_000))) return;
  try {
    const d = date ?? utcDate(now);
    const { composeDream } = await import("./dream");
    await composeDream(env, d);
  } finally { await releaseLock(env.DB, "dream", holder); }
}

// Nightly backup under its own `backup` lock (separate from `tick`/`rite`/`dream` so it never blocks or
// is blocked by them). Exports every table to R2, then sweeps backups past the 30-day retention window;
// the sweep is best-effort so a retention hiccup never fails tonight's export.
export async function runBackupLocked(env: Env, now: number = Date.now()): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "backup", holder, 10 * 60_000))) return;
  try {
    const { exportBackup, sweepBackups } = await import("./backup");
    await exportBackup(env, new Date(now).toISOString().slice(0, 10));
    try { await sweepBackups(env, now); } catch { /* best-effort retention */ }
  } finally { await releaseLock(env.DB, "backup", holder); }
}

export default {
  fetch: app.fetch,
  // The cron dispatcher: the four triggers are mutually disjoint so no invocation double-fires a job.
  // `*/15 * * * *` runs the EYE tick AND advances the rite (each under its own lock); `50 0 * * *` opens
  // the day's rite (and advances it) under the rite lock only; `0 3 * * *` composes DREAM under the
  // dream lock only; `30 3 * * *` backs up D1 to R2 under the backup lock only. Cloudflare does not
  // replay a missed cron, so recovery is state-driven: the tick's candidate queries re-select stranded
  // rows and advanceRite resumes from the stored phase, so a rite can complete hours late without data
  // loss.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case "50 0 * * *":
        ctx.waitUntil(advanceRiteLocked(env));
        break;
      case "0 3 * * *":
        ctx.waitUntil(runDreamLocked(env));
        break;
      case "30 3 * * *":
        ctx.waitUntil(runBackupLocked(env));
        break;
      case "*/15 * * * *":
      default:
        ctx.waitUntil(runTick(env));
        ctx.waitUntil(advanceRiteLocked(env));
        break;
    }
  },
};
export { app };
