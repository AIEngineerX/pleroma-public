import type { Env } from "./env";
import { recordSpend, underCap } from "./budget";

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

// Budget check-then-record is not atomic; safe because askMind is only ever called from the
// lock-held scheduled tick (see index.ts scheduled + lock.ts). Do not call from fetch handlers.
export async function askMind(env: Env, req: MindRequest): Promise<MindResponse> {
  if (!(await underCap(env.DB, "llm"))) throw new MindAsleepError("llm budget cap reached");

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
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); }
      else if (!res.ok) { throw new NonRetryableError(`anthropic ${res.status}: ${await res.text()}`); }
      else {
        const data = await res.json<{
          content: Array<{ type: string; text?: string }>;
          usage: { input_tokens: number; output_tokens: number };
        }>();
        const [inP, outP] = PRICES[req.model] ?? [3, 15];
        const usd = (data.usage.input_tokens * inP + data.usage.output_tokens * outP) / 1_000_000;
        await recordSpend(env.DB, "llm", usd);
        const text = data.content.filter(c => c.type === "text").map(c => c.text).join("");
        return { text, usd };
      }
    } catch (e) {
      if (e instanceof NonRetryableError || e instanceof MindAsleepError) throw e;
      lastErr = e;
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 2_000));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
