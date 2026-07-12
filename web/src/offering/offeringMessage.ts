export async function sha256hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// MUST stay byte-identical to worker/src/signature.ts:offeringMessage — the signature is over these exact bytes.
export function offeringMessage(sha256hexStr: string, nonce: string, expiresAtMs: number): string {
  return `PLEROMA offering ${sha256hexStr} nonce ${nonce} expires ${expiresAtMs}`;
}
