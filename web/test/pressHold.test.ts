import { describe, expect, it } from "vitest";
import {
  createPressHold,
  ENTRY_HOLD_MS,
  ENTRY_HOLD_SLOP_PX,
  type PressPoint,
} from "../src/entry/pressHold";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const point = (overrides: Partial<PressPoint> = {}): PressPoint => ({
  pointerId: 1,
  x: 40,
  y: 60,
  eligible: true,
  ...overrides,
});

function setup(holdMs = 25) {
  const primed: PressPoint[] = [];
  const committed: PressPoint[] = [];
  const pending: Array<PressPoint | null> = [];
  const controller = createPressHold({
    holdMs,
    slopPx: ENTRY_HOLD_SLOP_PX,
    onPrime: (value) => primed.push(value),
    onPendingChange: (value) => pending.push(value),
    onCommit: (value) => committed.push(value),
  });
  return { controller, primed, committed, pending };
}

describe("press hold", () => {
  it("uses the required production timing constants", () => {
    expect(ENTRY_HOLD_MS).toBe(500);
    expect(ENTRY_HOLD_SLOP_PX).toBe(12);
  });

  it("primes without committing on pointer down", () => {
    const h = setup();
    expect(h.controller.down(point())).toBe(true);
    expect(h.primed).toHaveLength(1);
    expect(h.committed).toHaveLength(0);
    h.controller.dispose();
  });

  it("commits exactly once after an uninterrupted hold", async () => {
    const h = setup();
    h.controller.down(point());
    await wait(45);
    expect(h.committed).toHaveLength(1);
    await wait(35);
    expect(h.committed).toHaveLength(1);
    h.controller.dispose();
  });

  it("cancels when movement exceeds the slop", async () => {
    const h = setup();
    h.controller.down(point());
    h.controller.move(point({ x: 53 }));
    await wait(45);
    expect(h.committed).toHaveLength(0);
    expect(h.pending.at(-1)).toBeNull();
    h.controller.dispose();
  });

  it("cancels on scroll, early up, and pointer cancellation", async () => {
    for (const cancel of ["scroll", "up", "cancel"] as const) {
      const h = setup();
      h.controller.down(point());
      if (cancel === "scroll") h.controller.scroll();
      if (cancel === "up") h.controller.up(1);
      if (cancel === "cancel") h.controller.cancel(1);
      await wait(45);
      expect(h.committed, cancel).toHaveLength(0);
      h.controller.dispose();
    }
  });

  it("ignores ineligible downs and unrelated pointers", async () => {
    const h = setup();
    expect(h.controller.down(point({ eligible: false }))).toBe(false);
    h.controller.down(point());
    h.controller.up(2);
    await wait(45);
    expect(h.committed).toHaveLength(1);
    h.controller.dispose();
  });

  it("disposal clears pending work", async () => {
    const h = setup();
    h.controller.down(point());
    h.controller.dispose();
    await wait(45);
    expect(h.committed).toHaveLength(0);
  });
});
