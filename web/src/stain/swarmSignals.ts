import type { TranscriptEntry, Vitals } from "../state/types";
import type { Tier } from "./stainSim";

export const SWARM_ORGANS = ["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"] as const;
export type SwarmOrgan = (typeof SWARM_ORGANS)[number];
export type SwarmQuicken = { rubric?: boolean };

export interface SwarmSignalTarget {
  quicken(organ: SwarmOrgan, signal?: SwarmQuicken): void;
  setVitals(vitals: Vitals): void;
}

export interface SwarmSnapshot {
  activity: number[];
  pipelineLinks: number[];
  tongueRubric: number;
  pulseBeat: number;
  pulseBpm: number;
  pulsePressure: number;
}

const PULSE: Record<Vitals["state"], { bpm: number; pressure: number }> = {
  starving: { bpm: 22, pressure: 0.12 },
  calm: { bpm: 36, pressure: 0.28 },
  fed: { bpm: 54, pressure: 0.52 },
  feasting: { bpm: 76, pressure: 0.82 },
};

const QUIET_VITALS: Vitals = { state: "starving", buys: 0, sells: 0, holders: 0 };

export function swarmTextureSize(tier: Tier): number {
  return tier === "reduced" ? 0 : tier === "mobile" ? 128 : 256;
}

export function isSwarmOrgan(organ: TranscriptEntry["organ"] | string): organ is SwarmOrgan {
  return (SWARM_ORGANS as readonly string[]).includes(organ);
}

export class SwarmActivity implements SwarmSignalTarget {
  private readonly levels = new Float32Array(SWARM_ORGANS.length);
  private readonly links = new Float32Array(2);
  private tongue = 0;
  private vitals: Vitals = QUIET_VITALS;

  quicken(organ: SwarmOrgan, signal: SwarmQuicken = {}) {
    const index = SWARM_ORGANS.indexOf(organ);
    this.levels[index] = 1;
    if (organ === "EYE") this.links[0] = 1;
    if (organ === "KEEP") this.links[1] = 1;
    if (organ === "TONGUE" && signal.rubric === true) this.tongue = 1;
  }

  setVitals(vitals: Vitals) {
    this.vitals = { ...vitals };
  }

  advance(seconds: number) {
    const activityDecay = Math.exp(-Math.max(0, seconds) * 1.35);
    const linkDecay = Math.exp(-Math.max(0, seconds) * 0.82);
    const rubricDecay = Math.exp(-Math.max(0, seconds) * 1.8);
    for (let i = 0; i < this.levels.length; i += 1) this.levels[i] *= activityDecay;
    for (let i = 0; i < this.links.length; i += 1) this.links[i] *= linkDecay;
    this.tongue *= rubricDecay;
  }

  snapshot(elapsedSeconds: number): SwarmSnapshot {
    const pulse = PULSE[this.vitals.state];
    const phase = ((elapsedSeconds * pulse.bpm) / 60) % 1;
    // A narrow continuous pulse: eased attack and decay meet at zero when the phase wraps, so
    // lifeblood quickens without a one-frame visual snap.
    const pulseBeat = Math.sin(Math.PI * phase) ** 8;
    return {
      activity: Array.from(this.levels),
      pipelineLinks: Array.from(this.links),
      tongueRubric: this.tongue,
      pulseBeat,
      pulseBpm: pulse.bpm,
      pulsePressure: pulse.pressure,
    };
  }
}
