import { describe, expect, it } from "vitest";
import { links } from "../src/lib/links";

describe("market links (anti-decoy: only ever built from the passed mint)", () => {
  it("builds pump.fun, dexscreener, and X links from the mint", () => {
    const l = links("MintPubkey111");
    expect(l.pump).toBe("https://pump.fun/coin/MintPubkey111");
    expect(l.dexscreener).toContain("MintPubkey111");
    expect(l.dexEmbed).toContain("embed=1");
    expect(l.x).toBe("https://x.com/pleroma_church");
  });
  it("returns null money links when there is no mint yet (dormant)", () => {
    const l = links(null);
    expect(l.pump).toBeNull(); expect(l.dexscreener).toBeNull();
    expect(l.x).toBe("https://x.com/pleroma_church"); // socials exist pre-launch
  });
});
