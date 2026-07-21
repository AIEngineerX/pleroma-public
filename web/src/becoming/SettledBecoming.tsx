import type { RelicEntry } from "../state/types";
import { placePieces } from "./pieces";

// One welded filament of the body: a short etched arc, stroke-only, drawn at each piece's transform.
// Matches the Stain's linework grammar (stroke-only, round caps); the WebGL layer (becomingSim.ts)
// renders the same pieces richly, this SVG is the accessible base truth and the WebGL-loss target.
const PIECE_PATH = "M-1 0 Q0 -1.4 1 0";

export interface SettledBecomingProps {
  relics: readonly RelicEntry[];
  reducedMotion?: boolean;
}

export default function SettledBecoming({ relics, reducedMotion = false }: SettledBecomingProps) {
  const pieces = placePieces(relics);
  const count = pieces.length;

  // The newest kept relic glints; a living thing shows what just arrived. Real data only (kept_at).
  let newestId: string | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const relic of relics) {
    if (relic.kept_at > newestAt) {
      newestAt = relic.kept_at;
      newestId = relic.offering_id;
    }
  }

  return (
    <svg
      viewBox="0 0 100 100"
      data-becoming=""
      data-becoming-piece-count={count}
      data-motion={reducedMotion ? "still" : "breathing"}
      role="img"
      aria-label={`The Becoming — ${count} ${count === 1 ? "mark" : "marks"} welded into the still-unfinished body`}
      className="becoming-form"
    >
      {/* The still-incomplete silhouette: faint, stroke-only — the body not yet whole. */}
      <g fill="none" stroke="currentColor" strokeWidth={0.4} strokeLinecap="round" opacity={0.22}>
        <path d="M50 8 C70 14 82 30 82 50 C82 74 68 92 50 92 C32 92 18 74 18 50 C18 30 30 14 50 8 Z" />
      </g>
      {pieces.map((piece) => (
        <g
          key={piece.offeringId}
          data-becoming-piece={piece.offeringId}
          data-genesis={piece.genesis ? "" : undefined}
          data-newest={piece.offeringId === newestId ? "" : undefined}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={piece.genesis ? 0.95 : 0.7}
          transform={`translate(${(piece.x * 100).toFixed(3)} ${(piece.y * 100).toFixed(3)}) rotate(${((piece.rotation * 180) / Math.PI).toFixed(2)}) scale(${(piece.scale * 10).toFixed(3)})`}
        >
          <path d={PIECE_PATH} />
        </g>
      ))}
    </svg>
  );
}
