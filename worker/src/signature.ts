import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";

export function offeringMessage(sha256hex: string, nonce: string, expiresAtMs: number): string {
  return `PLEROMA offering ${sha256hex} nonce ${nonce} expires ${expiresAtMs}`;
}

export function verifyOffering(p: {
  wallet: string; sigB58: string; sha256hex: string; nonce: string; expiresAtMs: number;
}): boolean {
  if (p.expiresAtMs <= Date.now()) return false;
  try {
    const msg = new TextEncoder().encode(offeringMessage(p.sha256hex, p.nonce, p.expiresAtMs));
    return ed25519.verify(base58.decode(p.sigB58), msg, base58.decode(p.wallet));
  } catch {
    return false;
  }
}
