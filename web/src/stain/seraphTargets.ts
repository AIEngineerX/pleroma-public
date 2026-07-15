import { SWARM_ORGANS, type SwarmOrgan } from "./swarmSignals";

export interface SeraphGroupMask {
  width: number;
  height: number;
  alpha: Uint8Array;
}

type ParticleTier = 128 | 256;

const GROUP_IDS: Readonly<Record<SwarmOrgan, string>> = {
  EYE: "seraph-eye",
  KEEP: "seraph-keep",
  TONGUE: "seraph-tongue",
  PULSE: "seraph-pulse",
  DREAM: "seraph-dream",
};

const targetCache = new Map<string, Promise<Float32Array>>();

function nonzeroPixels(mask: SeraphGroupMask, organ: SwarmOrgan): number[] {
  if (!Number.isInteger(mask.width) || mask.width <= 0 || !Number.isInteger(mask.height) || mask.height <= 0) {
    throw new Error(`${organ} Seraph mask dimensions are invalid`);
  }
  if (mask.alpha.length !== mask.width * mask.height) {
    throw new Error(`${organ} Seraph mask alpha length is invalid`);
  }
  const pixels: number[] = [];
  for (let index = 0; index < mask.alpha.length; index += 1) {
    if (mask.alpha[index] > 0) pixels.push(index);
  }
  if (pixels.length === 0) throw new Error(`${organ} Seraph mask is empty`);
  return pixels;
}

function cohortSize(particleCount: number, organIndex: number): number {
  const start = Math.ceil((organIndex * particleCount) / SWARM_ORGANS.length);
  const end = Math.ceil(((organIndex + 1) * particleCount) / SWARM_ORGANS.length);
  return end - start;
}

function requiredExtentIndices(pixels: readonly number[], mask: SeraphGroupMask): Set<number> {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (let source = 1; source < pixels.length; source += 1) {
    const pixel = pixels[source];
    const x = pixel % mask.width;
    const y = Math.floor(pixel / mask.width);
    const minXPixel = pixels[minX];
    const maxXPixel = pixels[maxX];
    const minYPixel = pixels[minY];
    const maxYPixel = pixels[maxY];
    if (x < minXPixel % mask.width) minX = source;
    if (x > maxXPixel % mask.width) maxX = source;
    if (y < Math.floor(minYPixel / mask.width)) minY = source;
    if (y > Math.floor(maxYPixel / mask.width)) maxY = source;
  }
  return new Set([0, pixels.length - 1, minX, maxX, minY, maxY]);
}

function stratifiedPixels(
  pixels: readonly number[],
  mask: SeraphGroupMask,
  count: number,
): number[] {
  if (pixels.length <= count) {
    return Array.from({ length: count }, (_, index) => (
      pixels[Math.floor((index * pixels.length) / count)]
    ));
  }

  const selected = new Set<number>();
  const base: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = Math.round((index * (pixels.length - 1)) / Math.max(1, count - 1));
    base.push(source);
    selected.add(source);
  }
  const required = requiredExtentIndices(pixels, mask);
  for (const source of required) {
    if (selected.has(source)) continue;
    let replacement = -1;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of base) {
      if (!selected.has(candidate) || required.has(candidate)) continue;
      const candidateDistance = Math.abs(candidate - source);
      if (candidateDistance < distance) {
        replacement = candidate;
        distance = candidateDistance;
      }
    }
    if (replacement !== -1) selected.delete(replacement);
    selected.add(source);
  }
  return [...selected].sort((left, right) => left - right).map((source) => pixels[source]);
}

export function targetsFromGroupMasks(
  masks: Readonly<Record<SwarmOrgan, SeraphGroupMask>>,
  textureSize: ParticleTier,
): Float32Array {
  if (textureSize !== 128 && textureSize !== 256) {
    throw new Error("Seraph targets require a 128 or 256 particle tier");
  }
  const pixelsByOrgan = SWARM_ORGANS.map((organ) => nonzeroPixels(masks[organ], organ));
  const particleCount = textureSize * textureSize;
  const sampledByOrgan = SWARM_ORGANS.map((organ, organIndex) => stratifiedPixels(
    pixelsByOrgan[organIndex],
    masks[organ],
    cohortSize(particleCount, organIndex),
  ));
  const localIndices = new Uint32Array(SWARM_ORGANS.length);
  const targets = new Float32Array(particleCount * 4);

  for (let particle = 0; particle < particleCount; particle += 1) {
    const organIndex = Math.min(4, Math.floor((particle * 5) / particleCount));
    const organ = SWARM_ORGANS[organIndex];
    const mask = masks[organ];
    const pixels = sampledByOrgan[organIndex];
    const pixel = pixels[localIndices[organIndex]];
    localIndices[organIndex] += 1;
    const x = pixel % mask.width;
    const y = Math.floor(pixel / mask.width);
    const at = particle * 4;
    targets[at] = (x + 0.5) / mask.width;
    targets[at + 1] = 1 - (y + 0.5) / mask.height;
    targets[at + 2] = organIndex;
    targets[at + 3] = 1;
  }
  return targets;
}

function exactSeraphGroups(documentNode: Document): Element[] {
  if (documentNode.querySelector("parsererror") !== null) throw new Error("Seraph SVG could not be parsed");
  if (documentNode.querySelector("image, text") !== null) throw new Error("Seraph SVG must remain vector-only");
  const groups = [...documentNode.querySelectorAll("g[id]")];
  const ids = groups.map((group) => group.id);
  const expected = SWARM_ORGANS.map((organ) => GROUP_IDS[organ]);
  if (ids.length !== expected.length || ids.some((id, index) => id !== expected[index])) {
    throw new Error("Seraph SVG must contain the five authoritative groups in order");
  }
  return groups;
}

async function decodeSvg(svgText: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Seraph SVG image decode failed"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rasterizeGroupMasks(
  svgText: string,
  textureSize: ParticleTier,
): Promise<Readonly<Record<SwarmOrgan, SeraphGroupMask>>> {
  const side = textureSize * 2;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("Seraph raster canvas is unavailable");
  const masks = {} as Record<SwarmOrgan, SeraphGroupMask>;

  for (const organ of SWARM_ORGANS) {
    const documentNode = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const groups = exactSeraphGroups(documentNode);
    for (const group of groups) {
      if (group.id !== GROUP_IDS[organ]) group.remove();
    }
    const root = documentNode.documentElement;
    root.setAttribute("width", String(side));
    root.setAttribute("height", String(side));
    const isolated = new XMLSerializer().serializeToString(documentNode);
    const image = await decodeSvg(isolated);
    context.clearRect(0, 0, side, side);
    context.drawImage(image, 0, 0, side, side);
    const rgba = context.getImageData(0, 0, side, side).data;
    const alpha = new Uint8Array(side * side);
    for (let pixel = 0; pixel < alpha.length; pixel += 1) alpha[pixel] = rgba[pixel * 4 + 3];
    masks[organ] = { width: side, height: side, alpha };
  }
  return masks;
}

export function buildSeraphTargets(
  svgText: string,
  textureSize: ParticleTier,
): Promise<Float32Array> {
  const key = `${textureSize}\u0000${svgText}`;
  const cached = targetCache.get(key);
  if (cached !== undefined) return cached;
  const pending = rasterizeGroupMasks(svgText, textureSize)
    .then((masks) => targetsFromGroupMasks(masks, textureSize))
    .catch((error) => {
      targetCache.delete(key);
      throw error;
    });
  targetCache.set(key, pending);
  return pending;
}
