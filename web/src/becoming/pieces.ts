import type { RelicEntry } from "../state/types";

export interface BecomingPiece {
  offeringId: string;
  x: number;        // body-space [0,1]
  y: number;        // body-space [0,1]
  scale: number;    // (0,1]
  rotation: number; // radians [0, 2π)
  genesis: boolean;
}

type RelicSeed = Pick<RelicEntry, "offering_id" | "genesis">;

// FNV-1a — matches the deterministic-seed pattern used across the Stain (relicInk.ts hashSeed,
// hermes isFilmDay). A piece's whole placement derives from this, so it is stable and replayable.
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// The unfinished body is an oval column; pieces distribute within it deterministically. The genesis
// relic (the founding mark) is pinned at the core. Area-uniform radial placement keeps every piece
// inside [0,1] body-space without ever depending on the other relics — so a piece never moves once placed.
export function placePiece(relic: RelicSeed): BecomingPiece {
  const seed = hashSeed(relic.offering_id);
  const genesis = relic.genesis !== 0;
  if (genesis) {
    return { offeringId: relic.offering_id, x: 0.5, y: 0.5, scale: 0.14, rotation: 0, genesis: true };
  }
  const angle = ((seed & 0xffff) / 0x10000) * Math.PI * 2;
  const radius = Math.sqrt(((seed >>> 16) & 0xffff) / 0x10000); // sqrt → area-uniform, no center clumping
  const rx = 0.34, ry = 0.44;                                   // oval half-extents inside [0,1]
  const x = 0.5 + Math.cos(angle) * radius * rx;
  const y = 0.5 + Math.sin(angle) * radius * ry;
  const scale = 0.05 + (((seed >>> 8) & 0x3f) / 0x3f) * 0.06;   // 0.05..0.11
  const rotation = (((seed >>> 2) & 0xfff) / 0x1000) * Math.PI * 2;
  return { offeringId: relic.offering_id, x, y, scale, rotation, genesis: false };
}

export function placePieces(relics: readonly RelicSeed[]): BecomingPiece[] {
  const seen = new Set<string>();
  const pieces: BecomingPiece[] = [];
  for (const relic of relics) {
    if (seen.has(relic.offering_id)) continue;
    seen.add(relic.offering_id);
    pieces.push(placePiece(relic));
  }
  return pieces;
}

// The newest kept relic glints — shared by SettledBecoming (the glinting piece) and Becoming.tsx
// (the WebGL layer's glint uniform), so the two never drift on which piece is "newest". Real data
// only (kept_at).
export function newestOfferingId(
  relics: readonly Pick<RelicEntry, "offering_id" | "kept_at">[],
): string | null {
  let newestId: string | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const relic of relics) {
    if (relic.kept_at > newestAt) {
      newestAt = relic.kept_at;
      newestId = relic.offering_id;
    }
  }
  return newestId;
}
