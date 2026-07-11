import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const ogPath = resolve(here, "..", "public", "og.png");

function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(pngSignature)) throw new Error("not a PNG file");
  // IHDR is always the first chunk, immediately after the signature: 4-byte length,
  // 4-byte type "IHDR", then width (4 bytes) and height (4 bytes), big-endian.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

describe("web/public/og.png", () => {
  it("exists so /og.png resolves instead of 404ing on every link preview", () => {
    expect(existsSync(ogPath)).toBe(true);
  });

  it("is a valid 1200x630 PNG (the standard OG card size)", () => {
    const bytes = readFileSync(ogPath);
    const { width, height } = readPngDimensions(bytes);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });
});
