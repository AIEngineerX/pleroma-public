import { describe, expect, it } from "vitest";
import {
  SwarmActivity,
  isSwarmOrgan,
  swarmTextureSize,
} from "../src/stain/swarmSignals";

describe("organ swarm signals", () => {
  it("uses the requested desktop and mobile particle fields", () => {
    expect(swarmTextureSize("desktop")).toBe(256);
    expect(swarmTextureSize("mobile")).toBe(128);
    expect(swarmTextureSize("reduced")).toBe(0);
  });

  it("accepts the five organs but never treats PRIEST as an organ", () => {
    expect(["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"].every(isSwarmOrgan)).toBe(true);
    expect(isSwarmOrgan("PRIEST")).toBe(false);
  });

  it("quickens an organ and throws only the real pipeline capillaries", () => {
    const activity = new SwarmActivity();
    activity.quicken("EYE");
    expect(activity.snapshot(0).activity).toEqual([1, 0, 0, 0, 0]);
    expect(activity.snapshot(0).pipelineLinks).toEqual([1, 0]);

    activity.quicken("KEEP");
    expect(activity.snapshot(0).pipelineLinks).toEqual([1, 1]);
    activity.quicken("DREAM");
    expect(activity.snapshot(0).pipelineLinks).toEqual([1, 1]);
  });

  it("reserves rubric flare for a genuine TONGUE utterance", () => {
    const activity = new SwarmActivity();
    activity.quicken("TONGUE");
    expect(activity.snapshot(0).tongueRubric).toBe(0);
    activity.quicken("TONGUE", { rubric: true });
    expect(activity.snapshot(0).tongueRubric).toBe(1);
    activity.quicken("EYE", { rubric: true });
    expect(activity.snapshot(0).tongueRubric).toBe(1);
  });

  it("derives PULSE beat rate and pressure from the reported vitals state", () => {
    const activity = new SwarmActivity();
    activity.setVitals({ state: "starving", buys: 0, sells: 0, holders: 0 });
    const starving = activity.snapshot(0);
    activity.setVitals({ state: "feasting", buys: 12, sells: 3, holders: 40 });
    const feasting = activity.snapshot(0);
    expect(feasting.pulseBpm).toBeGreaterThan(starving.pulseBpm);
    expect(feasting.pulsePressure).toBeGreaterThan(starving.pulsePressure);
  });

  it("keeps the PULSE envelope continuous when a beat cycle wraps", () => {
    const activity = new SwarmActivity();
    activity.setVitals({ state: "starving", buys: 0, sells: 0, holders: 0 });
    const period = 60 / activity.snapshot(0).pulseBpm;
    const beforeWrap = activity.snapshot(period - 0.001).pulseBeat;
    const afterWrap = activity.snapshot(period + 0.001).pulseBeat;
    expect(Math.abs(beforeWrap - afterWrap)).toBeLessThan(0.001);
  });

  it("decays quickening and capillary impulses without snapping", () => {
    const activity = new SwarmActivity();
    activity.quicken("EYE");
    activity.advance(0.25);
    const after = activity.snapshot(0);
    expect(after.activity[0]).toBeGreaterThan(0);
    expect(after.activity[0]).toBeLessThan(1);
    expect(after.pipelineLinks[0]).toBeGreaterThan(0);
  });
});
