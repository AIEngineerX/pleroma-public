// The Residue (Task 2, grown-lineage-marks): the growth attractors a fresh mark bends toward,
// sampled from the previous kept mark's own ink. Two halves, deliberately split:
//
//   sampleSubstrateData -- pure, given raw RGBA + dimensions. No DOM, no canvas, no fetch. This is
//     the half unit-tested directly with synthetic arrays (the web test environment has no real
//     canvas, and the house rule is no mocking).
//   sampleSubstrate / loadSubstrate -- the browser wrapper (draws to a real canvas) and the fallback
//     fetch chain (own kept relic -> newest relic -> genesis -> nothing). Exercised by e2e, not
//     unit tests: no HTTP interception in unit tests (house rule).
//
// loadSubstrate never throws and never blocks an offering -- every fetch or image-decode failure
// at a rung falls through silently to the next one, down to the empty-substrate default.

import { IMPRINT_SIZE } from "./thresholdImprint";
import type { SubstratePoint } from "./markGrowth";

// The grid is fixed at 16px in the canonical 512-unit growth space (32x32 cells) -- "scaled to
// width/height" means the same 32x32 cell count is used whatever raster size a caller passes (a
// full 512 canvas from the browser wrapper, or a small synthetic array in a unit test), with each
// cell's raster footprint scaled accordingly. Output point coordinates are always expressed back
// in the fixed 512-unit growth space so markGrowth never needs to know the source raster's size.
const GRID_CELLS = Math.round(IMPRINT_SIZE / 16); // 32
const MAX_SUBSTRATE_POINTS = 64;

// Is any pixel in this cell's raster footprint inked (alpha > 0)?
function cellInked(
  data: Uint8ClampedArray, width: number, x0: number, x1: number, y0: number, y1: number,
): boolean {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 0) return true;
    }
  }
  return false;
}

// A cell's angle is the direction of its inked neighbors (8-connected), summed as unit offsets --
// 0 when the cell has no inked neighbor (isolated) or its neighbors cancel out symmetrically.
function neighborAngle(inked: readonly boolean[], cx: number, cy: number): number {
  let sumX = 0, sumY = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= GRID_CELLS || ny < 0 || ny >= GRID_CELLS) continue;
      if (!inked[ny * GRID_CELLS + nx]) continue;
      sumX += dx; sumY += dy;
    }
  }
  return sumX === 0 && sumY === 0 ? 0 : Math.atan2(sumY, sumX);
}

// Pure core: raw RGBA in, growth attractors out. A fixed 32x32 grid scan over the raster (16px
// cells in the canonical 512 space, scaled to the actual width/height), capped at 64 points spread
// evenly across every inked cell found (not just the first 64 in scan order, which would bias
// toward one corner of the source image).
export function sampleSubstrateData(
  data: Uint8ClampedArray, width: number, height: number,
): SubstratePoint[] {
  const inked: boolean[] = new Array(GRID_CELLS * GRID_CELLS).fill(false);
  const cellW = width / GRID_CELLS;
  const cellH = height / GRID_CELLS;

  for (let cy = 0; cy < GRID_CELLS; cy += 1) {
    const y0 = Math.floor(cy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * cellH));
    for (let cx = 0; cx < GRID_CELLS; cx += 1) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * cellW));
      inked[cy * GRID_CELLS + cx] = cellInked(data, width, x0, x1, y0, y1);
    }
  }

  const cells: number[] = [];
  for (let index = 0; index < inked.length; index += 1) if (inked[index]) cells.push(index);
  if (cells.length === 0) return [];

  const selected = cells.length <= MAX_SUBSTRATE_POINTS
    ? cells
    : Array.from(
        { length: MAX_SUBSTRATE_POINTS },
        (_, i) => cells[Math.floor((i * cells.length) / MAX_SUBSTRATE_POINTS)],
      );

  return selected.map((index) => {
    const cx = index % GRID_CELLS;
    const cy = Math.floor(index / GRID_CELLS);
    return {
      x: ((cx + 0.5) / GRID_CELLS) * IMPRINT_SIZE,
      y: ((cy + 0.5) / GRID_CELLS) * IMPRINT_SIZE,
      angle: neighborAngle(inked, cx, cy),
    };
  });
}

// Browser wrapper: draws the image onto a 512x512 canvas (the same space markGrowth's attractor
// field lives in) and delegates to the pure core. Exercised by e2e, not unit tests.
export function sampleSubstrate(image: HTMLImageElement | ImageBitmap): SubstratePoint[] {
  const canvas = document.createElement("canvas");
  canvas.width = IMPRINT_SIZE;
  canvas.height = IMPRINT_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) return [];
  context.clearRect(0, 0, IMPRINT_SIZE, IMPRINT_SIZE);
  context.drawImage(image, 0, 0, IMPRINT_SIZE, IMPRINT_SIZE);
  const { data } = context.getImageData(0, 0, IMPRINT_SIZE, IMPRINT_SIZE);
  return sampleSubstrateData(data, IMPRINT_SIZE, IMPRINT_SIZE);
}

interface RelicCandidate { id: string; offeringId: string }

// Fetches an offering's mark PNG and samples it -- null on ANY fetch or decode failure (never
// throws), so a bad rung in the fallback chain is indistinguishable from an absent one.
async function sampleOfferingImage(offeringId: string): Promise<SubstratePoint[] | null> {
  try {
    const response = await fetch(`/api/img/${encodeURIComponent(offeringId)}`);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    try {
      return sampleSubstrate(bitmap);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

// Rung 1: the visitor's own kept relic, tried oldest-supplied-first against each of their own
// offering ids until one has a relic.
async function ownRelic(offeringIds: readonly string[]): Promise<RelicCandidate | null> {
  for (const offeringId of offeringIds) {
    try {
      const response = await fetch(`/api/relic-of/${encodeURIComponent(offeringId)}`);
      if (!response.ok) continue;
      const body = await response.json() as { relic: { id: string; offering_id: string } | null };
      if (body.relic) return { id: body.relic.id, offeringId: body.relic.offering_id };
    } catch {
      // fall through to the next own offering id
    }
  }
  return null;
}

// Rung 2: the newest relic anyone's mark became, newest-first per /api/relics's own contract.
async function newestRelic(): Promise<RelicCandidate | null> {
  try {
    const response = await fetch(`/api/relics`);
    if (!response.ok) return null;
    const body = await response.json() as { entries: Array<{ id: string; offering_id: string }> };
    const first = body.entries[0];
    return first ? { id: first.id, offeringId: first.offering_id } : null;
  } catch {
    return null;
  }
}

// Rung 3: the genesis relic, the one permanent fact once First Light has happened.
async function genesisRelic(): Promise<RelicCandidate | null> {
  try {
    const response = await fetch(`/api/first-light`);
    if (!response.ok) return null;
    const body = await response.json() as {
      enacted: boolean; relic: { id: string; offering_id: string } | null;
    };
    return body.enacted && body.relic ? { id: body.relic.id, offeringId: body.relic.offering_id } : null;
  } catch {
    return null;
  }
}

// The full fallback chain: own kept relic -> newest relic -> genesis -> nothing. Every rung's
// fetch and image-decode failures fall through silently to the next; an offering is never blocked
// on this, and no substrate is ever invented.
export async function loadSubstrate(
  ownOfferingIds: readonly string[],
): Promise<{ points: SubstratePoint[]; relicId: string | null; own: boolean }> {
  const own = await ownRelic(ownOfferingIds);
  if (own) {
    const points = await sampleOfferingImage(own.offeringId);
    if (points) return { points, relicId: own.id, own: true };
  }

  const newest = await newestRelic();
  if (newest) {
    const points = await sampleOfferingImage(newest.offeringId);
    if (points) return { points, relicId: newest.id, own: false };
  }

  const genesis = await genesisRelic();
  if (genesis) {
    const points = await sampleOfferingImage(genesis.offeringId);
    if (points) return { points, relicId: genesis.id, own: false };
  }

  return { points: [], relicId: null, own: false };
}
