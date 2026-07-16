import { factory } from "ulid";

// workerd has no `window`, so ulid's own PRNG detection misses the global Web Crypto and falls
// back to require("crypto").randomBytes, which workerd does not provide — every ulid() call then
// throws (fatal on each scheduled tick). Inject the Web Crypto source explicitly instead.
function secureRandom(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 256;
}

export const ulid = factory(secureRandom);
