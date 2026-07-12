import { ulid } from "ulid";
import type { Env } from "./env";
import { addTranscript } from "./db";

// Stage 0 has no external pager: escalation = a durable, operator-visible signal. An alert writes a
// PRIEST/system transcript (shows in the codex + the Maker's DB spot-checks) AND sets config alert:<code>
// so /api/state can report `degraded:true`, which the dormant/live page renders honestly in voice.
export async function raiseAlert(env: Env, code: string, detail: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2`)
    .bind(`alert:${code}`, JSON.stringify({ detail, at: Date.now() })).run();
  await addTranscript(env.DB, { id: ulid(), organ: "PRIEST", register: "system",
    text: `alert ${code}: ${detail}`, offering_id: null, rite_id: null, created_at: Date.now() });
}

export async function clearAlert(env: Env, code: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM config WHERE key = ?1`).bind(`alert:${code}`).run();
}

export async function activeAlerts(db: D1Database): Promise<string[]> {
  const rows = (await db.prepare(`SELECT key FROM config WHERE key LIKE 'alert:%'`).all<{ key: string }>()).results;
  return rows.map(r => r.key.slice("alert:".length));
}
