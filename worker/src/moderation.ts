import type { Env } from "./env";
import { askMind, MindAsleepError } from "./mind";
import { toBase64 } from "./encoding";

const REJECT_CATEGORIES = [
  "sexual_minors", "explicit_sexual", "gore", "hate_symbol", "doxx_pii", "spam_text_wall",
] as const;

const RUBRIC = `You are an image moderation filter. Reply with ONLY a JSON object:
{"verdict":"allow"|"reject","category":"<one of: none, ${REJECT_CATEGORIES.join(", ")}>"}
Reject if the image contains: sexual content involving minors (sexual_minors), explicit sexual
content (explicit_sexual), graphic violence or gore (gore), hate symbols (hate_symbol),
personal identifying information such as faces in photographs, addresses, or documents
(doxx_pii), or dense walls of text used as spam (spam_text_wall). Hand-drawn sketches,
abstract art, symbols, short words, and doodles are allowed. When uncertain, reject.`;

export interface ModerationResult { verdict: "allow" | "reject"; category: string }

// Thrown when no clean verdict could be obtained (infra failure, timeout, exhausted retries,
// unparseable response, or a malformed verdict shape) — as opposed to a genuine allow/reject
// verdict, which is terminal. The caller (eye.ts) must treat this as transient and retry the
// offering rather than fabricating a rejection from it.
export class ModerationUnavailableError extends Error {}

// Strict shape validation: an "allow" is valid ONLY paired with category "none"; a "reject" is
// valid ONLY paired with a known REJECT_CATEGORIES entry. Any other shape (missing category,
// mismatched category, unknown verdict, non-object garbage) is not a real verdict — returns
// null so the caller can treat it as "moderation unavailable" rather than forwarding garbage to EYE.
export function validateVerdict(parsed: unknown): ModerationResult | null {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const verdict = (parsed as Record<string, unknown>).verdict;
    const category = (parsed as Record<string, unknown>).category;
    if (verdict === "allow" && category === "none") return { verdict: "allow", category: "none" };
    if (verdict === "reject" && typeof category === "string" &&
        (REJECT_CATEGORIES as readonly string[]).includes(category)) {
      return { verdict: "reject", category };
    }
  }
  return null;
}

export async function moderate(env: Env, imageBytes: Uint8Array, mediaType: string): Promise<ModerationResult> {
  let res: { text: string };
  try {
    const dataB64 = toBase64(imageBytes);
    res = await askMind(env, {
      model: "claude-haiku-4-5-20251001", system: RUBRIC,
      user: [{ type: "image", mediaType, dataB64 }, { type: "text", text: "Moderate this image." }],
      maxTokens: 100,
    });
  } catch (e) {
    if (e instanceof MindAsleepError) throw e;
    // Infrastructure failure (bad key, timeout, outage, exhausted retries): NO verdict was obtained.
    // Do NOT fabricate a content rejection — signal unavailability so the caller retries. Fail-closed
    // means "never PUBLISH unmoderated content", NOT "destroy the offering when the moderator is down".
    throw new ModerationUnavailableError(String(e));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(res.text.trim()); }
  catch { throw new ModerationUnavailableError("moderation response was not JSON"); }
  const verdict = validateVerdict(parsed);
  if (verdict === null) throw new ModerationUnavailableError("moderation verdict shape invalid");
  return verdict;
}
