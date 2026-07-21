import type { Env } from "./env";
import { withTimeout } from "./timeouts";

// Stage 0's record of an operator condition is a durable, operator-visible signal stored in config
// (alert:<code>), which drives /api/state's aggregate `degraded:true` (the page renders that honestly
// in voice) and which the Maker can spot-check by DB. The detail is deliberately NOT written to a
// transcript: the codex (/api/codex) is public and unauthenticated, so an alert detail there would
// leak internal state permanently — clearAlert removes the config row, but a transcript would outlive
// it. Only the aggregate "degraded" is ever public (PLANNING.md safety contract).
//
// On top of that pulled signal, an OPTIONAL private push: when env.ALERT_WEBHOOK_URL is set, a fresh
// alert (and its later recovery) POSTs a one-line notice to a Discord/Slack-style incoming webhook.
// This is a private Maker channel, never public, so the safety contract is untouched. It fires only on
// the transition (absent->present / present->absent), never every tick, so a persistent condition
// cannot spam. It is best-effort and timeout-bounded — a webhook failure never affects the caller or
// the tick. It cannot catch a fully-dead loop (a dead loop cannot POST); the external uptime monitor
// on /api/health is the only thing that can, and the two are complementary.

async function notify(env: Env, text: string): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    // `content` (Discord) and `text` (Slack) in one body: each service reads its own key and ignores
    // the other, so one payload serves both incoming-webhook shapes.
    await withTimeout("alert-webhook", 5_000, (signal) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, text }),
      signal,
    }));
  } catch { /* best-effort: a private alert channel must never break the loop it reports on */ }
}

export async function raiseAlert(env: Env, code: string, detail: string): Promise<void> {
  // Detect a fresh raise (row absent) before the upsert, so the webhook fires on the transition only.
  const existed = await env.DB.prepare(`SELECT 1 FROM config WHERE key = ?1`).bind(`alert:${code}`).first();
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`)
    .bind(`alert:${code}`, JSON.stringify({ detail, at: Date.now() })).run();
  if (!existed) await notify(env, `PLEROMA alert [${code}]: ${detail}`);
}

export async function clearAlert(env: Env, code: string): Promise<void> {
  const existed = await env.DB.prepare(`SELECT 1 FROM config WHERE key = ?1`).bind(`alert:${code}`).first();
  await env.DB.prepare(`DELETE FROM config WHERE key = ?1`).bind(`alert:${code}`).run();
  if (existed) await notify(env, `PLEROMA resolved [${code}]`);
}

export async function activeAlerts(db: D1Database): Promise<string[]> {
  const rows = (await db.prepare(`SELECT key FROM config WHERE key LIKE 'alert:%'`).all<{ key: string }>()).results;
  return rows.map(r => r.key.slice("alert:".length));
}
