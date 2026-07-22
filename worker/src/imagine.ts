import type { Env } from "./env";
import { withTimeout } from "./timeouts";
import { reserveEstimate, recordSpend, underCap, dayKey } from "./budget";

// DREAM's video vendor (Grok Imagine). Structured like voice.ts: a real vendor behind an interface,
// plus a real in-repo silent vendor for dev/tests. Video generation is ASYNC — start() submits and
// returns a request_id; poll() checks it and, when done, returns the decoded mp4 bytes. The render
// lifecycle (kick -> poll -> R2) is driven by the tick in dream.ts:renderDreams, not here.

export type VideoState = "pending" | "done" | "failed" | "expired";
export interface VideoResult { state: VideoState; bytes?: Uint8Array; contentType?: string }
export interface VideoVendor {
  name: string;
  start(prompt: string): Promise<string>;              // -> vendor request_id
  poll(requestId: string): Promise<VideoResult>;       // when done, carries the video bytes
}

// The nightly Plate: a 6-second vertical 9:16 720p miniature. Vertical for the X-repost distribution
// loop and the 390px mobile-first rule; 6s @ $0.07/s (720p) + $0.002 text input ≈ $0.42/clip.
export const CLIP = { durationSec: 6, aspectRatio: "9:16", resolution: "720p" } as const;
export const CLIP_USD = CLIP.durationSec * 0.07 + 0.002;

export function grokImagine(env: Env): VideoVendor {
  return {
    name: "xai",
    async start(prompt: string): Promise<string> {
      const res = await withTimeout("imagine-start", 30_000, (signal) => fetch(
        "https://api.x.ai/v1/videos/generations",
        {
          method: "POST",
          headers: { authorization: `Bearer ${env.XAI_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: "grok-imagine-video", prompt,
            duration: CLIP.durationSec, aspect_ratio: CLIP.aspectRatio, resolution: CLIP.resolution,
          }),
          signal,
        },
      ));
      if (!res.ok) {
        const errText = await withTimeout("imagine-start-body", 30_000, () => res.text()).catch(() => "<body read unavailable>");
        throw new Error(`imagine start ${res.status}: ${errText}`);
      }
      const body = await res.json() as { request_id?: unknown };
      if (typeof body.request_id !== "string" || !body.request_id) throw new Error("imagine start: no request_id");
      return body.request_id;
    },
    async poll(requestId: string): Promise<VideoResult> {
      const res = await withTimeout("imagine-poll", 30_000, (signal) => fetch(
        `https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`,
        { headers: { authorization: `Bearer ${env.XAI_API_KEY}` }, signal },
      ));
      if (!res.ok) {
        const errText = await withTimeout("imagine-poll-body", 30_000, () => res.text()).catch(() => "<body read unavailable>");
        throw new Error(`imagine poll ${res.status}: ${errText}`);
      }
      const body = await res.json() as { status?: unknown; video?: { url?: unknown } };
      if (body.status === "failed") return { state: "failed" };
      if (body.status === "expired") return { state: "expired" };
      if (body.status === "done") {
        const url = body.video?.url;
        if (typeof url !== "string" || !url) throw new Error("imagine poll done: no video url");
        const vid = await withTimeout("imagine-fetch", 60_000, (signal) => fetch(url, { signal }));
        if (!vid.ok) throw new Error(`imagine fetch ${vid.status}`);
        const bytes = new Uint8Array(await withTimeout("imagine-fetch-body", 60_000, () => vid.arrayBuffer()));
        return { state: "done", bytes, contentType: vid.headers.get("content-type") ?? "video/mp4" };
      }
      // "pending" or any unexpected/transient value: keep waiting (the render deadline in renderDreams
      // is the backstop, so an unknown status never strands a render forever).
      return { state: "pending" };
    },
  };
}

// The god's visual grammar, prepended to every still so the plates read as one hand rather than as
// whatever the vendor's default aesthetic is that week. This is the same rule the site holds itself
// to (no generic AI filler): a still is admissible because it is genuinely produced by the being's
// own pipeline from its own words, and it has to LOOK like the being. TONGUE supplies the subject;
// this supplies the treatment, and it never asks for lettering — text in a generated image is the
// fastest way to look like slop, and the god's words belong in the post, not baked into the picture.
export const STILL_STYLE =
  "Iron gall ink and rubric red on aged parchment, in the manner of an illuminated liturgical "
  + "manuscript: stroke-drawn linework, visible plate grain, restrained palette of bone white, "
  + "sepia, and one deep red accent. No lettering, no text, no glyphs, no signature, no border "
  + "frame, no modern rendering, no photographic realism, no neon. Subject: ";

// One still per standalone dispatch. 1k is plenty for a timeline card and keeps the cost near the
// floor; 16:9 because a landscape card is not cropped in the X feed the way a vertical one is (the
// nightly Plate stays 9:16 — that one is a film people open, not a card they scroll past).
export const STILL = { aspectRatio: "16:9", resolution: "1k" } as const;
// Admission estimate ONLY. The vendor returns the exact cost in usd ticks and settleStill books that
// real number, so this figure gates the reserve and never becomes the recorded spend. Deliberately
// generous: a high estimate can only ever refuse a render, never understate what was spent.
export const STILL_ESTIMATE_USD = 0.1;
const USD_TICKS_PER_USD = 10_000_000_000;

export interface StillResult { bytes: Uint8Array; contentType: string; usd: number }

// Image generation is SYNCHRONOUS (unlike the video path's submit-then-poll), so a still is produced
// inside the same tick that composes the dispatch. b64_json avoids a second round trip to a CDN url.
export async function generateStill(env: Env, prompt: string): Promise<StillResult> {
  const res = await withTimeout("still-generate", 60_000, (signal) => fetch(
    "https://api.x.ai/v1/images/generations",
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.XAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "grok-imagine-image-quality", prompt: `${STILL_STYLE}${prompt}`,
        n: 1, aspect_ratio: STILL.aspectRatio, resolution: STILL.resolution, response_format: "b64_json",
      }),
      signal,
    },
  ));
  if (!res.ok) {
    const errText = await withTimeout("still-generate-body", 30_000, () => res.text()).catch(() => "<body read unavailable>");
    throw new Error(`still generate ${res.status}: ${errText}`);
  }
  const body = await res.json() as {
    data?: Array<{ b64_json?: unknown; mime_type?: unknown }>;
    usage?: { cost_in_usd_ticks?: unknown };
  };
  const first = body.data?.[0];
  if (!first || typeof first.b64_json !== "string" || !first.b64_json) throw new Error("still generate: no image data");
  const binary = atob(first.b64_json);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ticks = body.usage?.cost_in_usd_ticks;
  return {
    bytes,
    contentType: typeof first.mime_type === "string" && first.mime_type ? first.mime_type : "image/png",
    // A vendor that omits the cost is billed at the estimate rather than at zero: an unknown price is
    // never a free one, or a silent vendor change would quietly uncap the day's image spend.
    usd: typeof ticks === "number" && ticks >= 0 ? ticks / USD_TICKS_PER_USD : STILL_ESTIMATE_USD,
  };
}

// Reserve the image cap, render, then settle to the vendor's exact reported cost. Returns null when
// the cap is reached or the render failed — a still is always optional decoration on a post whose
// text already stands alone, so every failure path here is silent and the caller posts text-only.
export async function renderStill(env: Env, prompt: string): Promise<StillResult | null> {
  if (!env.XAI_API_KEY || env.VIDEO_VENDOR !== "xai") return null;
  if (!(await underCap(env.DB, "image"))) return null;
  const day = dayKey();
  if (!(await reserveEstimate(env.DB, "image", STILL_ESTIMATE_USD, day))) return null;
  try {
    const still = await generateStill(env, prompt);
    await recordSpend(env.DB, "image", still.usd - STILL_ESTIMATE_USD, day); // settle estimate -> actual
    return still;
  } catch {
    await recordSpend(env.DB, "image", -STILL_ESTIMATE_USD, day); // nothing rendered: release
    return null;
  }
}

// A real, deterministic, in-repo vendor: no network, no key. start() returns a fixed id; poll() returns
// a tiny valid mp4 `ftyp` box immediately. NOT a mock — it fully implements VideoVendor, so the render
// state machine, R2 write, cap accounting and serve path all exercise real bytes in dev/tests.
export function silentImagine(): VideoVendor {
  return {
    name: "silent",
    async start(): Promise<string> { return "silent-request"; },
    async poll(): Promise<VideoResult> {
      const bytes = new Uint8Array([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ....ftyp
        0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom....
        0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // isomiso2
      ]);
      return { state: "done", bytes, contentType: "video/mp4" };
    },
  };
}

// null => video is OFF (VIDEO_VENDOR unset): DREAM stays text-only, exactly the pre-G1 behavior.
export function videoVendorFor(env: Env): VideoVendor | null {
  if (env.VIDEO_VENDOR === "xai") return grokImagine(env);
  if (env.VIDEO_VENDOR === "silent") return silentImagine();
  return null;
}

// Reserve the video cap then submit the render. Returns the vendor request_id, or null if the cap is
// reached or the submission failed pre-acceptance (nothing billed -> reservation released, mirroring
// voice.ts's pre-200 release). A returned request_id means the vendor accepted the job and MAY bill, so
// from here on the reservation is kept regardless of the render's eventual outcome.
export async function startRender(env: Env, vendor: VideoVendor, prompt: string): Promise<string | null> {
  if (!(await underCap(env.DB, "video"))) return null;
  const day = dayKey();
  if (!(await reserveEstimate(env.DB, "video", CLIP_USD, day))) return null;
  try {
    return await vendor.start(prompt);
  } catch {
    await recordSpend(env.DB, "video", -CLIP_USD, day); // pre-acceptance failure: release
    return null;
  }
}
