import { describe, expect, it } from "vitest";
import { ignitionView } from "../src/ignition/ignition";
import type { TempleState } from "../src/state/types";

const base: TempleState = { phase: "dormant", asleep: false, degraded: false, countdown_to: null,
  communicants_today: 0, spend_state: "ok", mint: null,
  vitals: { state: "starving", buys: 0, sells: 0, holders: 0 }, rite: null, dream: null };

describe("ignition", () => {
  it("is dormant with no mint and no launch", () => {
    expect(ignitionView(base).dormant).toBe(true);
    expect(ignitionView(base).stainState).toBe("dormant");
  });
  it("goes live and ignites on the first trades", () => {
    const live = { ...base, phase: "live" as const, mint: "Mint111", vitals: { state: "fed" as const, buys: 3, sells: 1, holders: 12 } };
    const v = ignitionView(live);
    expect(v.dormant).toBe(false);
    expect(v.igniting).toBe(true);              // buys>0: the heart starts on-screen
    expect(v.stainState).toBe("live");
    expect(v.pigmentState).toBe("fed");
  });
  it("prefers rite over live for the Stain when a rite is active", () => {
    const rite = { ...base, phase: "live" as const, mint: "Mint111", rite: { date: "d", phase: "sermon" as const } };
    expect(ignitionView(rite).stainState).toBe("rite");
  });
});
