import type { Env } from "./env";

// Stage 0 has no external pager: escalation = a durable, operator-visible signal stored ONLY in config
// (alert:<code>), which the Maker reads by DB spot-check and which drives /api/state's aggregate
// `degraded:true` (the page renders that honestly in voice). The detail is deliberately NOT written to a
// transcript: the codex (/api/codex) is public and unauthenticated, so an alert detail there would leak
// internal state permanently — clearAlert removes the config row, but a transcript would outlive it. Only
// the aggregate "degraded" is ever public (PLANNING.md safety contract).
export async function raiseAlert(env: Env, code: string, detail: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`)
    .bind(`alert:${code}`, JSON.stringify({ detail, at: Date.now() })).run();
}

export async function clearAlert(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM config WHERE key = ?1`).bind(`alert:${code}`).run();
}

export async function activeAlerts(db: D1Database): Promise<string[]> {
  const rows = (await db.prepare(`SELECT key FROM config WHERE key LIKE 'alert:%'`).all<{ key: string }>()).results;
  return rows.map(r => r.key.slice("alert:".length));
}
