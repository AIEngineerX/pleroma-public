import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { sha256hex, offeringMessage } from "../src/offering/offeringMessage";

describe("offering signature bytes match the Worker", () => {
  it("produces a message a wallet signs and the Worker's ed25519 verify accepts", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const sha = await sha256hex(bytes);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const nonce = "b".repeat(32); const exp = Date.now() + 60_000;
    const msg = offeringMessage(sha, nonce, exp);
    expect(msg).toBe(`PLEROMA offering ${sha} nonce ${nonce} expires ${exp}`); // byte-identical contract

    const priv = ed25519.utils.randomPrivateKey();
    const wallet = base58.encode(ed25519.getPublicKey(priv));
    const sig = base58.encode(ed25519.sign(new TextEncoder().encode(msg), priv));
    // the Worker's verifyOffering does exactly this:
    expect(ed25519.verify(base58.decode(sig), new TextEncoder().encode(msg), base58.decode(wallet))).toBe(true);
  });

  it("computes the same sha256 the Worker computes (WebCrypto)", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const d = await crypto.subtle.digest("SHA-256", bytes);
    const expected = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
    expect(await sha256hex(bytes)).toBe(expected);
  });
});
