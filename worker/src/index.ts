import { ulid } from "ulid";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { issueNonce } from "./nonce";
import { handleOffering } from "./offerings";
import { acquireLock, releaseLock } from "./lock";
import { runEyeBatch } from "./eye";
import { getCodex, getState } from "./read";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", (c, next) => cors({ origin: c.env.CORS_ORIGIN })(c, next));
app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
app.get("/api/nonce", async (c) => c.json(await issueNonce(c.env.DB)));
app.post("/api/offerings", async (c) => handleOffering(c.env, await c.req.formData()));
app.get("/api/codex", (c) => getCodex(c.env, c.req.query("cursor") ?? null));
app.get("/api/state", (c) => getState(c.env));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const holder = ulid();
    if (!(await acquireLock(env.DB, "tick", holder, 10 * 60_000))) return;
    ctx.waitUntil((async () => {
      try { await runEyeBatch(env); }
      finally { await releaseLock(env.DB, "tick", holder); }
    })());
  },
};
export { app };
