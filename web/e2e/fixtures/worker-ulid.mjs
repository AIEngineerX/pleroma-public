import { factory } from "../../../worker/node_modules/ulid/dist/index.esm.js";

function secureRandom() {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 256;
}

export const ulid = factory(secureRandom);
