import type { Env } from "./env";
import { recordSpend, reserveEstimate } from "./budget";

export class MindAsleepError extends Error {}
export class NonRetryableError extends Error {}

// USD per 1M tokens: [input, output].
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-sonnet-5": [3, 15],
};

export interface TextPart { type: "text"; text: string }
export interface ImagePart { type: "image"; mediaType: string; dataB64: string }
export interface MindRequest {
  model: keyof typeof PRICES | string;
  system: string;
  user: Array<TextPart | ImagePart>;
  maxTokens: number;
}
export interface MindResponse { text: string; usd: number }

// A single image bills ~ (w*h)/750 tokens; the API downscales to <=1568px/edge, so a 1568^2 image is
// ~3279 tokens. 4000 is a safe constant ceiling — and far below the base64 length, which must NOT drive
// the estimate. For text, UTF-8 byte length is a provable upper bound on token count (a token is >= 1
// byte), so the estimate is guaranteed >= actual input cost.
const IMAGE_TOKENS_MAX = 4000;
const FRAMING_TOKENS = 20; // role/message framing not present in the payload strings.

// Provable pre-call upper bound: maxTokens at the model's OUTPUT price, plus an input estimate that is
// guaranteed >= the real input token count (UTF-8 byte length for text, a constant ceiling for images).
// Used to reserve budget before the call is made, since the real cost is only known after a billed
// response comes back; because the estimate never undercounts, settle(actual) on success can only
// REDUCE spend, so the daily cap (gated `spent + reserved <= cap`) is a hard ceiling.
export function estimateCostUsd(req: MindRequest): number {
  const [inP, outP] = PRICES[req.model] ?? [3, 15];
  const enc = new TextEncoder();
  let inputTokUpper = enc.encode(req.system).length + FRAMING_TOKENS;
  for (const p of req.user) {
    inputTokUpper += p.type === "text" ? enc.encode(p.text).length : IMAGE_TOKENS_MAX;
  }
  return (inputTokUpper * inP + req.maxTokens * outP) / 1_000_000;
}

// Budget reservation is atomic (see budget.ts reserveEstimate): the reservation writes the
// estimate up front, and this call settles the difference against actual spend once the
// billed call resolves, or releases the reservation in full if the call never billed.
// askMind is still only ever called from the lock-held scheduled tick (see index.ts
// scheduled + lock.ts); do not call from fetch handlers.
export async function askMind(env: Env, req: MindRequest): Promise<MindResponse> {
  const reserved = estimateCostUsd(req);
  if (!(await reserveEstimate(env.DB, "llm", reserved))) {
    throw new MindAsleepError("llm budget cap reached (reservation)");
  }

  let settled = false;
  const settle = async (actualUsd: number) => {
    if (settled) return; settled = true;
    const delta = actualUsd - reserved;
    if (delta !== 0) await recordSpend(env.DB, "llm", delta);
  };

  try {
    const body = JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{
        role: "user",
        content: req.user.map(p => p.type === "text"
          ? { type: "text", text: p.text }
          : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.dataB64 } }),
      }],
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (netErr) {
        // No response received: the call may already be billed. Keep the reservation (do not
        // release via the finally) and stop — a retry could bill a second time while we would
        // settle only once.
        await settle(reserved);
        throw new NonRetryableError(`mind transport failure: ${String(netErr)}`);
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`); // not billed; retryable
      } else if (!res.ok) {
        throw new NonRetryableError(`anthropic ${res.status}: ${await res.text()}`); // 4xx, not billed -> finally releases
      } else {
        let data: {
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };
        try {
          data = await res.json();
        } catch (parseErr) {
          // HTTP 200 = billed but cost unknown. Keep the reserved estimate; terminal (retrying re-bills).
          await settle(reserved);
          throw new NonRetryableError(`mind response parse failure: ${String(parseErr)}`);
        }
        const [inP, outP] = PRICES[req.model] ?? [3, 15];
        const usd = (data.usage.input_tokens * inP + data.usage.output_tokens * outP) / 1_000_000;
        await settle(usd);
        return { text: data.content.filter(c => c.type === "text").map(c => c.text).join(""), usd };
      }
      if (attempt === 0) await new Promise(r => setTimeout(r, 2_000));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr)); // 429/5xx exhausted -> finally releases
  } finally {
    // Releases the full reservation (delta = -reserved) only if nothing already settled —
    // covers every path that exits without billing: exhausted retries, and NonRetryableError
    // from a non-2xx status that isn't the parse-failure branch above.
    await settle(0);
  }
}
