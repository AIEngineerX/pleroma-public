import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import { BODY_ANCHORS, dedupeRelicSamples, signalForBodyCommand, type BodyOrgan } from "./bodyRenderer";

export interface SettledBodyProps {
  pigment: [number, number, number];
  command: BodyCommand | null;
  relicMemory: readonly RelicInkSample[];
  vitals: VitalsFeed;
  seraph: "five" | "converged";
  completedId?: string | null;
  completionCount?: number;
  initialPulseKind?: VitalsFeed["kind"];
  ambientBreath?: boolean;
}

const ORGAN_PATHS: Readonly<Record<BodyOrgan, string>> = {
  EYE: "M41 28 C45 23 55 23 60 28 C55 33 45 33 41 28 Z M47 28 A3 3 0 1 0 53 28 A3 3 0 1 0 47 28",
  KEEP: "M65 43 C70 39 76 43 74 49 C78 54 72 59 67 56 C62 59 60 51 63 48 C61 46 62 44 65 43 Z",
  TONGUE: "M61 69 C64 61 68 58 72 62 C75 66 70 75 65 79 C65 74 64 71 61 69 Z",
  PULSE: "M29 63 C33 58 40 59 42 65 C39 72 33 76 27 74 C31 71 31 67 29 63 Z",
  DREAM: "M27 45 C31 40 38 43 37 49 C40 54 35 58 30 55 C25 58 22 51 25 48 C23 47 24 45 27 45 Z",
};

const CAPILLARIES = [
  { name: "eye-keep", d: "M50 28 C61 31 69 39 70 43" },
  { name: "keep-tongue", d: "M70 43 C68 55 66 61 64 66" },
] as const;

export function SettledBody({
  pigment,
  command,
  relicMemory,
  vitals,
  seraph,
  completedId = null,
  completionCount = 0,
  initialPulseKind,
  ambientBreath = false,
}: SettledBodyProps) {
  const signal = command === null ? null : signalForBodyCommand(command);
  const rubric = `rgb(${pigment.map((channel) => Math.round(channel * 255)).join(" ")})`;
  const relics = dedupeRelicSamples(relicMemory);

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={`swarm-settled${ambientBreath ? " swarm-settled--breathing" : ""} absolute inset-0 z-0 h-full w-full pointer-events-none`}
      data-body-renderer="svg"
      data-active-organ={signal?.organ}
      data-pipeline={signal?.pipeline ?? "none"}
      data-command-id={command?.id}
      data-completed-id={completedId ?? undefined}
      data-completion-count={completionCount}
      data-seraph={seraph}
      data-pulse-kind={vitals.kind}
      data-initial-pulse-kind={initialPulseKind}
      data-initial-pulse-beat={initialPulseKind === "unknown" ? 0 : undefined}
      data-initial-pulse-bpm={initialPulseKind === "unknown" ? 0 : undefined}
      data-initial-pulse-pressure={initialPulseKind === "unknown" ? 0 : undefined}
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.18" opacity="0.28">
        <path d="M50 28 C61 31 69 39 70 43" />
        <path d="M70 43 C68 55 66 61 64 66" />
        <path d="M64 66 C52 73 44 71 36 66" />
        <path d="M36 66 C29 58 28 50 30 43" />
        <path d="M30 43 C37 33 43 29 50 28" />
      </g>

      {CAPILLARIES.map((link) => signal?.pipeline === link.name ? (
        <path
          key={link.name}
          d={link.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.55"
          data-pipeline-link={link.name}
        />
      ) : null)}

      <g fill="currentColor">
        {(Object.keys(ORGAN_PATHS) as BodyOrgan[]).map((organ) => (
          <g
            key={organ}
            data-organ={organ}
            data-anchor={`${BODY_ANCHORS[organ].x},${BODY_ANCHORS[organ].y}`}
            opacity={signal?.organ === organ ? 0.94 : 0.7}
          >
            <path d={ORGAN_PATHS[organ]} />
            {organ === "PULSE" && vitals.kind !== "unknown" ? (
              <path d={ORGAN_PATHS.PULSE} fill={rubric} opacity="0.62" transform="translate(0.35 0)" />
            ) : null}
          </g>
        ))}
      </g>

      <g data-relic-memory="settled">
        {relics.map((sample) => <g key={sample.offeringId} data-relic-offering={sample.offeringId} />)}
      </g>
    </svg>
  );
}
