import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import seraphMaskSvg from "../assets/seraph-mask.svg?raw";
import { BODY_ANCHORS, dedupeRelicSamples, signalForBodyCommand, type BodyOrgan } from "./bodyRenderer";
import {
  RELIC_TRAVEL_INITIAL_SCALE,
  RELIC_TRAVEL_THRESHOLD,
  foldRelicSamples,
  relicAccretionKey,
} from "./relicInk";

export interface SettledBodyProps {
  pigment: [number, number, number];
  command: BodyCommand | null;
  relicMemory: readonly RelicInkSample[];
  vitals: VitalsFeed;
  seraph: "five" | "converged";
  dreamResidue?: boolean;
  seraphSequenceCount?: number;
  completedId?: string | null;
  completionCount?: number;
  initialPulseKind?: VitalsFeed["kind"];
  ambientBreath?: boolean;
  relicRevision?: number;
  activeAccretionKey?: string | null;
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

const SVG_CENTER = 50;
const SERAPH_MASK_CONTENT = seraphMaskSvg.slice(
  seraphMaskSvg.indexOf(">") + 1,
  seraphMaskSvg.lastIndexOf("</svg>"),
);
const SVG_RELIC_START = {
  x: RELIC_TRAVEL_THRESHOLD.x * 100,
  y: (1 - RELIC_TRAVEL_THRESHOLD.y) * 100,
} as const;

function offeringHash(offeringId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < offeringId.length; index += 1) {
    hash ^= offeringId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function relicFragmentPath(sample: RelicInkSample): string | null {
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < sample.size; y += 2) {
    for (let x = 0; x < sample.size; x += 2) {
      if (sample.alpha[y * sample.size + x] >= 24) points.push({ x, y });
    }
  }
  if (points.length === 0) return null;

  const hash = offeringHash(sample.offeringId);
  const offsetX = ((hash & 0xff) / 255 - 0.5) * 8;
  const offsetY = (((hash >>> 8) & 0xff) / 255 - 0.5) * 8;
  const count = Math.min(9, points.length);
  const selected = Array.from({ length: count }, (_, index) => (
    points[Math.floor((index / Math.max(1, count - 1)) * (points.length - 1))]
  ));
  return selected.map((point, index) => {
    const x = 34 + (point.x / Math.max(1, sample.size - 1)) * 32 + offsetX;
    const y = 34 + (point.y / Math.max(1, sample.size - 1)) * 32 + offsetY;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

export function SettledBody({
  pigment,
  command,
  relicMemory,
  vitals,
  seraph,
  dreamResidue = false,
  seraphSequenceCount = 0,
  completedId = null,
  completionCount = 0,
  initialPulseKind,
  ambientBreath = false,
  relicRevision = 0,
  activeAccretionKey = null,
}: SettledBodyProps) {
  const signal = command === null ? null : signalForBodyCommand(command);
  const rubric = `rgb(${pigment.map((channel) => Math.round(channel * 255)).join(" ")})`;
  const relics = dedupeRelicSamples(relicMemory);
  const fragments = relics
    .map((sample) => ({ sample, path: relicFragmentPath(sample) }))
    .filter((fragment): fragment is { sample: RelicInkSample; path: string } => fragment.path !== null);
  const relicMaskNonzero = foldRelicSamples(relics)
    .reduce((count, alpha) => count + Number(alpha > 0), 0);
  const activeAccretion = command?.kind === "accrete" ? {
    key: relicAccretionKey(command.relic),
    path: relicFragmentPath(command.ink),
  } : null;

  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMax meet"
      className={`swarm-settled${ambientBreath ? " swarm-settled--breathing" : ""} absolute inset-0 z-0 h-full w-full pointer-events-none`}
      data-body-renderer="svg"
      data-arrival="settled"
      data-arrival-progress="1.000"
      data-active-organ={signal?.organ}
      data-pipeline={signal?.pipeline ?? "none"}
      data-command-id={command?.id}
      data-completed-id={completedId ?? undefined}
      data-completion-count={completionCount}
      data-seraph={seraph}
      data-seraph-phase={seraph === "converged" ? "hold" : "five"}
      data-seraph-sequence-count={seraphSequenceCount}
      data-seraph-timing="0/6000/0"
      data-dream-residue={dreamResidue ? "sophia" : "none"}
      data-pulse-kind={vitals.kind}
      data-initial-pulse-kind={initialPulseKind}
      data-initial-pulse-beat={initialPulseKind === "unknown" ? 0 : undefined}
      data-initial-pulse-bpm={initialPulseKind === "unknown" ? 0 : undefined}
      data-initial-pulse-pressure={initialPulseKind === "unknown" ? 0 : undefined}
      data-relic-count={fragments.length}
      data-relic-revision={relicRevision}
      data-relic-mask-nonzero={relicMaskNonzero}
      data-accretion-active-key={activeAccretionKey ?? undefined}
    >
      {seraph === "converged" ? (
        <g
          data-seraph-mask="true"
          transform="scale(0.1953125)"
          fill="currentColor"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          dangerouslySetInnerHTML={{ __html: SERAPH_MASK_CONTENT }}
        />
      ) : (
        <>
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
            data-residue={organ === "DREAM" && dreamResidue ? "sophia" : undefined}
            opacity={signal?.organ === organ ? 0.94 : organ === "DREAM" && dreamResidue ? 0.88 : 0.7}
          >
            <path d={ORGAN_PATHS[organ]} />
            {organ === "PULSE" && vitals.kind !== "unknown" ? (
              <path d={ORGAN_PATHS.PULSE} fill={rubric} opacity="0.62" transform="translate(0.35 0)" />
            ) : null}
          </g>
        ))}
      </g>
        </>
      )}

      <g data-relic-memory="settled">
        {fragments.map(({ sample, path }) => (
          <path
            key={sample.offeringId}
            data-relic-offering={sample.offeringId}
            data-relic-fragment
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.34"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.24"
          />
        ))}
      </g>
      {activeAccretion !== null && activeAccretion.path !== null ? (
        <g
          data-relic-travel
          data-accretion-key={activeAccretion.key}
          data-relic-travel-start={`${SVG_RELIC_START.x},${SVG_RELIC_START.y}`}
          data-relic-travel-scale={RELIC_TRAVEL_INITIAL_SCALE}
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            from={`${SVG_RELIC_START.x - SVG_CENTER} ${SVG_RELIC_START.y - SVG_CENTER}`}
            to="0 0"
            dur="1.2s"
            fill="freeze"
          />
          <g transform={`translate(${SVG_CENTER} ${SVG_CENTER})`}>
            <g>
              <animateTransform
                attributeName="transform"
                type="scale"
                from={`${RELIC_TRAVEL_INITIAL_SCALE} ${RELIC_TRAVEL_INITIAL_SCALE}`}
                to="1 1"
                dur="1.2s"
                fill="freeze"
              />
              <path
                d={activeAccretion.path}
                transform={`translate(${-SVG_CENTER} ${-SVG_CENTER})`}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.48"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.42"
              />
            </g>
          </g>
        </g>
      ) : null}
    </svg>
  );
}
