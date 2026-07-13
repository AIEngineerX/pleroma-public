import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { grokImagine } from "../../src/imagine";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Verifies the real Grok Imagine text-to-video contract end to end: submit -> poll -> decoded mp4 bytes.
// Requires XAI_API_KEY with Grok Imagine (video) access in .dev.vars. Excluded from `npm run verify`
// (it hits the paid vendor and takes up to a few minutes); run via `npm run verify:live`.
describe("Grok Imagine video (live)", () => {
  it("renders a real clip from a text prompt alone", async () => {
    if (!env.XAI_API_KEY) { console.warn("XAI_API_KEY unset — skipping live Grok Imagine test"); return; }
    const vendor = grokImagine(env);
    const requestId = await vendor.start(
      "iron-gall ink figures rising off a burning illuminated manuscript, candlelit scriptorium, slow reverent drift"
    );
    expect(requestId).toBeTruthy();
    let bytes: Uint8Array | undefined;
    for (let i = 0; i < 36; i++) { // ~3 min ceiling
      const r = await vendor.poll(requestId);
      if (r.state === "done") { bytes = r.bytes; break; }
      if (r.state === "failed" || r.state === "expired") throw new Error(`render ${r.state}`);
      await sleep(5000);
    }
    expect(bytes && bytes.length).toBeGreaterThan(1000); // real mp4, not an empty/placeholder body
  }, 240_000);
});
