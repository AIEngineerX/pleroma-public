import { ulid } from "ulid";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { issueNonce } from "./nonce";
import { handleOffering } from "./offerings";
import { acquireLock, releaseLock } from "./lock";
import { runEyeBatch, sweepQuarantine } from "./eye";
import { getCodex, getState } from "./read";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", (c, next) => cors({ origin: c.env.CORS_ORIGIN })(c, next));
app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
app.get("/api/nonce", async (c) => c.json(await issueNonce(c.env.DB)));
app.post("/api/offerings", async (c) => {
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > 1_500_000) return c.json({ error: "image too large" }, 413); // 512KB image + multipart overhead
  return handleOffering(c.env, await c.req.formData());
});
app.get("/api/codex", (c) => getCodex(c.env, c.req.query("cursor") ?? null));
app.get("/api/state", (c) => getState(c.env));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const holder = ulid();
    if (!(await acquireLock(env.DB, "tick", holder, 10 * 60_000))) return;
    const started = Date.now();
    ctx.waitUntil((async () => {
      const batchDeadline = started + 8 * 60_000;
      try {
        await runEyeBatch(env, batchDeadline);
        // Sweep uses the remaining lease (until ~9.5 min in, before the 10-min lease ends / next 15-min tick),
        // bounded so a large quarantine backlog can't overrun the lock and overlap the next tick.
        try { await sweepQuarantine(env, Date.now(), started + 9.5 * 60_000); }
        catch { /* best-effort; never fail the tick */ }
      } finally { await releaseLock(env.DB, "tick", holder); }
    })());
  },
};
export { app };
