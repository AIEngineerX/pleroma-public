import { ulid } from "./id";
import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { tongueSystemPrompt, wrapUntrusted } from "./doctrine";
import { addTranscript } from "./db";

const CADENCE_PER_HOUR = 6;
const HOUR_MS = 3_600_000;
const TONGUE_SYSTEM = tongueSystemPrompt();

export interface TongueTrigger {
  kind: "eye_batch" | "keep_decision" | "pulse_crossing" | "rite_phase";
  detail: string;
}

export function parseUtterance(rawText: string): string {
  const p = JSON.parse(rawText.trim()) as { utterance?: unknown };
  const u = typeof p.utterance === "string" ? p.utterance.trim() : "";
  if (!u) throw new Error("TONGUE returned no utterance");
  if (u.split(/\s+/).filter(Boolean).length > 60) throw new Error("TONGUE utterance exceeds the 60-word contract");
  return u;
}

export async function utterancesLastHour(db: D1Database, now: number): Promise<number> {
  const r = await db.prepare(
    `SELECT COUNT(*) AS n FROM transcripts WHERE organ = 'TONGUE' AND created_at > ?1 AND created_at <= ?2`
  ).bind(now - HOUR_MS, now).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function underCadence(db: D1Database, now: number): Promise<boolean> {
  return (await utterancesLastHour(db, now)) < CADENCE_PER_HOUR;
}

// Composes at most one utterance per call, gated by the cadence priest and the budget. Never throws:
// TONGUE is a side-channel; a failure to speak must not fail the pipeline that triggered it.
export async function speakIfDue(env: Env, trigger: TongueTrigger, now: number = Date.now()): Promise<boolean> {
  if (!(await underCadence(env.DB, now))) return false;
  try {
    const res = await askMind(env, {
      model: "claude-sonnet-5", system: TONGUE_SYSTEM, maxTokens: 200,
      user: [{ type: "text", text: `You are told: ${wrapUntrusted("event", trigger.detail)}. Speak if you have something to say.` }],
    });
    const utterance = parseUtterance(res.text);
    await addTranscript(env.DB, { id: ulid(), organ: "TONGUE", register: "verse",
      text: utterance, offering_id: null, rite_id: null, created_at: now });
    return true;
  } catch (e) {
    if (e instanceof MindAsleepError) return false;
    return false; // transport/parse/contract failure: stay silent, never fabricate
  }
}
