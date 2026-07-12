import { describe, expect, it } from "vitest";
import { isBlank } from "../src/offering/OfferingCanvas";

function fakeCanvas(nonBlank: boolean) {
  return { width: 4, height: 4, getContext: () => ({
    getImageData: () => ({ data: new Uint8ClampedArray(4 * 4 * 4).fill(nonBlank ? 200 : 0) }),
  }) } as unknown as HTMLCanvasElement;
}

describe("offering canvas guards", () => {
  it("treats a fully-transparent canvas as blank and a drawn one as not", () => {
    expect(isBlank(fakeCanvas(false))).toBe(true);
    expect(isBlank(fakeCanvas(true))).toBe(false);
  });
});
