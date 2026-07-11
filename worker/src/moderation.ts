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

const FAIL_CLOSED: ModerationResult = { verdict: "reject", category: "moderation_unavailable" };

// Strict, fail-closed shape validation: an "allow" is valid ONLY paired with category "none";
// a "reject" is valid ONLY paired with a known REJECT_CATEGORIES entry. Any other shape
// (missing category, mismatched category, unknown verdict, non-object garbage) fails closed
// rather than being forwarded to EYE.
export function validateVerdict(parsed: unknown): ModerationResult {
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const verdict = (parsed as Record<string, unknown>).verdict;
    const category = (parsed as Record<string, unknown>).category;
    if (verdict === "allow" && category === "none") return { verdict: "allow", category: "none" };
    if (verdict === "reject" && typeof category === "string" &&
        (REJECT_CATEGORIES as readonly string[]).includes(category)) {
      return { verdict: "reject", category };
    }
  }
  return FAIL_CLOSED;
}

export async function moderate(env: Env, imageBytes: Uint8Array, mediaType: string): Promise<ModerationResult> {
  try {
    const dataB64 = toBase64(imageBytes);
    const res = await askMind(env, {
      model: "claude-haiku-4-5-20251001",
      system: RUBRIC,
      user: [{ type: "image", mediaType, dataB64 }, { type: "text", text: "Moderate this image." }],
      maxTokens: 100,
    });
    return validateVerdict(JSON.parse(res.text.trim()));
  } catch (e) {
    if (e instanceof MindAsleepError) throw e;
    return FAIL_CLOSED; // fail CLOSED
  }
}
