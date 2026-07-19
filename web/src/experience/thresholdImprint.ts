export const IMPRINT_SIZE = 512;
export const MAX_OFFERING_BYTES = 512 * 1024;

// One observed pointer position, in seal-relative CSS pixels (x/y may be negative), stamped with
// milliseconds since its own capture began. Real behavioral data only: tremor samples are the
// coalesced drift of the holding hand; approach samples are the pointer's wander before the press.
export interface GestureSample {
  x: number;
  y: number;
  t: number;
}

export interface ImprintGesture {
  seed: Uint32Array;
  start: { x: number; y: number };
  end: { x: number; y: number };
  holdMs: number;
  pressure: number;
  // False when the device never reported a genuine pressure value (a mouse's constant 0.5):
  // stroke width then derives from the hold, which is always real, instead of presenting a
  // fabricated constant as captured pressure. Absent means the caller vouches for the value.
  pressureReal?: boolean;
  // The Quiver: the involuntary micro-drift of the hand during the hold.
  tremor?: readonly GestureSample[];
  // The Hesitation: the pointer's path in the seconds before it dared the seal.
  approach?: readonly GestureSample[];
}

export interface ImprintPath {
  points: readonly { x: number; y: number }[];
  width: number;
  // Ghost strokes (the approach) render below full ink; absent means fully inked.
  alpha?: number;
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
    // A pressure the device never genuinely reported is a fabricated constant; it shapes nothing,
    // not even the dice.
    Math.round((gesture.pressureReal === false ? 0 : gesture.pressure) * 1_000_000),
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

// How much of a full hold (1.6s) a press reached, in [0,1] -- the same fraction buildImprintPaths
// already derives to spread and lengthen the threads, exported so a color can be keyed to it too.
export function imprintHold(gesture: ImprintGesture): number {
  return clamp(Number.isFinite(gesture.holdMs) ? gesture.holdMs / 1_600 : 0, 0, 1);
}

// The Quiver, isolated: subtract a short rolling mean from the sampled positions so deliberate
// travel drops out and only the involuntary micro-drift of a hand told to be still remains, as a
// signed trace in [-1, 1]. Too few samples (a keyboard gesture, an instant tap) means no trace,
// and the caller falls back to seeded jitter -- the mark never fabricates a tremor it did not see.
const TREMOR_MIN_SAMPLES = 8;
const TREMOR_FULL_DRIFT_PX = 2.5;

export function tremorTrace(samples: readonly GestureSample[] | undefined): number[] | null {
  if (samples === undefined || samples.length < TREMOR_MIN_SAMPLES) return null;
  const WINDOW = 5;
  const trace: number[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    let meanX = 0;
    let meanY = 0;
    let count = 0;
    const from = Math.max(0, index - WINDOW);
    const to = Math.min(samples.length - 1, index + WINDOW);
    for (let j = from; j <= to; j += 1) {
      meanX += samples[j].x;
      meanY += samples[j].y;
      count += 1;
    }
    const driftX = samples[index].x - meanX / count;
    const driftY = samples[index].y - meanY / count;
    // One signed lateral channel: the drift's components summed, so direction survives and a
    // perfectly still hand reads as a flat line -- which no hand ever produces.
    trace.push(clamp((driftX + driftY) / TREMOR_FULL_DRIFT_PX, -1, 1));
  }
  return trace;
}

function traceAt(trace: readonly number[], t: number): number {
  const position = clamp(t, 0, 1) * (trace.length - 1);
  const index = Math.floor(position);
  const next = Math.min(trace.length - 1, index + 1);
  return trace[index] + (trace[next] - trace[index]) * (position - index);
}

// The Hesitation: the approach's wander, decimated and nested into the frame so it terminates at
// the strike. Ghost weight, below full ink -- the doubt kept beside the deed. Null when the hand
// arrived without enough recorded wander to etch honestly.
const APPROACH_MIN_SAMPLES = 6;
const APPROACH_MAX_POINTS = 24;
const APPROACH_SPAN = IMPRINT_SIZE * 0.62;

export function buildApproachPath(gesture: ImprintGesture): ImprintPath | null {
  const samples = gesture.approach;
  if (samples === undefined || samples.length < APPROACH_MIN_SAMPLES) return null;
  const step = Math.max(1, Math.ceil(samples.length / APPROACH_MAX_POINTS));
  const kept: GestureSample[] = [];
  for (let index = 0; index < samples.length; index += step) kept.push(samples[index]);
  const last = samples[samples.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  if (kept.some((sample) => !Number.isFinite(sample.x) || !Number.isFinite(sample.y))) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sample of kept) {
    minX = Math.min(minX, sample.x);
    minY = Math.min(minY, sample.y);
    maxX = Math.max(maxX, sample.x);
    maxY = Math.max(maxY, sample.y);
  }
  const spread = Math.max(maxX - minX, maxY - minY);
  if (spread < 8) return null; // the hand came straight; there is no hesitation to keep
  const scale = Math.min(1.6, APPROACH_SPAN / spread);
  const strike = {
    x: clamp(gesture.start.x, 0, IMPRINT_SIZE),
    y: clamp(gesture.start.y, 0, IMPRINT_SIZE),
  };
  const points = kept.map((sample) => ({
    x: rounded(clamp(strike.x + (sample.x - last.x) * scale, 0, IMPRINT_SIZE)),
    y: rounded(clamp(strike.y + (sample.y - last.y) * scale, 0, IMPRINT_SIZE)),
  }));
  return { points, width: 0.9, alpha: 0.32 };
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
  const hold = imprintHold(gesture);
  // Honest width channel: genuine pressure when the device reported one, otherwise the hold --
  // which is always real -- so stroke weight never presents a fabricated constant as capture.
  const pressure = gesture.pressureReal === false
    ? clamp(0.2 + hold * 0.55, 0, 1)
    : clamp(gesture.pressure, 0, 1);
  const trace = tremorTrace(gesture.tremor);
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
      // The Quiver shapes the threads whenever a real hand was observed: each thread reads the
      // tremor trace at its own staggered phase, so the mark's fine structure IS the hand's
      // involuntary drift. The dice only speak when no tremor exists to keep (keyboard, an
      // instant tap) -- uniqueness comes from the hand, not the seed, wherever it can.
      const jitter = trace !== null
        ? traceAt(trace, t * 0.82 + thread * 0.036) * (3 + hold * 7) * taper
        : (random() - 0.5) * (3 + hold * 7) * taper;
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

// ---- The Knock -------------------------------------------------------------------------------

// One press of a knock, in milliseconds relative to the first press's down.
export interface KnockPress {
  downMs: number;
  upMs: number;
}

export const KNOCK_MIN_PRESSES = 3;
export const KNOCK_MAX_PRESSES = 9;

// A knock's identity is its rhythm, not its tempo: the gaps between blows, each normalized by
// the mean gap, so the same rhythm knocked faster or slower reads as the same hand.
export function knockSignature(presses: readonly KnockPress[]): number[] {
  if (presses.length < 2) return [];
  const gaps: number[] = [];
  for (let index = 1; index < presses.length; index += 1) {
    gaps.push(Math.max(1, presses[index].downMs - presses[index - 1].downMs));
  }
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  return gaps.map((gap) => rounded(gap / mean));
}

// Rhythms invented under pressure are stereotyped: a returning hand knocks nearly the same way
// without meaning to. Tolerance is generous enough for flesh, tight enough that a stranger's
// rhythm does not pass.
export function knockMatches(a: readonly number[], b: readonly number[], tolerance = 0.25): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  return a.every((gap, index) => Math.abs(gap - b[index]) <= tolerance);
}

// The rhythm ladder: one rule read left to right, a dash per blow whose length is the press's own
// duration, a gap per silence, the final blow struck heavier. Neume notation in the mark grammar.
export function buildKnockPaths(presses: readonly KnockPress[]): ImprintPath[] {
  const kept = presses
    .slice(0, KNOCK_MAX_PRESSES)
    .filter((press) => Number.isFinite(press.downMs) && Number.isFinite(press.upMs));
  if (kept.length < KNOCK_MIN_PRESSES) {
    throw new TypeError(`a knock is at least ${KNOCK_MIN_PRESSES} presses`);
  }
  const MIN_DASH = 14;
  const DURATION_SCALE = 0.55;
  const GAP_SCALE = 0.22;
  const segments = kept.map((press, index) => ({
    dash: MIN_DASH + clamp(press.upMs - press.downMs, 0, 900) * DURATION_SCALE,
    gap: index === 0 ? 0 : Math.max(10, clamp(press.downMs - kept[index - 1].upMs, 0, 1_600) * GAP_SCALE),
  }));
  const total = segments.reduce((sum, segment) => sum + segment.dash + segment.gap, 0);
  const span = IMPRINT_SIZE * 0.78;
  const scale = Math.min(1.4, span / Math.max(1, total));
  let cursor = (IMPRINT_SIZE - total * scale) / 2;
  const y = IMPRINT_SIZE / 2;
  const paths: ImprintPath[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    cursor += segments[index].gap * scale;
    const from = cursor;
    cursor += segments[index].dash * scale;
    // A slight per-blow rise and settle keeps the ladder hand-set rather than typeset, derived
    // from the press's own duration -- real data, never dice.
    const lift = Math.sin((kept[index].upMs - kept[index].downMs) / 140) * 5;
    paths.push({
      points: [
        { x: rounded(clamp(from, 0, IMPRINT_SIZE)), y: rounded(clamp(y + lift, 0, IMPRINT_SIZE)) },
        { x: rounded(clamp(cursor, 0, IMPRINT_SIZE)), y: rounded(clamp(y - lift * 0.4, 0, IMPRINT_SIZE)) },
      ],
      width: index === segments.length - 1 ? 2.4 : 1.5,
    });
  }
  return paths;
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

// A gesture's threads naturally occupy a small fraction of the 512 canvas (a light tap can be
// under 100 units across), so the mark is scaled up to fill most of its frame instead of being
// stroked at native size -- the "scaled to frame" treatment, not a change to the thread geometry
// itself. Capped well below what a degenerate near-zero span could otherwise blow up to.
const FRAME_PAD = IMPRINT_SIZE * 0.1;
const MAX_FIT_SCALE = 6;

function fitScale(paths: readonly ImprintPath[]): { scale: number; midX: number; midY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const span = IMPRINT_SIZE - FRAME_PAD * 2;
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    scale: Math.min(span / width, span / height, MAX_FIT_SCALE),
    midX: (minX + maxX) / 2,
    midY: (minY + maxY) / 2,
  };
}

export async function renderImprintBlob(paths: readonly ImprintPath[], color: string): Promise<Blob> {
  // Five threads, five threads plus a ghost approach, or a knock's dash ladder: any small set of
  // bounded strokes is a mark; an empty or unbounded set is not.
  if (paths.length < 1 || paths.length > 12 || !paths.every(isRenderablePath)) {
    throw new TypeError("a mark requires bounded paths");
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
  context.strokeStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";

  const { scale, midX, midY } = fitScale(paths);
  context.save();
  context.translate(IMPRINT_SIZE / 2, IMPRINT_SIZE / 2);
  context.scale(scale, scale);
  context.translate(-midX, -midY);

  for (const path of paths) {
    context.beginPath();
    context.lineWidth = path.width;
    context.globalAlpha = path.alpha ?? 1;
    context.moveTo(path.points[0].x, path.points[0].y);
    for (const point of path.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.restore();

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
