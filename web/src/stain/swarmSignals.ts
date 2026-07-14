import type { VitalsFeed } from "../experience/types";
import type { PulseState } from "../state/types";
import type { BodyOrgan, BodySignal } from "./bodyRenderer";
import type { Tier } from "./stainSim";

export const SWARM_ORGANS = ["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"] as const;
export type SwarmOrgan = (typeof SWARM_ORGANS)[number];

export interface SwarmSnapshot {
  activity: number[];
  pipelineLinks: number[];
  tongueRubric: number;
  pulseBeat: number;
  pulseBpm: number;
  pulsePressure: number;
  pulsePigment: PulseState | null;
}

const PULSE: Record<PulseState, { bpm: number; pressure: number }> = {
  starving: { bpm: 22, pressure: 0.12 },
  calm: { bpm: 36, pressure: 0.28 },
  fed: { bpm: 54, pressure: 0.52 },
  feasting: { bpm: 76, pressure: 0.82 },
};

export function swarmTextureSize(tier: Tier): number {
  return tier === "reduced" ? 0 : tier === "mobile" ? 128 : 256;
}

export function isSwarmOrgan(organ: string): organ is SwarmOrgan {
  return (SWARM_ORGANS as readonly string[]).includes(organ);
}

function copyFeed(feed: VitalsFeed): VitalsFeed {
  if (feed.kind === "unknown") return feed;
  return { ...feed, value: { ...feed.value } };
}

export class SwarmActivity {
  private readonly levels = new Float32Array(SWARM_ORGANS.length);
  private readonly links = new Float32Array(2);
  private tongue = 0;
  private vitals: VitalsFeed = { kind: "unknown" };
  private observedBeat = 0;
  private observedBpm = 0;
  private observedPressure = 0;
  private staleBeat = 0;
  private staleBpm = 0;
  private stalePressure = 0;

  dispatch(signal: BodySignal): void {
    const index = SWARM_ORGANS.indexOf(signal.organ as BodyOrgan);
    const intensity = Math.max(0, Math.min(1, signal.intensity));
    this.levels[index] = intensity;
    if (signal.pipeline === "eye-keep") this.links[0] = intensity;
    if (signal.pipeline === "keep-tongue") this.links[1] = intensity;
    if (signal.organ === "TONGUE" && signal.rubric === true) this.tongue = intensity;
  }

  setVitals(feed: VitalsFeed): void {
    if (feed.kind === "stale" && this.vitals.kind !== "stale") {
      this.staleBeat = this.observedBeat;
      this.staleBpm = this.observedBpm;
      this.stalePressure = this.observedPressure;
    }
    if (feed.kind === "unknown") {
      this.observedBeat = 0;
      this.observedBpm = 0;
      this.observedPressure = 0;
      this.staleBeat = 0;
      this.staleBpm = 0;
      this.stalePressure = 0;
    }
    this.vitals = copyFeed(feed);
  }

  advance(seconds: number): void {
    const elapsed = Math.max(0, seconds);
    const activityDecay = Math.exp(-elapsed * 1.35);
    const linkDecay = Math.exp(-elapsed * 0.82);
    const rubricDecay = Math.exp(-elapsed * 1.8);
    for (let i = 0; i < this.levels.length; i += 1) this.levels[i] *= activityDecay;
    for (let i = 0; i < this.links.length; i += 1) this.links[i] *= linkDecay;
    this.tongue *= rubricDecay;
    if (this.vitals.kind === "stale") {
      const pulseDecay = Math.exp(-elapsed * 1.4);
      this.staleBeat *= pulseDecay;
      this.staleBpm *= pulseDecay;
      this.stalePressure *= pulseDecay;
    }
  }

  snapshot(elapsedSeconds: number): SwarmSnapshot {
    let pulseBeat = 0;
    let pulseBpm = 0;
    let pulsePressure = 0;
    let pulsePigment: PulseState | null = null;

    if (this.vitals.kind === "current") {
      const pulse = PULSE[this.vitals.value.state];
      const phase = ((elapsedSeconds * pulse.bpm) / 60) % 1;
      pulseBeat = Math.sin(Math.PI * phase) ** 8;
      pulseBpm = pulse.bpm;
      pulsePressure = pulse.pressure;
      pulsePigment = this.vitals.value.state;
      this.observedBeat = pulseBeat;
      this.observedBpm = pulseBpm;
      this.observedPressure = pulsePressure;
    } else if (this.vitals.kind === "stale") {
      pulseBeat = this.staleBeat;
      pulseBpm = this.staleBpm;
      pulsePressure = this.stalePressure;
      pulsePigment = this.vitals.value.state;
    }

    return {
      activity: Array.from(this.levels),
      pipelineLinks: Array.from(this.links),
      tongueRubric: this.tongue,
      pulseBeat,
      pulseBpm,
      pulsePressure,
      pulsePigment,
    };
  }
}
