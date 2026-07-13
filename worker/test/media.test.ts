import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertOffering } from "../src/db";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

// Real 26-char Crockford ULIDs (alphabet 0-9 A-H J K M N P-T V-Z) so they clear serveOfferingImage's
// /^[0-9A-HJKMNP-TV-Z]{26}$/ gate; a 6-char stub would 400 on the id check and the test could never go green.
const KEPT = "01JZKEPT000000000000000000";        // 26 chars, status kept   -> served
const PERC = "01JZPERC000000000000000000";        // 26 chars, status perceived -> NOT served (kept-only)
const PEND = "01JZPEND000000000000000000";        // 26 chars, status pending -> NOT served

// The Workers vitest pool undoes storage writes after each test file by popping an isolated-storage
// stack frame, which fails ("unable to pop R2 storage") if a fetched response body was never consumed
// (see developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage).
// Every assertion below only needs the status, but the body still has to be drained.
async function status(res: Promise<Response>): Promise<number> {
  const r = await res;
  await r.arrayBuffer();
  return r.status;
}

describe("media routes", () => {
  it("serves a kept offering image and 404s perceived, pending, and unknown ids (kept-only gate)", async () => {
    await env.RELICS.put(`offerings/${KEPT}`, PNG, { httpMetadata: { contentType: "image/png" } });
    await insertOffering(env.DB, { id: KEPT, wallet: null, sig: null, image_key: `offerings/${KEPT}`,
      sha256: "01kept", status: "kept", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.RELICS.put(`offerings/${PERC}`, PNG, { httpMetadata: { contentType: "image/png" } });
    await insertOffering(env.DB, { id: PERC, wallet: null, sig: null, image_key: `offerings/${PERC}`,
      sha256: "01perc", status: "perceived", attempts: 0, created_at: Date.now(), perceived_at: Date.now() });
    await env.RELICS.put(`offerings/${PEND}`, PNG, { httpMetadata: { contentType: "image/png" } });
    await insertOffering(env.DB, { id: PEND, wallet: null, sig: null, image_key: `offerings/${PEND}`,
      sha256: "01pend", status: "pending", attempts: 0, created_at: Date.now(), perceived_at: null });

    expect(await status(SELF.fetch(`http://x/api/img/${KEPT}`))).toBe(200);
    const kept = await SELF.fetch(`http://x/api/img/${KEPT}`);
    expect(kept.headers.get("x-content-type-options")).toBe("nosniff"); // boundary: the browser must not MIME-sniff served bytes
    await kept.arrayBuffer(); // drain the body (isolated-storage teardown)
    expect(await status(SELF.fetch(`http://x/api/img/${PERC}`))).toBe(404); // pre-verdict: kept-only never serves it
    expect(await status(SELF.fetch(`http://x/api/img/${PEND}`))).toBe(404); // un-moderated never served
    expect(await status(SELF.fetch("http://x/api/img/not-a-ulid"))).toBe(400);
  });

  it("serves a rendered dream video and 404s a rendering one (rendered-only gate)", async () => {
    // 26-char Crockford ULIDs (no I/L/O/U) so they clear serveDreamVideo's /dream\/[ULID]\.mp4/ gate.
    const REND = "01JZDVKA000000000000000000";   // status rendered  -> served
    const RING = "01JZDVKB000000000000000000";   // status rendering -> NOT served
    const MP4 = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp box start
    const insertDream = (id: string, status: string, videoKey: string | null) => env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES (?1, ?2, 'n', 'p', '[]', ?3, ?4, ?5)`
    ).bind(id, `d-${id.slice(0, 8)}`, status, videoKey, Date.now()).run();

    await env.RELICS.put(`dream/${REND}.mp4`, MP4, { httpMetadata: { contentType: "video/mp4" } });
    await insertDream(REND, "rendered", `dream/${REND}.mp4`);
    await insertDream(RING, "rendering", null);

    expect(await status(SELF.fetch(`http://x/api/dream/${REND}.mp4`))).toBe(200);
    const ok = await SELF.fetch(`http://x/api/dream/${REND}.mp4`);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    await ok.arrayBuffer(); // drain (isolated-storage teardown)
    expect(await status(SELF.fetch(`http://x/api/dream/${RING}.mp4`))).toBe(404); // not rendered -> never serves
    expect(await status(SELF.fetch(`http://x/api/dream/${REND}.txt`))).toBe(400); // bad key (wrong extension)
  });

  it("serves audio only from the audio/ content-addressed prefix", async () => {
    const key = "audio/" + "a".repeat(64) + ".mp3";
    await env.RELICS.put(key, PNG, { httpMetadata: { contentType: "audio/mpeg" } });
    expect(await status(SELF.fetch(`http://x/api/${key}`))).toBe(200);
    // A literal "../" never reaches the handler (WHATWG URL parsing normalizes it before routing -> Hono 404),
    // so the control we assert here is the AUDIO_KEY regex itself: a well-formed path whose derived key is bad
    // (right length hash, WRONG extension) reaches serveAudio and is rejected 400.
    expect(await status(SELF.fetch(`http://x/api/audio/${"a".repeat(64)}.txt`))).toBe(400);
    expect(await status(SELF.fetch(`http://x/api/audio/${"b".repeat(64)}.mp3`))).toBe(404); // valid key, no object
  });
});
