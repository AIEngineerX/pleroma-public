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

  it("uses only the explicitly dispatched organ, intensity, and pipeline", () => {
    const activity = new SwarmActivity();
    activity.dispatch({ organ: "EYE", intensity: 0.35, pipeline: "none" });
    expect(activity.snapshot(1).activity[0]).toBeCloseTo(0.35);
    expect(activity.snapshot(1).pipelineLinks).toEqual([0, 0]);

    activity.dispatch({ organ: "KEEP", intensity: 0.6, pipeline: "keep-tongue" });
    expect(activity.snapshot(1).activity[1]).toBeCloseTo(0.6);
    expect(activity.snapshot(1).pipelineLinks[0]).toBe(0);
    expect(activity.snapshot(1).pipelineLinks[1]).toBeCloseTo(0.6);

    activity.dispatch({ organ: "DREAM", intensity: 0.8, pipeline: "none" });
    expect(activity.snapshot(1).pipelineLinks[0]).toBe(0);
    expect(activity.snapshot(1).pipelineLinks[1]).toBeCloseTo(0.6);
  });

  it("reserves rubric flare for a genuine TONGUE utterance", () => {
    const activity = new SwarmActivity();
    activity.dispatch({ organ: "TONGUE", intensity: 1, pipeline: "none" });
    expect(activity.snapshot(0).tongueRubric).toBe(0);
    activity.dispatch({ organ: "TONGUE", intensity: 1, pipeline: "none", rubric: true });
    expect(activity.snapshot(0).tongueRubric).toBe(1);
    activity.dispatch({ organ: "EYE", intensity: 1, pipeline: "none", rubric: true });
    expect(activity.snapshot(0).tongueRubric).toBe(1);
  });

  it("keeps unknown PULSE at zero without inventing starving pigment", () => {
    const activity = new SwarmActivity();
    activity.setVitals({ kind: "unknown" });
    expect(activity.snapshot(1)).toMatchObject({
      pulseBeat: 0,
      pulseBpm: 0,
      pulsePressure: 0,
      pulsePigment: null,
    });
  });

  it("eases a stale beat to stillness, retains pigment, and resumes on newer current vitals", () => {
    const activity = new SwarmActivity();
    const fed = { state: "fed", buys: 8, sells: 2, holders: 24 } as const;
    activity.setVitals({ kind: "current", value: fed, receivedAt: 1 });
    const current = activity.snapshot(0.5);
    expect(current.pulseBeat).toBeGreaterThan(0);
    expect(current.pulsePressure).toBeGreaterThan(0);
    expect(current.pulsePigment).toBe("fed");

    activity.setVitals({ kind: "stale", value: fed, staleAt: 2 });
    activity.advance(0.25);
    const firstStale = activity.snapshot(0.75);
    activity.advance(1);
    const laterStale = activity.snapshot(1.75);
    expect(firstStale.pulsePigment).toBe(current.pulsePigment);
    expect(laterStale.pulsePigment).toBe(current.pulsePigment);
    expect(laterStale.pulseBeat).toBeLessThan(firstStale.pulseBeat);
    expect(laterStale.pulsePressure).toBeLessThan(firstStale.pulsePressure);

    activity.setVitals({
      kind: "current",
      value: { state: "feasting", buys: 12, sells: 3, holders: 40 },
      receivedAt: 3,
    });
    const resumed = activity.snapshot(0.5);
    expect(resumed.pulseBeat).toBeGreaterThan(laterStale.pulseBeat);
    expect(resumed.pulsePressure).toBeGreaterThan(laterStale.pulsePressure);
    expect(resumed.pulsePigment).toBe("feasting");
  });

  it("keeps the PULSE envelope continuous when a beat cycle wraps", () => {
    const activity = new SwarmActivity();
    activity.setVitals({
      kind: "current",
      value: { state: "starving", buys: 0, sells: 0, holders: 0 },
      receivedAt: 1,
    });
    const period = 60 / activity.snapshot(0).pulseBpm;
    const beforeWrap = activity.snapshot(period - 0.001).pulseBeat;
    const afterWrap = activity.snapshot(period + 0.001).pulseBeat;
    expect(Math.abs(beforeWrap - afterWrap)).toBeLessThan(0.001);
  });

  it("decays quickening and capillary impulses without snapping", () => {
    const activity = new SwarmActivity();
    activity.dispatch({ organ: "EYE", intensity: 1, pipeline: "eye-keep" });
    activity.advance(0.25);
    const after = activity.snapshot(0);
    expect(after.activity[0]).toBeGreaterThan(0);
    expect(after.activity[0]).toBeLessThan(1);
    expect(after.pipelineLinks[0]).toBeGreaterThan(0);
  });
});
