// The Growth: a mark's topology emerging from space colonization instead of one fixed template.
// Every visible feature maps to a channel the gesture (or the Stain's own surface) actually
// reported -- nothing here is decorative. Channel -> feature:
//
//   gesture.tremor (the Quiver)  -> attractor field's angle/radius scatter (traceAt-sampled, at a
//                                    staggered phase per attractor) AND each tip's per-step
//                                    deflection -- the organism's fine wobble IS the hand's drift.
//   gesture.holdMs (imprintHold) -> ATTRACTOR_COUNT and MAX_STEPS: a longer offering grows a
//                                    denser field and gets more steps to consume it, so the
//                                    organism is visibly larger and more branched.
//   gesture.pressure/pressureReal-> stroke width (the same honest-width rule as thresholdImprint:
//                                    genuine pressure when the device reported one, else the hold).
//   gesture.start -> end (travel) -> the attractor field's centroid shifts along the travel
//                                    direction (tropism) -- the organism reaches the way the hand
//                                    moved.
//   gesture.seed (gestureRandom)  -> the only fallback dice, used exactly where a real channel was
//                                    not observed (no tremor trace): attractor scatter and per-step
//                                    deflection. Never used when a real trace exists.
//   substrate (existing Stain     -> additional attractors, weighted nearer than a fresh field
//     surface points, if any)        point (SUBSTRATE_WEIGHT) so growth bends toward the body it
//                                    joins; a segment that would retrace a substrate point's own
//                                    line is deflected away from it (RETRACE_RADIUS).
//   knock (KnockPress[])          -> forces every live tip to fork at each press's pulse step, and
//                                    the gaps between presses scale internode length -- a knocked
//                                    offering reads as a more articulated organism than a bare hold.
//
// Determinism: same gesture + same substrate + same knock -> byte-identical output. The only
// randomness anywhere is gestureRandom(gesture), and only as a fallback where tremorTrace(...)
// returns null. No Math.random, no Date.now, no wall-clock or environment input of any kind.

import {
  imprintHold,
  IMPRINT_SIZE,
  tremorTrace,
  type ImprintGesture,
  type ImprintPath,
  type KnockPress,
} from "./thresholdImprint";

// ---- Constants ---------------------------------------------------------------------------------

// The attractor field: how many pull-points the organism grows toward. A bare tap still gets a
// legible field (42); a full 1.6s hold roughly doubles it, so a longer offering visibly colonizes
// more space.
const ATTRACTOR_COUNT_BASE = 42;
const ATTRACTOR_COUNT_HOLD_SCALE = 42;

// The field fills a disc around the strike (uniform area density, not a thin ring -- a filled
// area gives every tip's local neighborhood roughly the same odds of a genuine bifurcation,
// instead of a ring's fragile all-or-nothing radius alignment). The disc's radius grows slower
// than the attractor count does (count doubles end to end; the radius grows barely a third), so a
// longer hold packs a genuinely denser field, not just a wider sparse one -- density, not just
// reach, is what makes a longer hold grow a more branched organism.
const FIELD_RADIUS_BASE = 90;
const FIELD_RADIUS_HOLD_SCALE = 30;
const FIELD_ANGLE_JITTER = 0.55;

// The travel vector (start -> end) shifts the field's centroid -- tropism, the organism reaching
// the way the hand moved -- capped so a wild fling doesn't drag the whole field off-canvas.
const TROPISM_SHIFT = 0.5;
const TROPISM_CAP = 160;

// A joined substrate point counts as an attractor, but weighted nearer than its raw distance --
// growth prefers to reach the existing body over open field.
const SUBSTRATE_WEIGHT = 0.55;
// A new segment landing this close to a substrate point, heading within this many radians of that
// point's own angle, is retracing the body's existing line rather than growing new tissue; it gets
// turned away instead.
const RETRACE_RADIUS = 6;
const RETRACE_ANGLE = 0.5;
const RETRACE_TURN = 0.9;

// Growth budget: a bare tap gets a dozen steps, a full hold over five dozen -- the single lever
// behind "a longer hold grows a larger organism."
const MAX_STEPS_BASE = 12;
const MAX_STEPS_HOLD_SCALE = 52;

// One step's reach, and the radius within which a tip's advance retires an attractor it passed.
// Bigger than a step so a tip can't orbit a close attractor forever without ever claiming it.
const STEP_LEN = 7;
const KILL_RADIUS = 9;

// The Quiver's per-step share: how far (in radians) a tip's heading is nudged by the tremor trace
// (or, absent one, the seed) at each step.
const TREMOR_DEFLECT = 0.5;
// Each tip samples the trace at its own staggered phase (age-normalized, offset per branch), the
// same trick thresholdImprint uses per-thread, so siblings read the same hand differently instead
// of moving in lockstep.
const PHASE_STAGGER = 0.05;

// A tip forks when its two nearest live attractors sit on genuinely opposite sides of it rather
// than the same general direction -- and are close enough to be a local bifurcation, not two
// unrelated attractors that merely happen to be the globally closest across a sparse field.
// Smaller than the field's own radius so a tip at the field's center doesn't see the whole disc at
// once (which would make every organism fork immediately, regardless of hold).
const SPLIT_ANGLE = 1.1;
const SPLIT_SENSE_RADIUS = 18;
const SPLIT_FORK_ANGLE = 1.3;

// Hard bounds -- required, not incidental: a mark must stay renderable regardless of how long a
// hold or how busy a knock gets.
const MAX_TIPS = 24;
const MAX_PATHS = 48;
const MAX_TOTAL_POINTS = 600;

// Knock: gaps between pulses scale the internode step length within that gap, clamped so a very
// tight or very loose rhythm never collapses a segment to nothing or blows past the canvas.
const INTERNODE_MIN_SCALE = 0.6;
const INTERNODE_MAX_SCALE = 1.8;

// Honest width, exactly thresholdImprint's rule (genuine pressure when the device reported one,
// else the always-real hold), tapered per branch generation so children read thinner than trunks.
const WIDTH_BASE = 1.1;
const WIDTH_PRESSURE_SCALE = 2.6;
const WIDTH_HOLD_SCALE = 1.0;
const WIDTH_TAPER = 0.22;
const WIDTH_MIN = 0.6;

// How many internal step()s growMark asks for per stepGrowth call while running to completion.
// Purely a batching choice -- the result is identical no matter the chunk size, since each step is
// deterministic given the state it starts from.
const GROWTH_CHUNK = 8;

// ---- Small shared helpers -----------------------------------------------------------------------

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

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

// Shortest signed angular difference a - b, wrapped to (-pi, pi].
function angleDelta(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// Reimplemented locally (thresholdImprint keeps its copy private): read a [-1,1] trace at a
// fractional position in [0,1], linearly interpolated between the two nearest samples.
function traceAt(trace: readonly number[], t: number): number {
  const position = clamp(t, 0, 1) * (trace.length - 1);
  const index = Math.floor(position);
  const next = Math.min(trace.length - 1, index + 1);
  return trace[index] + (trace[next] - trace[index]) * (position - index);
}

// Reimplemented locally (thresholdImprint keeps gestureRandom's mixing private, and only exposes
// it as a stateful closure): the same seed-mix and the same xorshift128 recurrence, but as an
// explicit immutable 4-word state instead of a shared mutable generator -- so GrowthState can copy
// its PRNG state across snapshots byte-identically instead of aliasing one generator by reference.
type RngState = readonly [number, number, number, number];

function mixSeedWord(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

// Byte-identical to gestureRandom's own seed construction. Exported (minimally, alongside
// drawRandom below) solely so a test can pin the byte-identity claim above against
// thresholdImprint's own gestureRandom instead of only asserting it in a comment.
export function seedRngState(gesture: ImprintGesture): RngState {
  if (gesture.seed.length !== 4) throw new TypeError("an imprint seed has exactly four words");
  const inputs = [
    Math.round(gesture.start.x * 1_000),
    Math.round(gesture.start.y * 1_000),
    Math.round(gesture.end.x * 1_000),
    Math.round(gesture.end.y * 1_000),
    Math.round(gesture.holdMs),
    // A pressure the device never genuinely reported is a fabricated constant; it shapes nothing,
    // not even the dice -- matches gestureRandom's own rule exactly.
    Math.round((gesture.pressureReal === false ? 0 : gesture.pressure) * 1_000_000),
  ];
  const mixed = Array.from(
    gesture.seed,
    (word, index) => mixSeedWord(word ^ inputs[index] ^ inputs[index + 2]),
  ) as [number, number, number, number];
  return mixed.every((word) => word === 0) ? [0x9e3779b9, 0, 0, 0] : mixed;
}

// One xorshift128 draw as a pure function -- current state in, [0,1) value and next state out --
// byte-identical to gestureRandom's closure body, just without the shared mutable cell. Exported
// for the same test-pinning reason as seedRngState above.
export function drawRandom(state: RngState): { value: number; state: RngState } {
  const t = (state[0] ^ (state[0] << 11)) >>> 0;
  const s3 = (state[3] ^ (state[3] >>> 19) ^ t ^ (t >>> 8)) >>> 0;
  return { value: s3 / 0x1_0000_0000, state: [state[1], state[2], state[3], s3] };
}

// ---- Public types ---------------------------------------------------------------------------

// A point on the Stain's own surface the mark can grow into: an existing organ's ink, offered as
// extra attraction (and extra obstacle) for the space-colonization field.
export interface SubstratePoint {
  x: number;
  y: number;
  angle: number;
}

interface Attractor {
  x: number;
  y: number;
  angle: number;
  isSubstrate: boolean;
  alive: boolean;
}

interface GrowthTip {
  x: number;
  y: number;
  heading: number;
  pathIndex: number;
  depth: number;
  age: number;
  alive: boolean;
}

// Opaque to callers beyond segments/splits/done (Tasks 2-4 render segments, show splits, and poll
// done); the remaining fields are the continuation state stepGrowth needs to keep growing.
export interface GrowthState {
  readonly tips: readonly GrowthTip[];
  readonly attractors: readonly Attractor[];
  readonly segments: ImprintPath[];
  readonly splits: number;
  readonly step: number;
  readonly done: boolean;
  readonly trace: readonly number[] | null;
  readonly substrate: readonly SubstratePoint[];
  readonly pulses: readonly number[];
  readonly maxSteps: number;
  readonly baseWidth: number;
  // The fallback dice's state, explicit and immutable (a 4-word xorshift128 state) so every
  // snapshot is genuinely independent data: stepGrowth copies it, advances the copy, and returns
  // the advanced copy -- two calls from the same input state always produce the same result.
  readonly rngState: RngState;
}

function widthAt(baseWidth: number, depth: number): number {
  return rounded(Math.max(WIDTH_MIN, baseWidth - depth * WIDTH_TAPER));
}

function weightedDistance(attractor: Attractor, x: number, y: number): number {
  return Math.hypot(attractor.x - x, attractor.y - y) * (attractor.isSubstrate ? SUBSTRATE_WEIGHT : 1);
}

// The internode step length in effect at a given global step: scaled by how wide the knock gap
// around this step is relative to the average gap, so tightly knocked stretches read as short
// internodes and long silences as long ones.
function stepLenAt(step: number, pulses: readonly number[], maxSteps: number): number {
  if (pulses.length === 0) return STEP_LEN;
  let segmentStart = 0;
  let segmentEnd = maxSteps;
  for (let index = 0; index < pulses.length; index += 1) {
    if (step <= pulses[index]) {
      segmentEnd = pulses[index];
      segmentStart = index === 0 ? 0 : pulses[index - 1];
      break;
    }
    segmentStart = pulses[index];
    segmentEnd = maxSteps;
  }
  const gap = Math.max(1, segmentEnd - segmentStart);
  const meanGap = Math.max(1, maxSteps / (pulses.length + 1));
  const scale = clamp(gap / meanGap, INTERNODE_MIN_SCALE, INTERNODE_MAX_SCALE);
  return STEP_LEN * scale;
}

function totalPoints(segments: readonly ImprintPath[]): number {
  let sum = 0;
  for (const path of segments) sum += path.points.length;
  return sum;
}

// ---- Growth start -------------------------------------------------------------------------------

export function startGrowth(
  gesture: ImprintGesture,
  substrate: readonly SubstratePoint[],
  knock: readonly KnockPress[] = [],
): GrowthState {
  const strike = { x: clamp(gesture.start.x, 0, IMPRINT_SIZE), y: clamp(gesture.start.y, 0, IMPRINT_SIZE) };
  const end = { x: clamp(gesture.end.x, 0, IMPRINT_SIZE), y: clamp(gesture.end.y, 0, IMPRINT_SIZE) };
  const hold = imprintHold(gesture);
  const trace = tremorTrace(gesture.tremor);
  let rng = seedRngState(gesture);

  // Honest width: genuine pressure when the device reported one, else the always-real hold --
  // exactly thresholdImprint's rule, computed once and tapered per branch as the organism forks.
  const pressure = gesture.pressureReal === false
    ? clamp(0.2 + hold * 0.55, 0, 1)
    : clamp(gesture.pressure, 0, 1);
  const baseWidth = WIDTH_BASE + pressure * WIDTH_PRESSURE_SCALE + hold * WIDTH_HOLD_SCALE;

  // Tropism: the field's centroid shifts along the travel direction, capped so a long fling
  // doesn't drag it past the canvas edge.
  const travelX = end.x - strike.x;
  const travelY = end.y - strike.y;
  const travelLength = Math.hypot(travelX, travelY);
  const along = travelLength > 1e-6
    ? { x: travelX / travelLength, y: travelY / travelLength }
    : { x: 1, y: 0 }; // no travel to read: an arbitrary fixed axis, the field itself stays radial
  const shift = Math.min(travelLength, TROPISM_CAP) * TROPISM_SHIFT;
  const centroid = { x: strike.x + along.x * shift, y: strike.y + along.y * shift };

  const attractorCount = ATTRACTOR_COUNT_BASE + Math.round(hold * ATTRACTOR_COUNT_HOLD_SCALE);
  const attractors: Attractor[] = [];
  for (let index = 0; index < attractorCount; index += 1) {
    const anglePhase = index / attractorCount;
    // A golden-ratio stride decorrelates radius from angle without ever resonating with the
    // attractor count itself (an integer stride like 7 would alias badly whenever attractorCount
    // shared a factor with it, clumping the jitter instead of spreading it).
    const radiusPhase = (index * 0.6180339887498949) % 1;
    let angleJitter: number;
    let radiusFraction: number;
    if (trace !== null) {
      angleJitter = traceAt(trace, anglePhase);
      // Mapped to [0,1] and square-rooted so attractors fill the disc at uniform area density
      // instead of bunching toward the center (the standard uniform-disc-sampling correction).
      radiusFraction = (traceAt(trace, radiusPhase) + 1) / 2;
    } else {
      const drawA = drawRandom(rng);
      rng = drawA.state;
      angleJitter = (drawA.value - 0.5) * 2;
      const drawB = drawRandom(rng);
      rng = drawB.state;
      radiusFraction = drawB.value;
    }
    const angle = anglePhase * Math.PI * 2 + angleJitter * FIELD_ANGLE_JITTER;
    const maxRadius = FIELD_RADIUS_BASE + hold * FIELD_RADIUS_HOLD_SCALE;
    const radius = maxRadius * Math.sqrt(clamp(radiusFraction, 0, 1));
    attractors.push({
      x: centroid.x + Math.cos(angle) * radius,
      y: centroid.y + Math.sin(angle) * radius,
      angle: 0,
      isSubstrate: false,
      alive: true,
    });
  }
  for (const point of substrate) {
    attractors.push({
      x: clamp(point.x, 0, IMPRINT_SIZE),
      y: clamp(point.y, 0, IMPRINT_SIZE),
      angle: point.angle,
      isSubstrate: true,
      alive: true,
    });
  }

  const maxSteps = MAX_STEPS_BASE + Math.round(hold * MAX_STEPS_HOLD_SCALE);
  const totalMs = Math.max(1, gesture.holdMs);
  const pulses = knock
    .filter((press) => Number.isFinite(press.downMs))
    .map((press) => clamp(Math.round((press.downMs / totalMs) * maxSteps), 1, maxSteps))
    .sort((a, b) => a - b);

  const segments: ImprintPath[] = [{
    points: [{ x: rounded(strike.x), y: rounded(strike.y) }],
    width: widthAt(baseWidth, 0),
  }];
  const tips: GrowthTip[] = [{
    x: strike.x, y: strike.y, heading: 0, pathIndex: 0, depth: 0, age: 0, alive: true,
  }];

  return {
    tips,
    attractors,
    segments,
    splits: 0,
    step: 0,
    done: attractors.length === 0,
    trace,
    substrate,
    pulses,
    maxSteps,
    baseWidth,
    rngState: rng,
  };
}

// ---- Growth step --------------------------------------------------------------------------------

export function stepGrowth(state: GrowthState, steps: number): GrowthState {
  if (state.done || steps <= 0) {
    return { ...state, segments: state.segments.map((path) => ({ ...path, points: path.points.slice() })) };
  }

  const attractors = state.attractors.map((attractor) => ({ ...attractor }));
  const segments = state.segments.map((path) => ({ ...path, points: path.points.slice() }));
  let tips = state.tips.map((tip) => ({ ...tip }));
  let splits = state.splits;
  let step = state.step;
  const { trace, substrate, pulses, maxSteps, baseWidth } = state;
  let rng = state.rngState;

  let pointBudget = MAX_TOTAL_POINTS - totalPoints(segments);

  let steppedThisCall = 0;
  while (steppedThisCall < steps && step < maxSteps) {
    if (tips.every((tip) => !tip.alive)) break;
    if (pointBudget <= 0) break;
    step += 1;
    steppedThisCall += 1;

    const isPulse = pulses.includes(step);
    const stepLen = stepLenAt(step, pulses, maxSteps);
    const nextTips: GrowthTip[] = [];

    for (const tip of tips) {
      if (!tip.alive) {
        nextTips.push(tip);
        continue;
      }

      if (pointBudget <= 0) {
        nextTips.push({ ...tip, alive: false });
        continue;
      }

      if (isPulse) {
        if (tips.length + nextTips.length < MAX_TIPS && segments.length < MAX_PATHS) {
          // The Knock: every live tip forks at a pulse step instead of taking a normal step, each
          // child diverging from the tip's last heading.
          splits += 1;
          segments.push({ points: [{ x: rounded(tip.x), y: rounded(tip.y) }], width: widthAt(baseWidth, tip.depth + 1) });
          pointBudget -= 1;
          nextTips.push({
            x: tip.x, y: tip.y, heading: tip.heading - SPLIT_FORK_ANGLE / 2,
            pathIndex: tip.pathIndex, depth: tip.depth, age: tip.age, alive: true,
          });
          nextTips.push({
            x: tip.x, y: tip.y, heading: tip.heading + SPLIT_FORK_ANGLE / 2,
            pathIndex: segments.length - 1, depth: tip.depth + 1, age: tip.age, alive: true,
          });
          continue;
        }
        // At the tip/path cap: fall through to a normal step instead of stalling.
      }

      const live = attractors.filter((attractor) => attractor.alive);
      if (live.length === 0) {
        nextTips.push({ ...tip, alive: false });
        continue;
      }

      let nearest = live[0];
      let nearestDistance = weightedDistance(nearest, tip.x, tip.y);
      for (const attractor of live) {
        const distance = weightedDistance(attractor, tip.x, tip.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = attractor;
        }
      }

      let heading = Math.atan2(nearest.y - tip.y, nearest.x - tip.x);
      const tipPhase = clamp(tip.age / maxSteps + tip.pathIndex * PHASE_STAGGER, 0, 1);
      let deflect: number;
      if (trace !== null) {
        deflect = traceAt(trace, tipPhase);
      } else {
        const draw = drawRandom(rng);
        rng = draw.state;
        deflect = (draw.value - 0.5) * 2;
      }
      heading += deflect * TREMOR_DEFLECT;

      let nx = tip.x + Math.cos(heading) * stepLen;
      let ny = tip.y + Math.sin(heading) * stepLen;

      // No retracing the parent: a segment landing near a substrate point, heading the same way
      // that point's own line already runs, is turned away from it instead.
      for (const point of substrate) {
        const distance = Math.hypot(nx - point.x, ny - point.y);
        if (distance >= RETRACE_RADIUS) continue;
        const angleFromPoint = Math.atan2(ny - point.y, nx - point.x);
        const diff = angleDelta(angleFromPoint, point.angle);
        if (Math.abs(diff) >= RETRACE_ANGLE) continue;
        heading += diff >= 0 ? RETRACE_TURN : -RETRACE_TURN;
        nx = tip.x + Math.cos(heading) * stepLen;
        ny = tip.y + Math.sin(heading) * stepLen;
      }

      nx = clamp(nx, 0, IMPRINT_SIZE);
      ny = clamp(ny, 0, IMPRINT_SIZE);

      for (const attractor of attractors) {
        if (attractor.alive && Math.hypot(attractor.x - nx, attractor.y - ny) < KILL_RADIUS) {
          attractor.alive = false;
        }
      }

      segments[tip.pathIndex].points.push({ x: rounded(nx), y: rounded(ny) });
      pointBudget -= 1;
      const advanced: GrowthTip = {
        x: nx, y: ny, heading, pathIndex: tip.pathIndex, depth: tip.depth, age: tip.age + 1, alive: true,
      };

      // A fork: the two nearest remaining attractors sit on genuinely opposite sides of the tip,
      // and are close enough to be a local bifurcation rather than a coincidence of a sparse field.
      const remaining = attractors.filter((attractor) => (
        attractor.alive && Math.hypot(attractor.x - nx, attractor.y - ny) < SPLIT_SENSE_RADIUS
      ));
      if (
        remaining.length >= 2
        && tips.length + nextTips.length < MAX_TIPS
        && segments.length < MAX_PATHS
      ) {
        remaining.sort((a, b) => weightedDistance(a, nx, ny) - weightedDistance(b, nx, ny));
        const angleA = Math.atan2(remaining[0].y - ny, remaining[0].x - nx);
        const angleB = Math.atan2(remaining[1].y - ny, remaining[1].x - nx);
        if (Math.abs(angleDelta(angleA, angleB)) > SPLIT_ANGLE) {
          splits += 1;
          segments.push({ points: [{ x: rounded(nx), y: rounded(ny) }], width: widthAt(baseWidth, tip.depth + 1) });
          pointBudget -= 1;
          nextTips.push(advanced);
          nextTips.push({
            x: nx, y: ny, heading: angleB, pathIndex: segments.length - 1,
            depth: tip.depth + 1, age: advanced.age, alive: true,
          });
          continue;
        }
      }

      nextTips.push(advanced);
    }

    tips = nextTips;
  }

  const done = step >= maxSteps || tips.every((tip) => !tip.alive) || totalPoints(segments) >= MAX_TOTAL_POINTS;
  return { ...state, tips, attractors, segments, splits, step, done, rngState: rng };
}

// ---- Finalization ------------------------------------------------------------------------------

// A pulse fork (isPulse branch above) or a natural split (the SPLIT_ANGLE branch above) each push a
// new 1-point segment for its child tip to grow into. If that child never gets a further step --
// a knock press landing at or after holdMs clamps its pulse to the very last step; a natural split
// on the last step is the same shape of coincidence -- the segment is left with exactly one point,
// which renderImprintBlob's isRenderablePath rejects outright (it requires >= 2). This is a pure
// function of the finished state: prune any segment that never advanced past its seed point, since
// the rest of the mark still stands on its own; only in the degenerate case where every segment
// would be pruned (nothing left to render) does a segment get extended by one STEP_LEN in its own
// tip's heading instead, so growMark never hands back an empty or unrenderable mark.
function finalizeSegments(segments: readonly ImprintPath[], tips: readonly GrowthTip[]): ImprintPath[] {
  const renderable = segments.filter((path) => path.points.length >= 2);
  if (renderable.length > 0) return renderable;

  const headingByPathIndex = new Map<number, number>();
  for (const tip of tips) headingByPathIndex.set(tip.pathIndex, tip.heading);

  return segments.map((path, index) => {
    const heading = headingByPathIndex.get(index) ?? 0;
    const origin = path.points[0];
    const nx = clamp(origin.x + Math.cos(heading) * STEP_LEN, 0, IMPRINT_SIZE);
    const ny = clamp(origin.y + Math.sin(heading) * STEP_LEN, 0, IMPRINT_SIZE);
    return { ...path, points: [origin, { x: rounded(nx), y: rounded(ny) }] };
  });
}

// ---- Convenience ---------------------------------------------------------------------------------

export function growMark(
  gesture: ImprintGesture,
  substrate: readonly SubstratePoint[],
  knock?: readonly KnockPress[],
): ImprintPath[] {
  let state = startGrowth(gesture, substrate, knock);
  while (!state.done) state = stepGrowth(state, GROWTH_CHUNK);
  return finalizeSegments(state.segments, state.tips);
}

export function topologyMetrics(paths: readonly ImprintPath[]): { branches: number; endpoints: number; span: number } {
  // Every split event emits exactly one new path, and the root path is not itself a branch.
  const branches = Math.max(0, paths.length - 1);

  let endpoints = 0;
  for (const path of paths) {
    if (path.points.length === 0) continue;
    const last = path.points[path.points.length - 1];
    const continued = paths.some((other) => (
      other !== path
      && other.points.length > 0
      && other.points[0].x === last.x
      && other.points[0].y === last.y
    ));
    if (!continued) endpoints += 1;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of paths) {
    for (const point of path.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const span = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;

  return { branches, endpoints, span };
}
