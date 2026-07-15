import type { AccretedRelic, RelicInkSample } from "../experience/types";
import { isTimestamp, type RelicEntry } from "../state/types";

export const RELIC_SAMPLE_SIZE = 64;
export const RELIC_MEMORY_LIMIT = 50;
export const RELIC_ACCRETION_DURATION_MS = 1_200;
export const RELIC_TRAVEL_THRESHOLD = { x: 0.5, y: 0.07 } as const;
export const RELIC_TRAVEL_INITIAL_SCALE = 0.16;

export function isAccreted(relic: RelicEntry): relic is AccretedRelic {
  return isTimestamp(relic.accreted_at);
}

export function relicAccretionKey(relic: AccretedRelic): string {
  return `${relic.offering_id}\u001f${relic.accreted_at}`;
}

export function selectAccretedRelics(relics: readonly RelicEntry[]): AccretedRelic[] {
  const selected: AccretedRelic[] = [];
  const offerings = new Set<string>();
  for (const relic of relics) {
    if (!isAccreted(relic) || offerings.has(relic.offering_id)) continue;
    offerings.add(relic.offering_id);
    selected.push(relic);
    if (selected.length === RELIC_MEMORY_LIMIT) break;
  }
  return selected;
}

export function relicImageUrl(apiBase: string, offeringId: string): string {
  return `${apiBase}/api/img/${encodeURIComponent(offeringId)}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The relic request was aborted", "AbortError");
}

export async function fetchRelicInk(
  apiBase: string,
  relic: AccretedRelic,
  signal?: AbortSignal,
): Promise<RelicInkSample> {
  if (!isAccreted(relic)) throw new TypeError("relic ink requires a confirmed accretion timestamp");
  if (signal?.aborted) throw abortReason(signal);

  const response = await fetch(relicImageUrl(apiBase, relic.offering_id), { signal });
  if (!response.ok) throw new Error(`relic ink fetch failed: ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType === undefined || !contentType.startsWith("image/")) {
    throw new TypeError("relic ink response is not an image");
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    if (signal?.aborted) throw abortReason(signal);
    const canvas = document.createElement("canvas");
    canvas.width = RELIC_SAMPLE_SIZE;
    canvas.height = RELIC_SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("relic ink canvas is unavailable");
    context.clearRect(0, 0, RELIC_SAMPLE_SIZE, RELIC_SAMPLE_SIZE);
    context.drawImage(bitmap, 0, 0, RELIC_SAMPLE_SIZE, RELIC_SAMPLE_SIZE);
    const rgba = context.getImageData(0, 0, RELIC_SAMPLE_SIZE, RELIC_SAMPLE_SIZE).data;
    const alpha = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
    if (signal?.aborted) throw abortReason(signal);
    return { offeringId: relic.offering_id, size: RELIC_SAMPLE_SIZE, alpha };
  } finally {
    bitmap.close();
  }
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mergeRelicAlpha(
  base: Uint8Array,
  sample: RelicInkSample,
  placementSeed: string,
): Uint8Array {
  const pixelCount = RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE;
  if (base.length !== pixelCount) throw new RangeError("relic memory mask must be 64 by 64");
  if (sample.size !== RELIC_SAMPLE_SIZE || sample.alpha.length !== pixelCount) {
    throw new RangeError("relic ink sample must be 64 by 64");
  }

  const merged = base.slice();
  const seed = hashSeed(placementSeed);
  const side = 40 + (seed % 17);
  const room = RELIC_SAMPLE_SIZE - side;
  const offsetX = (seed >>> 8) % (room + 1);
  const offsetY = (seed >>> 16) % (room + 1);
  const rotation = (seed >>> 24) & 3;
  const mirror = ((seed >>> 23) & 1) === 1;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      let sampleX = Math.min(RELIC_SAMPLE_SIZE - 1, Math.floor((x / side) * RELIC_SAMPLE_SIZE));
      let sampleY = Math.min(RELIC_SAMPLE_SIZE - 1, Math.floor((y / side) * RELIC_SAMPLE_SIZE));
      if (mirror) sampleX = RELIC_SAMPLE_SIZE - 1 - sampleX;
      const originalX = sampleX;
      if (rotation === 1) {
        sampleX = RELIC_SAMPLE_SIZE - 1 - sampleY;
        sampleY = originalX;
      } else if (rotation === 2) {
        sampleX = RELIC_SAMPLE_SIZE - 1 - sampleX;
        sampleY = RELIC_SAMPLE_SIZE - 1 - sampleY;
      } else if (rotation === 3) {
        sampleX = sampleY;
        sampleY = RELIC_SAMPLE_SIZE - 1 - originalX;
      }

      const source = sample.alpha[sampleY * RELIC_SAMPLE_SIZE + sampleX];
      const destination = (offsetY + y) * RELIC_SAMPLE_SIZE + offsetX + x;
      merged[destination] = Math.min(255, merged[destination] + source);
    }
  }
  return merged;
}

export function foldRelicSamples(samples: readonly RelicInkSample[]): Uint8Array {
  let mask: Uint8Array = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
  const offerings = new Set<string>();
  for (const sample of samples) {
    if (offerings.has(sample.offeringId)) continue;
    offerings.add(sample.offeringId);
    mask = mergeRelicAlpha(mask, sample, sample.offeringId);
    if (offerings.size === RELIC_MEMORY_LIMIT) break;
  }
  return mask;
}
