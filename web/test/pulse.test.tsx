import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Pulse from "../src/pulse/Pulse";
import type { VitalsFeed } from "../src/experience/types";

function render(vitals: VitalsFeed): string {
  return renderToStaticMarkup(createElement(Pulse, { vitals }));
}

describe("Pulse — the always-visible home for PULSE, independent of the mint-gated market section", () => {
  it("prints DOCTRINE's own PULSE rubric line, not invented copy", () => {
    const html = render({ kind: "unknown" });
    // Sourced from DOCTRINE.md's Five Articles, the same text Canon.tsx quotes — not a new line.
    expect(html).toContain("My heart is a public number. To be watched is how I stay alive.");
  });

  it("never mentions buys, sells, holders, or a mint — that stays inside the gated market section", () => {
    const html = render({ kind: "current", value: { state: "feasting", buys: 40, sells: 3, holders: 120 }, receivedAt: 1 });
    expect(html.toLowerCase()).not.toContain("buys");
    expect(html.toLowerCase()).not.toContain("sells");
    expect(html.toLowerCase()).not.toContain("holders");
    expect(html.toLowerCase()).not.toContain("mint");
  });

  it("shows only a plain waiting line before the first vitals response, never a fabricated state", () => {
    const html = render({ kind: "unknown" });
    expect(html).toContain("The Pulse has not yet reported.");
    expect(html).not.toContain("bpm");
  });

  it("prints the qualitative state and its matching heartbeat rate once current", () => {
    const html = render({ kind: "current", value: { state: "fed", buys: 0, sells: 0, holders: 0 }, receivedAt: 1 });
    expect(html).toContain("FED");
    expect(html).toContain("54 bpm");
  });

  it("marks a stale reading as last-known rather than presenting it as fresh", () => {
    const stale = render({ kind: "stale", value: { state: "calm", buys: 0, sells: 0, holders: 0 }, staleAt: 1 });
    const current = render({ kind: "current", value: { state: "calm", buys: 0, sells: 0, holders: 0 }, receivedAt: 1 });
    expect(stale).toContain("last known");
    expect(stale).toContain("CALM");
    expect(stale).toContain("36 bpm");
    expect(current).not.toContain("last known");
  });

  it("beats the heart at the real bpm — not a generic wobble, the actual current rate", () => {
    const fed = render({ kind: "current", value: { state: "fed", buys: 0, sells: 0, holders: 0 }, receivedAt: 1 });
    expect(fed).toContain("data-pulse-heart");
    // fed = 54 bpm -> 60/54 = 1.111s per beat.
    expect(fed).toContain("--pulse-duration:1.111s");
  });

  it("tints the beating heart with the same pigment law the ink itself uses, not an arbitrary color", () => {
    const starving = render({ kind: "current", value: { state: "starving", buys: 0, sells: 0, holders: 0 }, receivedAt: 1 });
    const feasting = render({ kind: "current", value: { state: "feasting", buys: 0, sells: 0, holders: 0 }, receivedAt: 1 });
    // Exact values from state/pigment.ts's MAP — same source Stain.tsx reads for the body's own ink.
    expect(starving).toContain("oklch(0.45 0.09 45)");
    expect(feasting).toContain("oklch(0.55 0.20 32)");
  });

  it("never animates or beats a heart before the first vitals response", () => {
    const html = render({ kind: "unknown" });
    expect(html).not.toContain("data-pulse-heart");
  });
});
