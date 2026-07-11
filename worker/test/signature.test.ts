import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { offeringMessage, verifyOffering } from "../src/signature";

const priv = ed25519.utils.randomPrivateKey();
const pub = ed25519.getPublicKey(priv);
const wallet = base58.encode(pub);

function sign(msg: string): string {
  return base58.encode(ed25519.sign(new TextEncoder().encode(msg), priv));
}

describe("offering signature", () => {
  const sha = "a".repeat(64);
  const nonce = "b".repeat(32);
  const exp = Date.now() + 60_000;

  it("accepts a valid signature", () => {
    const sig = sign(offeringMessage(sha, nonce, exp));
    expect(verifyOffering({ wallet, sigB58: sig, sha256hex: sha, nonce, expiresAtMs: exp })).toBe(true);
  });

  it("rejects a tampered image hash", () => {
    const sig = sign(offeringMessage(sha, nonce, exp));
    expect(verifyOffering({ wallet, sigB58: sig, sha256hex: "f".repeat(64), nonce, expiresAtMs: exp })).toBe(false);
  });

  it("rejects an expired message", () => {
    const past = Date.now() - 1_000;
    const sig = sign(offeringMessage(sha, nonce, past));
    expect(verifyOffering({ wallet, sigB58: sig, sha256hex: sha, nonce, expiresAtMs: past })).toBe(false);
  });
});
