import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { issueNonce } from "./nonce";

const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", (c, next) => cors({ origin: c.env.CORS_ORIGIN })(c, next));
app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));
app.get("/api/nonce", async (c) => c.json(await issueNonce(c.env.DB)));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    // Task 9 wires the tick pipeline here.
  },
};
export { app };
