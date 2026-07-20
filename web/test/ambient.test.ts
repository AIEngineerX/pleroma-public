// Task 5 (grown-lineage-marks §3b.6): the invariant this project is built around -- "audio is
// silent until deliberate entry or sound-control activation" -- now extends to the paper-fiber
// grain. No DOM/jsdom is configured in this project (see thresholdOffering.growth.test.ts for the
// same note), so there is no real AudioContext to construct here. Ambient's own constructor only
// ever touches ctx.createGain and ctx.createAnalyser unconditionally; playGrain additionally needs
// createBuffer/createBufferSource/createBiquadFilter. A minimal stand-in implementing exactly that
// surface -- counting the grain-only calls rather than throwing -- lets these tests drive Ambient's
// REAL gate state (isActive(), started/muted/disposed are all real fields on a real instance) with
// no mocking of Ambient's own logic; only the unavailable browser primitive is substituted.
import { describe, expect, it } from "vitest";
import { Ambient } from "../src/lib/ambient";

function fakeGainNode() {
  return { gain: { value: 0 }, connect: () => undefined, disconnect: () => undefined };
}
function fakeAnalyserNode() {
  return {
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: () => undefined,
    disconnect: () => undefined,
    getByteTimeDomainData: () => undefined,
  };
}

class CountingCtx {
  calls = { createBuffer: 0, createBufferSource: 0, createBiquadFilter: 0 };
  sampleRate = 44_100;
  currentTime = 0;
  createGain() { return fakeGainNode(); }
  createAnalyser() { return fakeAnalyserNode(); }
  createBuffer() {
    this.calls.createBuffer += 1;
    return { getChannelData: () => new Float32Array(1) };
  }
  createBufferSource() {
    this.calls.createBufferSource += 1;
    return { buffer: null, connect: () => undefined, start: () => undefined, stop: () => undefined };
  }
  createBiquadFilter() {
    this.calls.createBiquadFilter += 1;
    return { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect: () => undefined };
  }
}

describe("Ambient.playGrain -- the invariant test: gate closed means zero audio API calls", () => {
  it("a freshly constructed instance (never started -- the real, default gate-closed state) touches no grain audio API on playGrain()", () => {
    const ctx = new CountingCtx();
    const ambient = new Ambient(ctx as unknown as AudioContext);

    expect(ambient.isActive()).toBe(false); // real gate state, driven directly -- no start() called
    ambient.playGrain();

    expect(ctx.calls).toEqual({ createBuffer: 0, createBufferSource: 0, createBiquadFilter: 0 });
  });

  it("with no AudioContext at all (ctx === null, the real no-Web-Audio-support path), playGrain() is a genuine no-op", () => {
    const ambient = new Ambient(null);

    expect(ambient.isActive()).toBe(false);
    expect(() => ambient.playGrain()).not.toThrow();
  });

  it("muted (even while never started) still reads as gate-closed via the same real isActive() the engine consults", () => {
    const ctx = new CountingCtx();
    const ambient = new Ambient(ctx as unknown as AudioContext);

    ambient.toggleMute(); // flips the real `muted` field; safe to call before start()
    expect(ambient.isActive()).toBe(false);
    ambient.playGrain();

    expect(ctx.calls).toEqual({ createBuffer: 0, createBufferSource: 0, createBiquadFilter: 0 });
  });

  it("disposed also reads as gate-closed", () => {
    const ctx = new CountingCtx();
    const ambient = new Ambient(ctx as unknown as AudioContext);

    ambient.dispose();
    expect(ambient.isActive()).toBe(false);
    ambient.playGrain();

    expect(ctx.calls).toEqual({ createBuffer: 0, createBufferSource: 0, createBiquadFilter: 0 });
  });
});
