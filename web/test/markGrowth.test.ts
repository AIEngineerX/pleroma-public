import { describe, expect, it } from "vitest";
import { growMark, startGrowth, stepGrowth, topologyMetrics } from "../src/experience/markGrowth";
import type { ImprintGesture } from "../src/experience/thresholdImprint";
import { IMPRINT_SIZE } from "../src/experience/thresholdImprint";

const seed = new Uint32Array([1, 2, 3, 4]);
const tremorA = Array.from({ length: 40 }, (_, i) => ({ x: Math.sin(i / 3) * 1.2, y: Math.cos(i / 5) * 0.8, t: i * 16 }));
const tremorB = Array.from({ length: 40 }, (_, i) => ({ x: Math.sin(i / 7) * 0.4, y: Math.sin(i / 2) * 1.5, t: i * 16 }));
const hold = (tremor: typeof tremorA): ImprintGesture => ({
  seed, start: { x: 256, y: 256 }, end: { x: 300, y: 240 },
  holdMs: 1200, pressure: 0.5, pressureReal: false, tremor,
});

describe("growth is deterministic and gesture-sensitive", () => {
  it("same gesture + same substrate → identical paths", () => {
    expect(growMark(hold(tremorA), [])).toEqual(growMark(hold(tremorA), []));
  });
  it("different tremor → structurally different organism", () => {
    const a = topologyMetrics(growMark(hold(tremorA), []));
    const b = topologyMetrics(growMark(hold(tremorB), []));
    expect(a.branches === b.branches && a.endpoints === b.endpoints && Math.abs(a.span - b.span) < 1).toBe(false);
  });
  it("a longer hold grows a larger organism", () => {
    const short = topologyMetrics(growMark({ ...hold(tremorA), holdMs: 250 }, []));
    const long = topologyMetrics(growMark({ ...hold(tremorA), holdMs: 1550 }, []));
    expect(long.endpoints + long.branches).toBeGreaterThan(short.endpoints + short.branches);
  });
  it("substrate bends growth: same gesture, different substrate → different topology", () => {
    const subA = [{ x: 120, y: 120, angle: 0 }, { x: 400, y: 380, angle: 1.2 }];
    const subB = [{ x: 380, y: 140, angle: 2.4 }, { x: 130, y: 400, angle: 0.6 }];
    const a = topologyMetrics(growMark(hold(tremorA), subA));
    const b = topologyMetrics(growMark(hold(tremorA), subB));
    expect(a).not.toEqual(b);
  });
  it("knock beats force splits", () => {
    const presses = [{ downMs: 0, upMs: 90 }, { downMs: 300, upMs: 380 }, { downMs: 700, upMs: 800 }, { downMs: 1000, upMs: 1090 }];
    const withKnock = topologyMetrics(growMark({ ...hold(tremorA), holdMs: 1090 }, [], presses));
    const without = topologyMetrics(growMark({ ...hold(tremorA), holdMs: 1090 }, []));
    expect(withKnock.branches).toBeGreaterThan(without.branches);
  });
  it("stays renderable and bounded", () => {
    const paths = growMark({ ...hold(tremorA), holdMs: 5000 }, []);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths.length).toBeLessThanOrEqual(48);
    expect(paths.reduce((n, p) => n + p.points.length, 0)).toBeLessThanOrEqual(600);
    for (const p of paths) for (const pt of p.points) {
      expect(pt.x).toBeGreaterThanOrEqual(0); expect(pt.x).toBeLessThanOrEqual(IMPRINT_SIZE);
      expect(pt.y).toBeGreaterThanOrEqual(0); expect(pt.y).toBeLessThanOrEqual(IMPRINT_SIZE);
    }
  });
  it("stepGrowth converges to growMark and is stable past done", () => {
    let s = startGrowth(hold(tremorA), []);
    while (!s.done) s = stepGrowth(s, 5);
    expect(s.segments).toEqual(growMark(hold(tremorA), []));
    expect(stepGrowth(s, 10).segments).toEqual(s.segments);
  });
  it("never emits a path the renderer would reject (knock press at release)", () => {
    // A final press landing at holdMs clamps its pulse to the last step: the forked child
    // cannot advance. The mark must still be fully renderable (every path >= 2 points).
    const presses = [{ downMs: 0, upMs: 80 }, { downMs: 400, upMs: 470 }, { downMs: 1200, upMs: 1200 }];
    const paths = growMark({ ...hold(tremorA), holdMs: 1200 }, [], presses);
    for (const p of paths) expect(p.points.length).toBeGreaterThanOrEqual(2);
  });

  it("stepGrowth on a tremorless gesture is repeatable from the same state (pure)", () => {
    const bare: ImprintGesture = { seed, start: { x: 256, y: 256 }, end: { x: 300, y: 240 }, holdMs: 900, pressure: 0.5, pressureReal: false };
    const s0 = startGrowth(bare, []);
    const a = stepGrowth(s0, 6);
    const b = stepGrowth(s0, 6); // same input state, same result — no shared mutable PRNG
    expect(a.segments).toEqual(b.segments);
    expect(a.tips ?? null).toEqual(b.tips ?? null);
  });
});
