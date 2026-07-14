import { factory } from "ulid";

function secureRandom(): number {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 256;
}

export const ulid = factory(secureRandom);
