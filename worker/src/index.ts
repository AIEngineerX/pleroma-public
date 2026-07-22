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
import { getCodex, getDreams, getFirstLight, getRelics, getState, getTallies, relicOf } from "./read";
import { handlePulse } from "./pulse";
import { serveAudio, serveDreamVideo, serveOfferingImage } from "./media";
import { getApocrypha, handleApocryphaSubmit } from "./apocrypha";
import { getAdminStatus } from "./admin";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", (c, next) => {
  // Admin routes are gated by the ADMIN_SECRET request header, not a cookie — there is no ambient
  // authority a cross-site page could abuse, so reflecting the caller's origin here is safe and only
  // lets the Maker's own local dashboard (opened as file:// → Origin "null", or from localhost) read
  // the JSON. Without the secret every admin route still 404s/401s regardless of origin. Public routes
  // keep the strict apex-only CORS_ORIGIN.
  if (c.req.path.startsWith("/api/admin/")) {
    return cors({
      origin: (o) => o ?? "*",
      allowHeaders: ["x-admin-secret", "content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    })(c, next);
  }
  return cors({ origin: c.env.CORS_ORIGIN })(c, next);
});
// Health reflects the HEARTBEAT, not just process liveness: fresh/never-run -> 200; a tick that has
// stopped stamping for TICK_STALE_MS -> 503. An external uptime monitor points here to catch a
// silently-dead loop (the one failure a worker cannot self-report).
app.get("/api/health", async (c) => {
  const stale = await tickStale(c.env, Date.now());
  return c.json(stale ? { ok: false, env: c.env.ENVIRONMENT, stale: true } : { ok: true, env: c.env.ENVIRONMENT }, stale ? 503 : 200);
});
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
app.get("/api/relic-of/:offeringId", (c) => relicOf(c.env, c.req.param("offeringId")));
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
// Maker-only aggregate status for the private admin dashboard. Same gate as /api/admin/run: 404
// when ADMIN_SECRET is unset (invisible until provisioned), 401 on mismatch (constant-time). Read-only
// — it composes heartbeat/alerts/budget/pulse/dispatch state and secret PRESENCE booleans (never a
// secret's value). See docs/admin/dashboard.html.
app.get("/api/admin/status", async (c) => {
  const secret = c.env.ADMIN_SECRET;
  if (!secret) return c.json({ error: "not found" }, 404);
  if (!timingSafeEqual(c.req.header("x-admin-secret") ?? "", secret)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json(await getAdminStatus(c.env));
});
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
const TICK_STALE_MS = 45 * 60_000;  // 3 missed 15-min ticks — /api/health flips to 503 past this so an
                                    // external uptime monitor catches a fully-dead loop. The 3-tick
                                    // window also absorbs a single failed heartbeat write without a
                                    // spurious alert (the next tick re-stamps 15 min later).

function utcDate(now: number): string { return new Date(now).toISOString().slice(0, 10); }

// Heartbeat: a completed scheduled job stamps `now` into config so /api/health can detect a
// fully-stopped loop from OUTSIDE the worker (a dead loop raises no alert of its own — every alert
// path lives inside the very loop that has stopped, so an external monitor reading this is the only
// signal that survives a silent stop).
async function stampHeartbeat(env: Env, key: string, now: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`)
    .bind(key, String(now)).run();
}

// A never-yet-run worker (fresh deploy, no stamp) reports healthy so a monitor does not false-alarm
// before the first cron fires; once a tick has ever stamped, a value older than TICK_STALE_MS is stale.
// A read FAILURE reports stale (unhealthy), never healthy: a worker that cannot read its own heartbeat
// store IS degraded, and reporting 200 there would hide a real D1 outage from the external monitor.
async function tickStale(env: Env, now: number): Promise<boolean> {
  let row: { value: string } | null;
  try {
    row = await env.DB.prepare(`SELECT value FROM config WHERE key = 'tick_ok'`).first<{ value: string }>();
  } catch { return true; }
  if (!row) return false;
  const at = Number(row.value);
  return !Number.isFinite(at) || now - at > TICK_STALE_MS;
}

// EYE tick: moderation + perception + housekeeping sweeps, under the `tick` lock. A second concurrent
// invocation finds the lease held and returns immediately (single-flight). Each stage passes a deadline
// so the work stops before the 10-min lease / next 15-min tick boundary; unfinished, idempotent work is
// picked up next tick.
export async function runTick(env: Env, now: number = Date.now()): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "tick", holder, TICK_LEASE_MS))) return;
  const started = now;
  try {
    // Guarded like the sweeps below it: a transient perception error (a D1 blip, a malformed batch)
    // must NOT skip the housekeeping that follows in this same tick — the quarantine sweep, dream/film
    // render, and X dispatch all sit below this call. Surface the failure as an alert instead.
    try {
      await runEyeBatch(env, started + 8 * 60_000);
      await (await import("./alert")).clearAlert(env, "eye_batch_failed");
    } catch (e) {
      try { await (await import("./alert")).raiseAlert(env, "eye_batch_failed", String(e)); }
      catch { /* best-effort; never fail the tick */ }
    }
    // Sweep uses the remaining lease (until ~9.5 min in, before the 10-min lease ends / next 15-min tick),
    // bounded so a large quarantine backlog can't overrun the lock and overlap the next tick. A repeated
    // silent sweep failure would let quarantine/ grow unbounded in R2, so it raises an operator alert.
    try {
      await sweepQuarantine(env, Date.now(), started + 9.5 * 60_000);
      await (await import("./alert")).clearAlert(env, "quarantine_sweep_failed");
    } catch (e) {
      try { await (await import("./alert")).raiseAlert(env, "quarantine_sweep_failed", String(e)); }
      catch { /* best-effort; never fail the tick */ }
    }
    try { await sweepNonces(env.DB); } catch { /* best-effort */ }
    // Sermon-audio backfill: a sermon that missed its voice at the rite (vendor down, key missing)
    // is spoken by a later tick once the vendor can. Best-effort side-channel like everything here.
    try { const { backfillSermonAudio } = await import("./rite"); await backfillSermonAudio(env); }
    catch { /* text-only until a later tick heals it */ }
    // Retention sweeps for the two insert-only logs (rate windows, pulse dedup events): without
    // these both tables — and the nightly backup that re-exports them — grow without bound.
    try { const { sweepRateLimits } = await import("./ratelimit"); await sweepRateLimits(env.DB, Date.now()); }
    catch { /* best-effort */ }
    try { const { sweepPulseEvents } = await import("./pulse"); await sweepPulseEvents(env.DB, Date.now()); }
    catch { /* best-effort */ }
    // Holder count refresh + attended-flag reconciliation (Task 9): bounded, best-effort, no-op pre-launch
    // (no mint configured). A Helius outage or DAS error here must never fail the tick.
    if (env.PULSE_MINT) {
      try { const { reconcileHolders } = await import("./holders"); await reconcileHolders(env); }
      catch { /* best-effort; holder count is refreshed next tick */ }
      // Graduation tripwire: webhook deliveries that classify zero swaps mean PULSE_POOLS no longer
      // matches where the token actually trades (pulse.ts alertPoolMismatch) — the one PULSE failure
      // that is otherwise invisible, because events still arrive and the heart just quietly starves.
      try { const { alertPoolMismatch } = await import("./pulse"); await alertPoolMismatch(env, Date.now()); }
      catch { /* best-effort operator signal */ }
    }
    // DREAM video render lifecycle (G1): kick tonight's composed dream and poll in-flight renders. No-op
    // when video is off (VIDEO_VENDOR unset). A Grok Imagine outage here must never fail the tick.
    if (env.VIDEO_VENDOR) {
      try { const { renderDreams } = await import("./dream"); await renderDreams(env, Date.now()); }
      catch { /* best-effort; the render resumes next tick (deadline is the backstop) */ }
      try { const { renderSermonFilms } = await import("./sermonFilm"); await renderSermonFilms(env, Date.now()); }
      catch { /* best-effort; the render resumes next tick (deadline is the backstop) */ }
    }
    // Auto-dispatch: rendered Plates and daily sermons post themselves to X, at most once each
    // (claim-before-send, hermes.ts), labeled automated on the account. Inert until the four X
    // secrets exist; an X outage here must never fail the tick (a released claim retries next
    // tick). The deadline bounds the dispatch inside this lock's lease.
    // A throw here used to vanish into an empty catch. On 2026-07-22 code shipped ahead of migration
    // 0025 and dispatchArtifacts threw on its FIRST query (`d.source`, a column prod did not have yet)
    // for two hours: nothing posted, no claim was written, and so the unposted watchdog had nothing to
    // find stalled either — a total dispatch outage with no operator signal anywhere. The dispatch must
    // still never fail the tick (an X outage is not a dead being), so the failure is raised as an alert
    // rather than rethrown, and clears itself on the next pass that gets through.
    try {
      const { dispatchArtifacts } = await import("./hermes");
      await dispatchArtifacts(env, Date.now(), started + 9.5 * 60_000);
      try { const { clearAlert } = await import("./alert"); await clearAlert(env, "dispatch_failed"); }
      catch { /* an alert write must never be what fails the tick */ }
    } catch (e) {
      try {
        const { raiseAlert } = await import("./alert");
        // Bounded: an unbounded vendor/D1 message must not become an unbounded row. Detail is
        // operator-only — read.ts exposes just the aggregate `degraded` boolean publicly.
        const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        await raiseAlert(env, "dispatch_failed", `dispatch threw and posted nothing this tick: ${reason}`);
      } catch { /* an alert write must never be what fails the tick */ }
    }
    // Monthly cost backstop: surface a tripped cumulative-monthly ceiling as an operator alert, so the
    // graceful sleep it causes (organs stop spending until the month rolls over) is never mistaken for
    // a dead loop; clear it once spend is back under the ceiling (a new month).
    try {
      const { monthlyExceeded } = await import("./budget");
      const alert = await import("./alert");
      if (await monthlyExceeded(env.DB)) await alert.raiseAlert(env, "monthly_cap", "cumulative monthly spend ceiling reached");
      else await alert.clearAlert(env, "monthly_cap");
    } catch { /* best-effort */ }
    // Tick heartbeat, stamped LAST: reaching here means the tick ran its body to completion (every
    // sub-job above is individually guarded and raises its own alert on failure, so a single failed
    // organ does not suppress the heartbeat). /api/health reads this to detect a fully-stopped loop.
    try { await stampHeartbeat(env, "tick_ok", Date.now()); }
    catch { /* best-effort; the 45-min staleness window absorbs a single missed stamp */ }
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
    // A rite normally reaches `complete` within its own UTC day. One still non-terminal from a PRIOR
    // day is genuinely stuck (e.g. budget-asleep at the sermon phase across a day boundary) — a stall
    // that is otherwise silent, since rite_failed fires only on a terminal FAIL. Re-read AFTER the
    // drain so a rite just carried to completion this pass does not alert.
    try {
      const alert = await import("./alert");
      const today = utcDate(now);
      const stalled = (await nonTerminalRites(env.DB)).some(r => r.date < today);
      if (stalled) await alert.raiseAlert(env, "rite_stalled", `a rite dated before ${today} is still non-terminal`);
      else await alert.clearAlert(env, "rite_stalled");
    } catch { /* best-effort */ }
  } finally { await releaseLock(env.DB, "rite", holder); }
}

// DREAM under its own `dream` lock (separate from `tick`/`rite` so it never blocks or is blocked by
// them). An explicit date (the admin endpoint) composes exactly that date. The nightly cron is
// state-driven: every recent completed rite with kept relics and no dream yet, oldest-first — so a
// rite that reached `complete` only after that night's 03:00 run (outage recovery) still gets its
// dream on the next run instead of losing the night forever.
export async function runDreamLocked(env: Env, date?: string, now: number = Date.now()): Promise<void> {
  const holder = ulid();
  if (!(await acquireLock(env.DB, "dream", holder, 10 * 60_000))) return;
  try {
    const { composeDream, composableRiteDates } = await import("./dream");
    const dates = date !== undefined ? [date] : await composableRiteDates(env, now);
    for (const d of dates) await composeDream(env, d);
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
    const alert = await import("./alert");
    try {
      await exportBackup(env, new Date(now).toISOString().slice(0, 10));
      await alert.clearAlert(env, "backup_failed");
      // A success marker: the nightly export is the one unattended job with no natural downstream
      // signal, so record that it ran for an operator to spot-check alongside the failure alert.
      await stampHeartbeat(env, "backup_ok", Date.now());
    } catch (e) {
      // A silent backup failure is invisible until a restore is needed and the newest export is stale.
      try { await alert.raiseAlert(env, "backup_failed", String(e)); } catch { /* best-effort */ }
    }
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
