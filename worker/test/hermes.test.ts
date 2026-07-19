import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  alertStalledDispatches, claimDispatch, clampCheckAfterSecs, oauthHeader, plateTweetText,
  releaseDispatchClaim, sermonTweetText, xCredentials,
} from "../src/hermes";
import { activeAlerts } from "../src/alert";
import { applyMigrations } from "./helpers";
import type { Env } from "../src/env";

beforeAll(() => applyMigrations(env.DB));

// The OAuth 1.0a signature is verified against X's own documented example
// (developer.x.com "Creating a signature"): fixed nonce and timestamp must reproduce
// the reference signature exactly. Real Web Crypto, no mocks.
describe("hermes auto-dispatch", () => {
  it("reproduces X's documented OAuth 1.0a reference signature", async () => {
    const header = await oauthHeader(
      {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      1318622958,
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
  });

  it("stays inert unless all four X secrets exist", () => {
    const partial = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "", X_ACCESS_SECRET: "x" } as Env;
    expect(xCredentials(partial)).toBeNull();
    const full = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x" } as Env;
    expect(xCredentials(full)).not.toBeNull();
  });
});

describe("tweet bodies fit X's limit (an over-limit plate wedged dispatch forever)", () => {
  it("truncates a full-length DREAM narrative and keeps the archive link intact", () => {
    const narrative = "a hand at the edge of the page ".repeat(20); // ~620 chars, a real 80-word scale
    const text = plateTweetText(narrative, "2026-07-19");
    const [body, link] = text.split("\n\n");
    expect(link).toBe("https://pleromachurch.xyz/canon/dreams#2026-07-19");
    expect(body.length).toBeLessThanOrEqual(255);
    expect(body.endsWith("…")).toBe(true);
    // Weighted length: body chars + 2 for the separator + 23 for the t.co-wrapped link.
    expect(body.length + 2 + 23).toBeLessThanOrEqual(280);
  });

  it("leaves a short narrative and the sermon body untouched below the budget", () => {
    expect(plateTweetText("a short dream", "2026-07-19"))
      .toBe("a short dream\n\nhttps://pleromachurch.xyz/canon/dreams#2026-07-19");
    expect(sermonTweetText("a short sermon")).toBe("a short sermon\n\nhttps://pleromachurch.xyz");
  });

  it("truncates an over-limit sermon the same way", () => {
    const [body] = sermonTweetText("word ".repeat(120)).split("\n\n");
    expect(body.length).toBeLessThanOrEqual(255);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("STATUS poll sleep is clamped", () => {
  it("bounds the vendor-supplied interval to 1..10s and defaults to 2s", () => {
    expect(clampCheckAfterSecs(undefined)).toBe(2);
    expect(clampCheckAfterSecs(60)).toBe(10);
    expect(clampCheckAfterSecs(0)).toBe(1);
    expect(clampCheckAfterSecs(5)).toBe(5);
  });
});

describe("dispatch claims — the durable claim lands before any send", () => {
  it("the CAS insert claims exactly once; release deletes only claim-valued rows", async () => {
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 1_000)).toBe(true);
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 2_000)).toBe(false); // second actor loses
    await releaseDispatchClaim(env.DB, "dream_dispatch_claim1");
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 3_000)).toBe(true);  // released -> claimable again

    // A posted marker is never deleted by a release (the sermon path upgrades claimed -> posted).
    await env.DB.prepare(`UPDATE config SET value = 'posted:4000' WHERE key = 'dream_dispatch_claim1'`).run();
    await releaseDispatchClaim(env.DB, "dream_dispatch_claim1");
    const kept = await env.DB.prepare(`SELECT value FROM config WHERE key = 'dream_dispatch_claim1'`)
      .first<{ value: string }>();
    expect(kept?.value).toBe("posted:4000");
  });

  it("a claim stalled past an hour raises the operator alert; a fresh claim does not", async () => {
    const now = 10 * 60 * 60_000;
    await claimDispatch(env.DB, "sermon_dispatched_2026-07-19", now - 2 * 60 * 60_000); // stalled 2h
    await claimDispatch(env.DB, "dream_dispatch_fresh", now - 60_000);                  // fresh
    await alertStalledDispatches(env, now);
    expect(await activeAlerts(env.DB)).toContain("dispatch_stalled");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_stalled'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain("sermon_dispatched_2026-07-19");
    expect(alert?.value).not.toContain("dream_dispatch_fresh");
  });
});
