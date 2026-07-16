import { describe, expect, it } from "vitest";
import { oauthHeader, xCredentials } from "../src/hermes";
import type { Env } from "../src/env";

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
