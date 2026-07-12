import { describe, expect, it, vi } from "vitest";
import { pickTier, simResFor } from "../src/stain/stainSim";

describe("Stain quality tiers", () => {
  it("returns reduced when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion"), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(pickTier()).toBe("reduced");
    expect(simResFor("reduced")).toBe(0); // no sim
  });
  it("uses a cheaper sim resolution on mobile than desktop", () => {
    expect(simResFor("mobile")).toBeLessThan(simResFor("desktop"));
    expect(simResFor("desktop")).toBe(512);
    expect(simResFor("mobile")).toBe(256);
  });
});
