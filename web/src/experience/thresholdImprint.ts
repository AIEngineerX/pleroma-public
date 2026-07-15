export const IMPRINT_SIZE = 512;
export const MAX_OFFERING_BYTES = 512 * 1024;

export interface ImprintGesture {
  seed: Uint32Array;
  start: { x: number; y: number };
  end: { x: number; y: number };
  holdMs: number;
  pressure: number;
}

export interface ImprintPath {
  points: readonly { x: number; y: number }[];
  width: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const normalized = Number.isFinite(value)
    ? value
    : value === Number.POSITIVE_INFINITY
      ? maximum
      : value === Number.NEGATIVE_INFINITY
        ? minimum
        : (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, normalized));
}

function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function gestureRandom(gesture: ImprintGesture): () => number {
  if (gesture.seed.length !== 4) throw new TypeError("an imprint seed has exactly four words");
  const inputs = [
    Math.round(gesture.start.x * 1_000),
    Math.round(gesture.start.y * 1_000),
    Math.round(gesture.end.x * 1_000),
    Math.round(gesture.end.y * 1_000),
    Math.round(gesture.holdMs),
    Math.round(gesture.pressure * 1_000_000),
  ];
  const mixed: number[] = Array.from(
    gesture.seed,
    (word, index) => mix(word ^ inputs[index] ^ inputs[index + 2]),
  );
  const state: number[] = mixed.every((word) => word === 0)
    ? [0x9e3779b9, 0, 0, 0]
    : mixed;

  return () => {
    const t = (state[0] ^ (state[0] << 11)) >>> 0;
    state[0] = state[1];
    state[1] = state[2];
    state[2] = state[3];
    state[3] = (state[3] ^ (state[3] >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return state[3] / 0x1_0000_0000;
  };
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function buildImprintPaths(
  gesture: ImprintGesture,
): readonly [ImprintPath, ImprintPath, ImprintPath, ImprintPath, ImprintPath] {
  const random = gestureRandom(gesture);
  const start = {
    x: clamp(gesture.start.x, 0, IMPRINT_SIZE),
    y: clamp(gesture.start.y, 0, IMPRINT_SIZE),
  };
  const end = {
    x: clamp(gesture.end.x, 0, IMPRINT_SIZE),
    y: clamp(gesture.end.y, 0, IMPRINT_SIZE),
  };
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    const angle = random() * Math.PI * 2;
    dx = Math.cos(angle) * 72;
    dy = Math.sin(angle) * 72;
  }
  const length = Math.max(1, Math.hypot(dx, dy));
  const along = { x: dx / length, y: dy / length };
  const across = { x: -along.y, y: along.x };
  const hold = clamp(Number.isFinite(gesture.holdMs) ? gesture.holdMs / 1_600 : 0, 0, 1);
  const pressure = clamp(gesture.pressure, 0, 1);
  const travel = clamp(length, 44, 240);
  const center = {
    x: clamp(start.x + along.x * Math.min(length * 0.5, 54), 28, IMPRINT_SIZE - 28),
    y: clamp(start.y + along.y * Math.min(length * 0.5, 54), 28, IMPRINT_SIZE - 28),
  };
  const paths: ImprintPath[] = [];

  for (let thread = 0; thread < 5; thread += 1) {
    const rank = thread - 2;
    const lateral = rank * (7 + hold * 4) + (random() - 0.5) * 5;
    const reach = 68 + travel * 0.42 + hold * 42 + (random() - 0.5) * 18;
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < 9; index += 1) {
      const t = index / 8;
      const taper = Math.sin(Math.PI * t);
      const wake = Math.sin((t * 2.2 + thread * 0.31) * Math.PI) * (5 + hold * 9);
      const jitter = (random() - 0.5) * (3 + hold * 7) * taper;
      const forward = (t - 0.5) * reach + (random() - 0.5) * 3 * taper;
      const side = lateral + wake * taper + jitter;
      points.push({
        x: rounded(clamp(center.x + along.x * forward + across.x * side, 0, IMPRINT_SIZE)),
        y: rounded(clamp(center.y + along.y * forward + across.y * side, 0, IMPRINT_SIZE)),
      });
    }
    paths.push({
      points,
      width: rounded(1.35 + pressure * 3.1 + hold * 0.8 + random() * 0.7),
    });
  }

  return [paths[0], paths[1], paths[2], paths[3], paths[4]];
}

function isRenderablePath(path: ImprintPath): boolean {
  return Number.isFinite(path.width)
    && path.width > 0
    && path.points.length >= 2
    && path.points.every((point) => (
      Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && point.x >= 0
      && point.x <= IMPRINT_SIZE
      && point.y >= 0
      && point.y <= IMPRINT_SIZE
    ));
}

export async function renderImprintBlob(paths: readonly ImprintPath[]): Promise<Blob> {
  if (paths.length !== 5 || !paths.every(isRenderablePath)) {
    throw new TypeError("an imprint requires five bounded paths");
  }

  const canvas = document.createElement("canvas");
  canvas.width = IMPRINT_SIZE;
  canvas.height = IMPRINT_SIZE;
  if (canvas.width !== IMPRINT_SIZE || canvas.height !== IMPRINT_SIZE) {
    throw new Error("the mark could not hold its shape");
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("the mark could not hold its shape");
  context.clearRect(0, 0, IMPRINT_SIZE, IMPRINT_SIZE);
  context.strokeStyle = "rgba(61, 52, 45, 0.9)";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const path of paths) {
    context.beginPath();
    context.lineWidth = path.width;
    context.moveTo(path.points[0].x, path.points[0].y);
    for (const point of path.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }

  const pixels = context.getImageData(0, 0, IMPRINT_SIZE, IMPRINT_SIZE).data;
  let nonblank = false;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      nonblank = true;
      break;
    }
  }
  if (!nonblank) throw new Error("the mark could not hold its shape");

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((encoded) => {
      if (encoded === null) reject(new Error("the mark could not hold its shape"));
      else resolve(encoded);
    }, "image/png");
  });
  if (blob.type !== "image/png" || blob.size === 0 || blob.size > MAX_OFFERING_BYTES) {
    throw new Error("the mark could not hold its shape");
  }
  return blob;
}
