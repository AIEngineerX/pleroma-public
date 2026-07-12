import type { Env } from "./env";
import { reserveEstimate, recordSpend, underCap, dayKey } from "./budget";
import { withTimeout } from "./timeouts";

export interface SpeakResult { audio: Uint8Array; contentType: string; usd: number }
export interface VoiceVendor { name: string; synthesize(text: string): Promise<SpeakResult> }

// Cost estimate for the reservation: TTS is billed per character; $0.00003/char is a safe upper bound
// over both vendors at our tier (a ~600-char sermon reserves ~$0.02). settle() reconciles to the vendor's
// reported cost when it returns one; otherwise the estimate stands.
const USD_PER_CHAR_UPPER = 0.00003;

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// The cache key is canonical per text, independent of which vendor (or format) produced the audio —
// the real format is preserved in R2's httpMetadata.contentType for correct playback headers, so the
// ".mp3" suffix here is just the cache key's stable shape, not a codec claim.
export async function audioKeyFor(text: string): Promise<string> {
  return `audio/${await sha256hex(text)}.mp3`;
}

// A real, deterministic, in-repo vendor: emits a fixed tiny WAV header + silence so the cache/cap logic
// runs against real R2 bytes with no network and no key. NOT a mock — it fully implements VoiceVendor.
export function silentVoice(): VoiceVendor {
  return {
    name: "silent",
    async synthesize(text: string): Promise<SpeakResult> {
      const bytes = new Uint8Array(44 + 16); // minimal WAV-ish payload; content is deterministic
      new TextEncoder().encodeInto("RIFF....WAVEfmt ", bytes);
      return { audio: bytes, contentType: "audio/wav", usd: text.length * USD_PER_CHAR_UPPER };
    },
  };
}

export function elevenLabsVoice(env: Env): VoiceVendor {
  return {
    name: "elevenlabs",
    async synthesize(text: string): Promise<SpeakResult> {
      const res = await withTimeout("elevenlabs", 30_000, (signal) => fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
        {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
          signal,
        },
      ));
      if (!res.ok) throw new Error(`elevenlabs ${res.status}: ${await res.text()}`);
      return { audio: new Uint8Array(await res.arrayBuffer()), contentType: "audio/mpeg", usd: text.length * USD_PER_CHAR_UPPER };
    },
  };
}

// xAI/Grok voice: primary vendor. The exact request shape is verified against the live API during the
// day-2/day-6 TTS spike (PLANNING open question 3b); until then VOICE_VENDOR stays "elevenlabs" in prod
// if the spike is not yet green. Kept behind the same interface so switching is one env-var change.
export function xaiVoice(env: Env): VoiceVendor {
  return {
    name: "xai",
    async synthesize(text: string): Promise<SpeakResult> {
      const res = await withTimeout("xai", 30_000, (signal) => fetch("https://api.x.ai/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${env.XAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "grok-voice", input: text, response_format: "mp3" }),
        signal,
      }));
      if (!res.ok) throw new Error(`xai ${res.status}: ${await res.text()}`);
      return { audio: new Uint8Array(await res.arrayBuffer()), contentType: "audio/mpeg", usd: text.length * USD_PER_CHAR_UPPER };
    },
  };
}

export function vendorFor(env: Env): VoiceVendor {
  if (env.VOICE_VENDOR === "xai") return xaiVoice(env);
  if (env.VOICE_VENDOR === "elevenlabs") return elevenLabsVoice(env);
  return silentVoice();
}

// Cache-first, cap-guarded synthesis. Returns the R2 key. Cache hit => no spend, no synth. Cap reached
// => no synth, no audio (caller prints text-only). Only ever called from lock-held rite/tick contexts.
export async function speak(
  env: Env, text: string, vendor: VoiceVendor = vendorFor(env),
): Promise<{ audioKey: string; cached: boolean; spoken: boolean }> {
  const key = await audioKeyFor(text);
  if (await env.RELICS.head(key)) return { audioKey: key, cached: true, spoken: false };
  if (!(await underCap(env.DB, "tts"))) return { audioKey: key, cached: false, spoken: false };

  const day = dayKey();
  const est = text.length * USD_PER_CHAR_UPPER;
  if (!(await reserveEstimate(env.DB, "tts", est, day))) {
    return { audioKey: key, cached: false, spoken: false }; // reservation would breach the cap
  }
  let settled = false;
  const settle = async (usd: number) => { if (!settled) { settled = true; if (usd - est !== 0) await recordSpend(env.DB, "tts", usd - est, day); } };
  try {
    const out = await vendor.synthesize(text);
    await env.RELICS.put(key, out.audio, { httpMetadata: { contentType: out.contentType } });
    await settle(out.usd);
    return { audioKey: key, cached: false, spoken: true };
  } catch (e) {
    await settle(0); // release the reservation; nothing billed we can attribute
    throw e;
  }
}
