import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { emitGrain } from "../lib/ambient";
import { copy } from "../lib/copy";
import WalletButton from "../offering/WalletButton";
import { buildOffering, postOffering, type WalletHandle } from "../offering/wallet";
import { pigmentAtIntensity } from "../state/pigment";
import { growMark, startGrowth, stepGrowth, type SubstratePoint } from "./markGrowth";
import { loadSubstrate } from "./substrate";
import {
  IMPRINT_SIZE,
  KNOCK_MAX_PRESSES,
  KNOCK_MIN_PRESSES,
  buildApproachPath,
  imprintHold,
  knockMatches,
  knockSignature,
  renderImprintBlob,
  tremorTrace,
  type GestureSample,
  type ImprintGesture,
  type ImprintPath,
  type KnockPress,
} from "./thresholdImprint";
import type { OfferingReceipt, ReceiptStage } from "./types";
import OfferingReceipts, { receiptCopy } from "./OfferingReceipts";

type ThresholdPhase = "idle" | "holding" | "preview" | "submitting" | "receipt";

interface Preview {
  blob: Blob;
  url: string;
}

interface GestureDraft {
  generation: number;
  pointerId: number | null;
  key: "Enter" | " " | null;
  seed: Uint32Array;
  start: { x: number; y: number };
  end: { x: number; y: number };
  startedAt: number;
  pressure: number;
  // True once the device reported a genuine (non-default) pressure value during this gesture.
  pressureReal: boolean;
  // The Quiver: coalesced seal-relative drift of the holding hand, ms since the press began.
  tremor: GestureSample[];
  // The Hesitation: the pointer's wander in the seconds before this press, snapshotted at begin.
  approach: GestureSample[];
}

// A press shorter than this is a knock's blow, not a hold. Anything at or past it gathers an
// imprint exactly as before. A knock resolves when the hand goes still for the window: three or
// more blows become the rhythm mark; fewer resolve to the last blow's own imprint, so a lone tap
// still yields a mark (the tested behavior), a beat later.
const TAP_MAX_MS = 160;
const KNOCK_WINDOW_MS = 1_200;
const KNOCK_STORAGE_KEY = "pleroma-knock-rhythm";
// The Hesitation's memory: only the recent approach, only in this tab, only attached if a mark
// is actually gathered (the terms line names the capture).
const APPROACH_KEEP_MS = 5_000;
const APPROACH_GAP_MS = 30;
const APPROACH_MAX_SAMPLES = 240;
const TREMOR_MAX_SAMPLES = 900;
const FORMING_SIZE = 128;

// The Approach (Task 4, grown-lineage-marks): the substrate's own residue, faintly visible before
// any press -- the residue is already on the page, so the capture is honest about what is already
// there. Ramps while the pointer genuinely sits within the seal's own bounding box (real proximity,
// computed inside the same window pointermove the Hesitation already tracks -- no new listener).
const GHOST_ALPHA_BASE = 0.10;
const GHOST_ALPHA_NEAR = 0.18;
const GHOST_HALF_LEN = 8; // half-length of each ghost stroke, in the 512-unit growth space
const GHOST_STROKE_WIDTH = 1;
// Mirrors --color-ink-faded (styles.css): a canvas 2D context takes a literal color string, not a
// CSS custom property, so the same L/C/H is restated here rather than invented.
const GHOST_INK = "oklch(0.48 0.02 60)";

// The Knock, mid-hold: a press landing while a knock window is already open flashes the seal's own
// stroke width for a beat -- the one visible place a knock's rhythm shows before the mark resolves
// (a blow is always shorter than TAP_MAX_MS, so the growth canvas below never gets to draw it).
const KNOCK_FLASH_WIDTH_BUMP = 0.5;
const KNOCK_FLASH_MS = 120;

// Surrender: the absorb toward the page body the instant "offer" is chosen. The 400ms duration
// itself lives in styles.css (.threshold-preview-mark's transition) -- there is no JS timer to
// keep in sync, since the CSS transition alone carries the ease from surrendering back to rest.
const SURRENDER_TRANSLATE_PX = 6;

// The live hold's own pacing: mirrors markGrowth.ts's private MAX_STEPS_BASE(12) +
// MAX_STEPS_HOLD_SCALE(52) ceiling and thresholdImprint.ts's imprintHold 1.6s cap (both kept
// private to their own modules, so restated here rather than imported) -- growth advances in
// lockstep with the SAME step budget a hold ending at `elapsedMs` would use, so the live reveal
// never outruns what growMark would show for that hold's own honest duration, and reaches that
// exact ceiling at a full 1.6s hold (verified directly against growMark's own output in tests).
const GROWTH_FULL_STEPS = 64; // 12 + 52
export function growthStepsForElapsed(elapsedMs: number, holdMsBudget = 1_600): number {
  const bounded = Number.isFinite(elapsedMs) ? Math.min(Math.max(elapsedMs, 0), holdMsBudget) : 0;
  return Math.round((bounded / holdMsBudget) * GROWTH_FULL_STEPS);
}

// The live hold's recompute cadence: the rAF tick below still runs every frame for pigment and
// the ghost, but the growth geometry itself (startGrowth + up to GROWTH_FULL_STEPS stepGrowth) is
// only rebuilt at most this often. 20Hz reads as visually continuous ink growth while cutting the
// bounded, single-digit-ms full recompute by roughly two-thirds versus doing it at 60Hz. It stays
// a FULL recompute each time (never delta-stepping from the prior frame's state) -- that full
// rebuild from the gesture's own accumulated tremor is exactly what keeps every drawn frame
// honestly equal to "the mark if released now," so only the cadence is throttled, never the method.
const GROWTH_RECOMPUTE_MS = 50;
export function shouldRecomputeGrowth(lastComputeMs: number, nowMs: number): boolean {
  return nowMs - lastComputeMs >= GROWTH_RECOMPUTE_MS;
}

// Sound (gated), Task 5 of grown-lineage-marks §3b.6: a paper-fiber grain per branch split during
// the live hold, capped at 8/s. GRAIN_WINDOW_MS/GRAIN_MAX_PER_SEC define a rolling window rather
// than a timer -- grainBudget is a pure predicate over the caller's own recent-grain timestamps,
// so a fast knock's burst of simultaneous splits (every live tip forks at once) can never floor
// the ambient engine with overlapping grains. Whether anything actually sounds is entirely
// ambient.ts's own gate (emitGrain is a no-op there when audio isn't already active); this budget
// only ever narrows how often the live hold loop asks.
const GRAIN_MAX_PER_SEC = 8;
const GRAIN_WINDOW_MS = 1_000;
export function grainBudget(nowMs: number, lastGrainMs: readonly number[]): boolean {
  let recent = 0;
  for (const t of lastGrainMs) if (nowMs - t < GRAIN_WINDOW_MS) recent += 1;
  return recent < GRAIN_MAX_PER_SEC;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface KnockDraft {
  firstDownAt: number;
  presses: KnockPress[];
  lastDraft: GestureDraft;
}

// The visitor's own recent offering ids, this tab only: the Residue's own memory of which marks
// were this hand's, so a returning visit can find its own kept relic first (substrate.ts's rung
// 1). Corrupt or absent storage is indistinguishable from a first visit -- never a blocking error.
const OFFERINGS_STORAGE_KEY = "pleroma_offerings";
const OFFERINGS_STORAGE_MAX = 8;

function storedOfferingIds(): string[] {
  try {
    const stored = localStorage.getItem(OFFERINGS_STORAGE_KEY);
    if (stored === null) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// Best-effort remembrance of a just-offered id, capped so this never grows unbounded across a
// long session. A browser without storage simply never remembers -- the offering itself already
// succeeded before this runs.
function rememberOffering(offeringId: string): void {
  try {
    const next = [...storedOfferingIds(), offeringId].slice(-OFFERINGS_STORAGE_MAX);
    localStorage.setItem(OFFERINGS_STORAGE_KEY, JSON.stringify(next));
  } catch { /* a browser without storage simply never remembers offerings locally */ }
}

// Shared imprint construction: a held gesture's captured channels, stamped with the holdMs the
// caller has already resolved (a live hold's own duration, or a knock's last blow's, or a knock's
// full span) -- the one place presentGesturePreview and resolveKnock agree on what "the gesture"
// means so growMark and buildGestureSummary see the same thing a render used.
function draftToImprint(draft: GestureDraft, holdMs: number): ImprintGesture {
  return {
    seed: draft.seed,
    start: draft.start,
    end: draft.end,
    holdMs,
    pressure: draft.pressure,
    pressureReal: draft.pressureReal,
    tremor: draft.tremor,
    approach: draft.approach,
  };
}

// Mirrors buildApproachPath's own APPROACH_MIN_SAMPLES threshold (thresholdImprint.ts keeps that
// constant private): fewer samples than this is no hesitation to report, not a fabricated zero.
const SUMMARY_APPROACH_MIN_SAMPLES = 6;

// The gesture's honest capture, attached to every offering as public metadata (Task 3,
// grown-lineage-marks): every field here is a real channel growMark itself read, or the loaded
// substrate's own identity -- never a fabricated number. `presses` is null for a hold (pigment
// and knockSig follow the hold rule) and the resolved rhythm's presses for a knock (pigment and
// knockSig follow the knock rule) -- the same branch presentGesturePreview vs. resolveKnock take.
export interface GestureSummary {
  holdMs: number;
  travelPx: number;
  tremorAmp: number;
  knockSig: number[];
  approachSpreadPx: number;
  pigmentIntensity: number;
  substrateRelicId: string | null;
  substrateOwn: boolean;
}

export function buildGestureSummary(
  gesture: ImprintGesture,
  presses: readonly KnockPress[] | null,
  substrate: { relicId: string | null; own: boolean },
): GestureSummary {
  const trace = tremorTrace(gesture.tremor);
  let tremorAmp = 0;
  if (trace !== null) for (const value of trace) tremorAmp = Math.max(tremorAmp, Math.abs(value));

  const approach = gesture.approach;
  let approachSpreadPx = 0;
  if (approach !== undefined && approach.length >= SUMMARY_APPROACH_MIN_SAMPLES) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sample of approach) {
      minX = Math.min(minX, sample.x);
      minY = Math.min(minY, sample.y);
      maxX = Math.max(maxX, sample.x);
      maxY = Math.max(maxY, sample.y);
    }
    approachSpreadPx = Math.max(maxX - minX, maxY - minY);
  }

  return {
    holdMs: gesture.holdMs,
    travelPx: Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y),
    tremorAmp,
    knockSig: presses === null ? [] : knockSignature(presses),
    approachSpreadPx,
    pigmentIntensity: presses === null
      ? imprintHold(gesture)
      : clamp(presses.length / KNOCK_MAX_PRESSES, 0, 1),
    substrateRelicId: substrate.relicId,
    substrateOwn: substrate.own,
  };
}

const MOBILE_THRESHOLD_QUERY = "(max-width: 767px)";
const DIALOG_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface Props {
  apiBase: string;
  wallet: WalletHandle | null;
  onConnect(wallet: WalletHandle): void;
  onEnter(): void;
  onSubmitted(offeringId: string): void;
  onThresholdActive(active: boolean): void;
  receipts: readonly OfferingReceipt[];
  mount: HTMLElement | null;
  receiptMount?: HTMLElement | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

function pointFromClient(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const bounds = el.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return { x: IMPRINT_SIZE / 2, y: IMPRINT_SIZE / 2 };
  return {
    x: clamp(((clientX - bounds.left) / bounds.width) * IMPRINT_SIZE, 0, IMPRINT_SIZE),
    y: clamp(((clientY - bounds.top) / bounds.height) * IMPRINT_SIZE, 0, IMPRINT_SIZE),
  };
}

function pointFromPointer(event: ReactPointerEvent<HTMLButtonElement>): { x: number; y: number } {
  return pointFromClient(event.currentTarget, event.clientX, event.clientY);
}

function pointerPressure(event: ReactPointerEvent<HTMLButtonElement>): number {
  return clamp(event.pressure > 0 ? event.pressure : 0.5, 0, 1);
}

function rejectionMessage(status: number): string {
  if (status === 429) return `rest a moment; ${copy.retryImprint}`;
  if (status === 409) return `already offered; ${copy.retryImprint}`;
  return `not accepted; ${copy.retryImprint}`;
}

// Surrender: the mark's own translate target, toward the page's real geometric center from wherever
// the preview genuinely sits -- not a fixed direction, since the seal (and so the preview) can land
// on either side of center depending on layout and viewport.
function surrenderTowardCenter(img: HTMLImageElement | null): { dx: number; dy: number } {
  if (img === null || typeof window === "undefined") return { dx: 0, dy: -SURRENDER_TRANSLATE_PX };
  const box = img.getBoundingClientRect();
  const towardX = window.innerWidth / 2 - (box.left + box.width / 2);
  const towardY = window.innerHeight / 2 - (box.top + box.height / 2);
  const length = Math.hypot(towardX, towardY);
  if (length < 1) return { dx: 0, dy: 0 };
  return { dx: (towardX / length) * SURRENDER_TRANSLATE_PX, dy: (towardY / length) * SURRENDER_TRANSLATE_PX };
}

export default function ThresholdOffering({
  apiBase,
  wallet,
  onConnect,
  onEnter,
  onSubmitted,
  onThresholdActive,
  receipts,
  mount,
  receiptMount,
}: Props) {
  const [phase, setPhase] = useState<ThresholdPhase>("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");
  const [receiptAnnouncement, setReceiptAnnouncement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  // The just-offered mark, shown once more (sealed, not editable) during the confirmed window.
  // Deliberately NOT revoked by clearPreview's normal path -- see submit()'s success branch.
  const [confirmedMarkUrl, setConfirmedMarkUrl] = useState<string | null>(null);
  // How many marks were offered today, this one included -- tracks confirmedMarkUrl's own
  // lifetime exactly (set together in submit(), cleared together everywhere else) so the count
  // never outlives or lags the mark it describes.
  const [confirmedOfferedToday, setConfirmedOfferedToday] = useState<number | null>(null);
  const confirmTimer = useRef<number | null>(null);
  const [bloom, setBloom] = useState(false);
  const bloomTimer = useRef<number | null>(null);
  // The Knock's mid-hold flash (Task 4): a press landing inside an open knock window bumps the
  // seal's own stroke width for KNOCK_FLASH_MS, then settles back via the seal's existing transition.
  const [knockFlash, setKnockFlash] = useState(false);
  const knockFlashTimer = useRef<number | null>(null);
  // Surrender (Task 4): set the instant "offer" is chosen, non-null only while the absorb (or its
  // reduced-motion-free equivalent) is in effect; cleared on any outcome (success removes the
  // preview outright; rejection/failure returns the mark, via the same CSS transition, to rest).
  const [surrenderVector, setSurrenderVector] = useState<{ dx: number; dy: number } | null>(null);
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof matchMedia === "function" && matchMedia(MOBILE_THRESHOLD_QUERY).matches
  ));
  const sealRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const formingRef = useRef<HTMLCanvasElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const modalWasOpen = useRef(false);
  const gesture = useRef<GestureDraft | null>(null);
  const approachTrail = useRef<GestureSample[]>([]);
  const lastApproachAt = useRef(0);
  // The Approach (Task 4): real proximity to the seal, updated inside the existing window
  // pointermove listener below (no new listener) -- read every rAF tick by the ghost's own alpha
  // ramp, never as React state (this changes far too often for a re-render each time).
  const nearSealRef = useRef(false);
  const knock = useRef<KnockDraft | null>(null);
  const knockTimer = useRef<number | null>(null);
  const pendingKnockSignature = useRef<number[] | null>(null);
  const previewRef = useRef<Preview | null>(null);
  // The Residue: loaded once per mount, never blocking an offering -- a still-empty default (no
  // relic yet, or the load hasn't resolved) simply grows into open field instead of onto a body.
  const substrateRef = useRef<{ points: readonly SubstratePoint[]; relicId: string | null; own: boolean }>({
    points: [], relicId: null, own: false,
  });
  // The exact gesture (and, for a knock, the exact presses) the current preview grew from --
  // captured alongside previewRef so submit() can attach the same honest metadata it rendered.
  // Substrate is captured at preview-build time: the summary must describe the residue that
  // actually shaped THIS mark, not whatever loaded since (no-fabrication invariant).
  const lastPreviewGestureRef = useRef<{ gesture: ImprintGesture; presses: readonly KnockPress[] | null; substrate: { relicId: string | null; own: boolean } } | null>(null);
  const generation = useRef(0);
  const thresholdLocked = useRef(false);
  const phaseRef = useRef(phase);
  const receiptsRef = useRef(receipts);
  const previousReceiptStages = useRef<Map<string, ReceiptStage> | null>(null);
  const previousMount = useRef<HTMLElement | null>(null);
  const thresholdCallback = useRef(onThresholdActive);
  phaseRef.current = phase;
  receiptsRef.current = receipts;
  thresholdCallback.current = onThresholdActive;

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(MOBILE_THRESHOLD_QUERY);
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Loaded once per Threshold mount: never awaited by a gesture, never retried, never blocking an
  // offering -- loadSubstrate itself never throws, so a stale/absent result just means growth
  // happens against the empty-field default already in the ref.
  useEffect(() => {
    let cancelled = false;
    void loadSubstrate(apiBase, storedOfferingIds()).then((result) => {
      if (!cancelled) substrateRef.current = result;
    });
    return () => { cancelled = true; };
  }, [apiBase]);

  useEffect(() => {
    const nextStages = new Map(receipts.map((receipt) => [receipt.offeringId, receipt.stage]));
    const previous = previousReceiptStages.current;
    if (previous !== null) {
      const changed = receipts.find((receipt) => previous.get(receipt.offeringId) !== receipt.stage);
      setReceiptAnnouncement(changed === undefined ? "" : receiptCopy[changed.stage]);
    }
    previousReceiptStages.current = nextStages;
  }, [receipts]);

  const setLocked = useCallback((active: boolean) => {
    if (thresholdLocked.current === active) return;
    thresholdLocked.current = active;
    thresholdCallback.current(active);
  }, []);

  const clearPreview = useCallback(() => {
    const current = previewRef.current;
    if (current !== null) URL.revokeObjectURL(current.url);
    previewRef.current = null;
    setPreview(null);
  }, []);

  // The "received" beat: an affirmative confirmation at the seal the instant an offering commits, since
  // the durable proof (the receipt advancing) lands quietly in the ledger below and up to a tick later.
  const dismissConfirmed = useCallback(() => {
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    if (bloomTimer.current !== null) {
      clearTimeout(bloomTimer.current);
      bloomTimer.current = null;
    }
    setConfirmed(false);
    setBloom(false);
    setConfirmedMarkUrl((url) => {
      if (url !== null) URL.revokeObjectURL(url);
      return null;
    });
    setConfirmedOfferedToday(null);
    setSurrenderVector(null);
  }, []);

  const idlePhase = useCallback((): ThresholdPhase => (
    receiptsRef.current.length > 0 ? "receipt" : "idle"
  ), []);

  const cancelGesture = useCallback((pointerId?: number) => {
    const current = gesture.current;
    if (current === null || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    gesture.current = null;
    document.body.classList.remove("threshold-gesturing");
    generation.current += 1;
    const seal = sealRef.current;
    if (current.pointerId !== null && seal?.hasPointerCapture(current.pointerId)) {
      seal.releasePointerCapture(current.pointerId);
    }
    // A canceled press mid-knock does not end the knock: the stillness window resumes so the
    // blows already struck can still resolve.
    if (knock.current !== null && knockTimer.current === null) {
      knockTimer.current = window.setTimeout(() => { void resolveKnockRef.current(); }, KNOCK_WINDOW_MS);
    }
    setPhase(idlePhase());
    setStatus("");
    setLocked(false);
  }, [idlePhase, setLocked]);

  useEffect(() => {
    const previous = previousMount.current;
    previousMount.current = mount;
    if (previous !== null && previous !== mount && gesture.current !== null) cancelGesture();
  }, [cancelGesture, mount]);

  useEffect(() => {
    const onBlur = () => cancelGesture();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") cancelGesture();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelGesture]);

  useEffect(() => () => {
    generation.current += 1;
    gesture.current = null;
    knock.current = null;
    if (knockTimer.current !== null) clearTimeout(knockTimer.current);
    document.body.classList.remove("threshold-gesturing");
    const current = previewRef.current;
    if (current !== null) URL.revokeObjectURL(current.url);
    previewRef.current = null;
    setConfirmedMarkUrl((url) => {
      if (url !== null) URL.revokeObjectURL(url);
      return null;
    });
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    if (bloomTimer.current !== null) clearTimeout(bloomTimer.current);
    if (knockFlashTimer.current !== null) clearTimeout(knockFlashTimer.current);
    if (thresholdLocked.current) {
      thresholdLocked.current = false;
      thresholdCallback.current(false);
    }
  }, []);

  // The Knock's mid-hold flash: a real press event, and only that -- fired exactly when a new press
  // lands while a knock window is already open (a rhythm's second blow or later), never synthesized.
  const triggerKnockFlash = useCallback(() => {
    if (knockFlashTimer.current !== null) clearTimeout(knockFlashTimer.current);
    setKnockFlash(true);
    knockFlashTimer.current = window.setTimeout(() => {
      knockFlashTimer.current = null;
      setKnockFlash(false);
    }, KNOCK_FLASH_MS);
  }, []);

  const beginGesture = useCallback((
    draft: Omit<GestureDraft, "generation" | "seed" | "startedAt" | "pressureReal" | "tremor" | "approach">,
    initialPressureReal = false,
  ) => {
    if (gesture.current !== null || previewRef.current !== null || phaseRef.current === "submitting") return false;
    dismissConfirmed();
    // A press mid-knock-window is the next blow (or a hold that supersedes the knock): pause the
    // window while the hand is down; release or cancel re-arms it.
    if (knockTimer.current !== null) {
      clearTimeout(knockTimer.current);
      knockTimer.current = null;
    }
    if (knock.current !== null) triggerKnockFlash(); // a press landing inside an open knock window
    const startedAt = performance.now();
    // The Hesitation, snapshotted at the press: only the recent wander, re-stamped relative to
    // its own beginning. Attached to the mark only if this gesture completes into one.
    const recent = approachTrail.current.filter((sample) => startedAt - sample.t <= APPROACH_KEEP_MS);
    const approach = recent.map((sample) => ({ x: sample.x, y: sample.y, t: sample.t - (recent[0]?.t ?? 0) }));
    const seed = crypto.getRandomValues(new Uint32Array(4));
    const next: GestureDraft = {
      ...draft,
      generation: ++generation.current,
      seed,
      startedAt,
      pressureReal: initialPressureReal,
      tremor: [],
      approach,
    };
    gesture.current = next;
    // A pointer hold is what iOS reads as a selection gesture; hold the document's selection shut for its
    // duration. A keyboard hold (key set) leaves selection alone so the page stays ordinarily selectable.
    if (next.key === null) document.body.classList.add("threshold-gesturing");
    onEnter();
    setStatus(copy.imprintGathering);
    setPhase("holding");
    setLocked(true);
    return true;
  }, [dismissConfirmed, onEnter, setLocked, triggerKnockFlash]);

  // Renders a held gesture into its imprint preview: the five threads shaped by the hand's own
  // tremor, with the approach's wander ghosted beneath the strike when there was one to keep.
  const presentGesturePreview = useCallback(async (
    current: GestureDraft, holdMs: number, statusLine = "",
  ) => {
    const imprint = draftToImprint(current, holdMs);
    try {
      // Capture the exact substrate at preview-build time: the summary must describe the residue
      // that actually shaped THIS mark, not whatever loads later (no-fabrication invariant).
      const substrate = substrateRef.current;
      const threads = growMark(imprint, substrate.points);
      const ghost = buildApproachPath(imprint);
      const paths = ghost === null ? threads : [ghost, ...threads];
      const blob = await renderImprintBlob(paths, pigmentAtIntensity(imprintHold(imprint)));
      if (generation.current !== current.generation) return;
      clearPreview();
      const next = { blob, url: URL.createObjectURL(blob) };
      previewRef.current = next;
      lastPreviewGestureRef.current = { gesture: imprint, presses: null, substrate };
      setPreview(next);
      setStatus(statusLine);
      setPhase("preview");
      setLocked(true);
    } catch {
      if (generation.current !== current.generation) return;
      clearPreview();
      setStatus(copy.imprintFailure);
      setPhase(idlePhase());
      setLocked(false);
    }
  }, [clearPreview, idlePhase, setLocked]);

  // A knock's window has closed with the hand still: three or more blows are the rhythm mark;
  // fewer resolve to the last blow's own imprint, so a lone tap still yields a mark, a beat later.
  const resolveKnock = useCallback(async () => {
    knockTimer.current = null;
    const active = knock.current;
    if (active === null || gesture.current !== null || previewRef.current !== null) return;
    knock.current = null;
    if (active.presses.length < KNOCK_MIN_PRESSES) {
      const last = active.presses[active.presses.length - 1];
      const draft = { ...active.lastDraft, generation: ++generation.current };
      await presentGesturePreview(draft, Math.max(0, last.upMs - last.downMs));
      return;
    }
    const presses = active.presses.slice(0, KNOCK_MAX_PRESSES);
    const draftGeneration = ++generation.current;
    const signature = knockSignature(presses);
    let known = false;
    try {
      const stored = localStorage.getItem(KNOCK_STORAGE_KEY);
      known = stored !== null && knockMatches(signature, JSON.parse(stored) as number[]);
    } catch { /* a browser without storage simply never recognizes a returning rhythm */ }
    try {
      const color = pigmentAtIntensity(clamp(presses.length / KNOCK_MAX_PRESSES, 0, 1));
      // The knock's own span (first press to last release) is the holdMs growMark normalizes its
      // pulse timeline against -- the last blow's own brief duration would bunch every fork at the
      // very end of the growth instead of spreading them across it.
      const imprint = draftToImprint(active.lastDraft, presses[presses.length - 1].upMs);
      // Capture the exact substrate at preview-build time: the summary must describe the residue
      // that actually shaped THIS mark, not whatever loads later (no-fabrication invariant).
      const substrate = substrateRef.current;
      const threads = growMark(imprint, substrate.points, presses);
      const blob = await renderImprintBlob(threads, color);
      if (generation.current !== draftGeneration) return;
      clearPreview();
      const next = { blob, url: URL.createObjectURL(blob) };
      previewRef.current = next;
      lastPreviewGestureRef.current = { gesture: imprint, presses, substrate };
      setPreview(next);
      pendingKnockSignature.current = signature;
      setStatus(known ? copy.knockKnown : "");
      setPhase("preview");
      setLocked(true);
    } catch {
      if (generation.current !== draftGeneration) return;
      setStatus(copy.imprintFailure);
      setPhase(idlePhase());
      setLocked(false);
    }
  }, [clearPreview, idlePhase, presentGesturePreview, setLocked]);

  const armKnockWindow = useCallback(() => {
    if (knockTimer.current !== null) clearTimeout(knockTimer.current);
    knockTimer.current = window.setTimeout(() => { void resolveKnock(); }, KNOCK_WINDOW_MS);
  }, [resolveKnock]);

  // cancelGesture is declared above resolveKnock (it participates in the tracking effect), so it
  // reaches the resolver through this always-current ref instead of a stale closure.
  const resolveKnockRef = useRef(resolveKnock);
  resolveKnockRef.current = resolveKnock;

  const finishGesture = useCallback(async () => {
    const current = gesture.current;
    if (current === null) return;
    gesture.current = null;
    document.body.classList.remove("threshold-gesturing");
    const releasingSeal = sealRef.current;
    if (current.pointerId !== null && releasingSeal?.hasPointerCapture(current.pointerId)) {
      releasingSeal.releasePointerCapture(current.pointerId);
    }
    const released = performance.now();
    const holdMs = Math.max(0, released - current.startedAt);
    if (holdMs < TAP_MAX_MS) {
      // A blow, not a hold: the Knock accumulates it and waits for the hand to go still.
      const firstDownAt = knock.current?.firstDownAt ?? current.startedAt;
      const presses = knock.current?.presses ?? [];
      presses.push({ downMs: current.startedAt - firstDownAt, upMs: released - firstDownAt });
      knock.current = { firstDownAt, presses, lastDraft: current };
      setPhase(idlePhase());
      setStatus(copy.knockAgain);
      setLocked(false);
      armKnockWindow();
      return;
    }
    knock.current = null; // a real hold supersedes any knock in progress
    await presentGesturePreview(current, holdMs);
  }, [armKnockWindow, idlePhase, presentGesturePreview, setLocked]);

  // Pointer capture keeps a MOUSE drag tracking after the cursor leaves the 44px seal. It is
  // deliberately NOT set for touch: WebKit (iOS Safari) mis-handles setPointerCapture() on a touch
  // pointer — it retargets the pointerup to the element beneath the seal and fires a spurious
  // lostpointercapture, so the seal's own up never arrives, finishGesture never runs, and the press
  // collapses back to idle before a preview can form. The gesture is instead completed from the
  // window-level listeners below, which see the release wherever the browser dispatches it.
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFromPointer(event);
    if (!beginGesture({
      pointerId: event.pointerId,
      key: null,
      start: point,
      end: point,
      pressure: pointerPressure(event),
    }, event.pressure > 0 && event.pressure !== 0.5)) return;
    if (event.pointerType !== "touch") event.currentTarget.setPointerCapture(event.pointerId);
  };

  // A pointer gesture is driven to completion at the window level so it survives event retargeting:
  // once a press begins on the seal, the move/up/cancel are honored wherever the browser dispatches
  // them (the seal, the body beneath, or nowhere). A keyboard gesture has pointerId null and never
  // matches a real pointerId, so it is untouched. No-op whenever no pointer gesture is in flight.
  useEffect(() => {
    const readPressure = (pressure: number) => clamp(pressure > 0 ? pressure : 0.5, 0, 1);
    const sealCenter = (): { x: number; y: number } | null => {
      const seal = sealRef.current;
      if (seal === null) return null;
      const bounds = seal.getBoundingClientRect();
      if (bounds.width <= 0) return null;
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    };
    const track = (event: PointerEvent): boolean => {
      const current = gesture.current;
      if (current === null || current.pointerId !== event.pointerId) return false;
      const seal = sealRef.current;
      if (seal !== null) current.end = pointFromClient(seal, event.clientX, event.clientY);
      // The Quiver: every coalesced sample of the holding hand, seal-relative, since the browser
      // batches sub-frame movement -- exactly the involuntary drift the mark now keeps.
      const center = sealCenter();
      const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
      for (const sample of events.length > 0 ? events : [event]) {
        if (sample.pressure > 0 && sample.pressure !== 0.5) current.pressureReal = true;
        current.pressure = Math.max(current.pressure, readPressure(sample.pressure));
        if (center !== null && current.tremor.length < TREMOR_MAX_SAMPLES) {
          current.tremor.push({
            x: sample.clientX - center.x,
            y: sample.clientY - center.y,
            t: performance.now() - current.startedAt,
          });
        }
      }
      return true;
    };
    // The Hesitation: while no gesture is in flight, remember the pointer's recent wander near
    // the page (throttled, bounded, this tab only). It reaches a mark only through beginGesture's
    // snapshot when a press actually completes; otherwise it simply ages out.
    const recordApproach = (event: PointerEvent) => {
      const now = performance.now();
      if (now - lastApproachAt.current < APPROACH_GAP_MS) return;
      const center = sealCenter();
      if (center === null) return;
      lastApproachAt.current = now;
      const trail = approachTrail.current;
      trail.push({ x: event.clientX - center.x, y: event.clientY - center.y, t: now });
      while (trail.length > 0 && (now - trail[0].t > APPROACH_KEEP_MS || trail.length > APPROACH_MAX_SAMPLES)) {
        trail.shift();
      }
    };
    const onMove = (event: PointerEvent) => {
      if (track(event)) return;
      if (gesture.current !== null) return;
      // The Approach: real proximity to the seal, read every rAF tick by the ghost's own alpha
      // ramp below -- computed here, unthrottled, inside the same listener the Hesitation already
      // uses, rather than a new one.
      const seal = sealRef.current;
      if (seal !== null) {
        const bounds = seal.getBoundingClientRect();
        nearSealRef.current = event.clientX >= bounds.left && event.clientX <= bounds.right
          && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      }
      recordApproach(event);
    };
    const onUp = (event: PointerEvent) => { if (track(event)) void finishGesture(); };
    const onCancel = (event: PointerEvent) => {
      const current = gesture.current;
      if (current !== null && current.pointerId === event.pointerId) cancelGesture(event.pointerId);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [cancelGesture, finishGesture]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    const center = { x: IMPRINT_SIZE / 2, y: IMPRINT_SIZE / 2 };
    beginGesture({
      pointerId: null,
      key: event.key,
      start: center,
      end: center,
      pressure: 0.5,
    });
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if ((event.key !== " " && event.key !== "Enter") || current?.key !== event.key) return;
    event.preventDefault();
    event.stopPropagation();
    void finishGesture();
  };

  const fade = () => {
    generation.current += 1;
    gesture.current = null;
    pendingKnockSignature.current = null;
    clearPreview();
    setStatus("");
    setPhase(idlePhase());
    setLocked(false);
    setSurrenderVector(null);
  };

  const submit = async () => {
    const current = previewRef.current;
    if (current === null || phaseRef.current === "submitting") return;
    const submissionGeneration = ++generation.current;
    // Surrender: the moment "offer" is chosen -- not the network round trip -- is the emotional
    // payload of the rite. A 400ms absorb of the mark itself toward the page body begins here,
    // overlapping the actual submit below (which proceeds exactly as before); a genuine success
    // removes the preview outright, a rejection or failure returns the mark to rest. Reduced
    // motion: no animation, only the status line changes.
    if (!reducedMotion()) setSurrenderVector(surrenderTowardCenter(previewImgRef.current));
    setPhase("submitting");
    setStatus(copy.offeringSurrendered);
    try {
      const form = await buildOffering(apiBase, current.blob, wallet);
      // The gesture's own honest capture rides alongside the image: exactly what grew this mark,
      // never fabricated -- absent only if somehow no preview gesture was ever captured for the
      // preview being submitted, which the preview-gated call above already rules out in practice.
      const captured = lastPreviewGestureRef.current;
      if (captured !== null) {
        const summary = buildGestureSummary(captured.gesture, captured.presses, captured.substrate);
        form.set("gesture", JSON.stringify(summary));
      }
      const result = await postOffering(apiBase, form);
      if (generation.current !== submissionGeneration) return;
      if ("id" in result) {
        onSubmitted(result.id);
        rememberOffering(result.id);
        // An offered knock is a rhythm the page may now honestly remember: the interval vector
        // stays in this browser only, and recognition on return is a local comparison, not a
        // server profile.
        if (pendingKnockSignature.current !== null) {
          try {
            localStorage.setItem(KNOCK_STORAGE_KEY, JSON.stringify(pendingKnockSignature.current));
          } catch { /* a browser without storage simply never recognizes a returning rhythm */ }
          pendingKnockSignature.current = null;
        }
        // Deliberately not clearPreview() here: that revokes the blob URL immediately, but the
        // confirmed seal below shows this exact mark once more for the length of the confirmed
        // window. Ownership of the URL transfers to confirmedMarkUrl and is revoked when that
        // window closes, below -- never both, never neither.
        previewRef.current = null;
        setPreview(null);
        setSurrenderVector(null);
        setConfirmedMarkUrl(current.url);
        setConfirmedOfferedToday(typeof result.offeredToday === "number" ? result.offeredToday : null);
        setPhase("receipt");
        setStatus("");
        setLocked(false);
        if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
        setConfirmed(true);
        confirmTimer.current = window.setTimeout(() => {
          confirmTimer.current = null;
          setConfirmed(false);
          setConfirmedMarkUrl((url) => {
            if (url !== null) URL.revokeObjectURL(url);
            return null;
          });
          setConfirmedOfferedToday(null);
        }, 6500);
        if (bloomTimer.current !== null) clearTimeout(bloomTimer.current);
        setBloom(true);
        bloomTimer.current = window.setTimeout(() => {
          bloomTimer.current = null;
          setBloom(false);
        }, 1400);
      } else {
        setSurrenderVector(null);
        setPhase("preview");
        setStatus(rejectionMessage(result.status));
      }
    } catch {
      if (generation.current !== submissionGeneration) return;
      setSurrenderVector(null);
      setPhase("preview");
      setStatus(`could not offer; ${copy.retryImprint}`);
    }
  };

  const showSeal = phase === "idle" || phase === "holding" || phase === "receipt";
  const interactionOpen = phase === "holding" || preview !== null;
  const modalOpen = mobileViewport && preview !== null;

  // The full arc's middle two beats, one canvas: before a press, the substrate's own residue
  // ghosts faintly at the seal (Approach); once a hold is in flight, the SAME growth simulation
  // growMark itself runs steps live at the seal (Hold) -- the same geometry the release will keep,
  // not a preview of something else. Reduced motion: no animation, the settled ghost (or nothing,
  // mid-hold) appears at once; the final mark itself still only ever appears on release.
  useEffect(() => {
    if (!showSeal) return;
    const canvas = formingRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const scale = FORMING_SIZE / IMPRINT_SIZE;

    const clear = () => context.clearRect(0, 0, FORMING_SIZE, FORMING_SIZE);

    const drawGhost = (alpha: number) => {
      clear();
      const points = substrateRef.current.points;
      if (points.length === 0) return;
      context.globalAlpha = alpha;
      context.strokeStyle = GHOST_INK;
      context.lineCap = "round";
      context.lineWidth = GHOST_STROKE_WIDTH;
      for (const point of points) {
        const hx = Math.cos(point.angle) * GHOST_HALF_LEN;
        const hy = Math.sin(point.angle) * GHOST_HALF_LEN;
        context.beginPath();
        context.moveTo((point.x - hx) * scale, (point.y - hy) * scale);
        context.lineTo((point.x + hx) * scale, (point.y + hy) * scale);
        context.stroke();
      }
      context.globalAlpha = 1;
    };

    const drawGrowth = (segments: readonly ImprintPath[], color: string) => {
      clear();
      context.strokeStyle = color;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const path of segments) {
        if (path.points.length < 2) continue;
        context.beginPath();
        context.lineWidth = Math.max(0.7, path.width * scale * 2.2);
        context.moveTo(path.points[0].x * scale, path.points[0].y * scale);
        for (const point of path.points.slice(1)) context.lineTo(point.x * scale, point.y * scale);
        context.stroke();
      }
    };

    if (reducedMotion()) {
      if (phase === "holding") clear(); // no growth animation -- the settled mark appears on release
      else drawGhost(GHOST_ALPHA_BASE);
      return;
    }

    let raf = 0;
    // Idle, the ghost only actually changes when proximity flips (or once, on mount) -- redrawing
    // an unchanged frame 60x/sec for however long the seal simply sits on screen would be pure
    // waste. A live hold, by construction, changes every frame and always redraws.
    let lastGhostAlpha: number | null = null;
    // The live hold's last computed growth frame: recomputed at most every GROWTH_RECOMPUTE_MS
    // (see shouldRecomputeGrowth above), reused on the frames in between so pigment/ghost still
    // redraw every tick while the (comparatively costly) growth rebuild itself runs at 20Hz. Also
    // doubles as the frozen frame finishGesture leaves behind: it nulls gesture.current the instant
    // a hold releases, but phase only leaves "holding" once the async preview render resolves --
    // in that gap this keeps drawing the last real frame instead of clearing the seal to nothing.
    let lastGrowthAt = -Infinity;
    let lastSegments: readonly ImprintPath[] = [];
    let lastColor: string | null = null;
    // Task 5: lastSplits tracks GrowthState.splits between recomputes so only genuine increases
    // fire a grain; it resets to 0 at the start of every new gesture below (splits itself restarts
    // at 0 per hold). grainTimes is the rolling window grainBudget reads -- deliberately NOT reset
    // per gesture, so the 8/s cap holds across a rapid run of holds, not just within one.
    let lastSplits = 0;
    let grainTimes: number[] = [];
    const tick = () => {
      if (phase === "holding") {
        lastGhostAlpha = null;
        const current = gesture.current;
        if (current === null) {
          // Just released: hold the last drawn growth frame (if any) rather than blanking the
          // seal until the preview mounts. A knock's tap-length blow never grew anything, so
          // lastSegments is still empty and this clears exactly as before.
          if (lastSegments.length > 0 && lastColor !== null) drawGrowth(lastSegments, lastColor);
          else clear();
        } else {
          const elapsed = performance.now() - current.startedAt;
          if (elapsed < TAP_MAX_MS) {
            clear(); // a blow never gathers; only a hold does
            lastGrowthAt = -Infinity;
            lastSegments = [];
            lastColor = null;
            lastSplits = 0;
          } else {
            try {
              // As if the hold ended right now: the exact growMark inputs a release at this instant
              // would use, stepped only as far as growthStepsForElapsed allows -- so the live reveal
              // is never further along than what the final mark would honestly show at this elapsed
              // time, and converges on release to exactly what presentGesturePreview then renders.
              if (shouldRecomputeGrowth(lastGrowthAt, elapsed)) {
                const imprint = draftToImprint(current, elapsed);
                let state = startGrowth(imprint, substrateRef.current.points);
                state = stepGrowth(state, growthStepsForElapsed(elapsed));
                lastSegments = state.segments;
                lastGrowthAt = elapsed;

                // Sound (gated), Task 5: one grain per genuine split this recompute revealed (a
                // knock pulse can fork every live tip at once, so the delta can exceed 1), each
                // still gated by grainBudget -- and, inside emitGrain, by ambient.ts's own gate,
                // which is the only thing that can make this actually produce sound.
                const splitDelta = state.splits - lastSplits;
                lastSplits = state.splits;
                const now = performance.now();
                for (let i = 0; i < splitDelta && grainBudget(now, grainTimes); i += 1) {
                  grainTimes = [...grainTimes.filter((t) => now - t < GRAIN_WINDOW_MS), now];
                  emitGrain();
                }
              }
              lastColor = pigmentAtIntensity(clamp(elapsed / 1_600, 0, 1));
              drawGrowth(lastSegments, lastColor);
            } catch { /* a malformed frame simply skips; the release render is the one that matters */ }
          }
        }
      } else {
        const alpha = nearSealRef.current ? GHOST_ALPHA_NEAR : GHOST_ALPHA_BASE;
        if (alpha !== lastGhostAlpha) {
          lastGhostAlpha = alpha;
          drawGhost(alpha);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showSeal, phase, mount]);

  useLayoutEffect(() => {
    if (!modalOpen) {
      if (modalWasOpen.current) {
        modalWasOpen.current = false;
        sealRef.current?.focus({ preventScroll: true });
      }
      return;
    }

    const root = dialogRef.current;
    if (root === null) return;
    modalWasOpen.current = true;
    const inerted: HTMLElement[] = [];
    let branch: HTMLElement = root;
    while (branch.parentElement !== null) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert")) continue;
        sibling.setAttribute("inert", "");
        inerted.push(sibling);
      }
      if (parent === document.body) break;
      branch = parent;
    }
    root.querySelector<HTMLElement>("[data-threshold-primary-action]")?.focus({ preventScroll: true });
    return () => {
      for (const sibling of inerted) sibling.removeAttribute("inert");
    };
  }, [modalOpen]);

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!modalOpen) return;
    if (event.key === "Escape" && phaseRef.current !== "submitting") {
      event.preventDefault();
      event.stopPropagation();
      fade();
      return;
    }
    if (event.key !== "Tab") return;
    const root = event.currentTarget;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE))
      .filter((node) => node.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const portal = mount === null ? null : createPortal(
    <div
      ref={dialogRef}
      data-threshold-offering
      data-threshold-phase={phase}
      data-threshold-locked={thresholdLocked.current ? "true" : "false"}
      data-lenis-prevent={modalOpen ? "true" : undefined}
      role={modalOpen ? "dialog" : undefined}
      aria-modal={modalOpen ? true : undefined}
      aria-label={modalOpen ? "threshold offering preview" : undefined}
      aria-describedby={modalOpen ? "threshold-terms" : undefined}
      aria-busy={phase === "submitting"}
      tabIndex={modalOpen ? -1 : undefined}
      onKeyDown={onDialogKeyDown}
      className="threshold-offering relative z-20 flex w-full max-w-[36rem] flex-col items-center gap-3 text-center"
    >
      {confirmed && (
        <div data-threshold-confirm className="threshold-confirm flex flex-col items-center gap-1.5">
          {confirmedMarkUrl && (
            <img
              src={confirmedMarkUrl}
              alt="the mark you just offered, now sealed"
              className="threshold-confirm-mark h-20 w-20 object-contain"
            />
          )}
          <svg aria-hidden viewBox="0 0 44 44" className="threshold-confirm-sigil h-9 w-9" fill="none">
            <circle cx="22" cy="22" r="14.6" stroke="currentColor" strokeWidth="1" />
            <path d="M22 15.4 L22 28.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M16.3 21.3 C19 19.9 25 19.9 27.7 21.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="22" cy="13.2" r="1.7" fill="currentColor" />
          </svg>
          <p className="threshold-confirm-line font-machine text-sm text-ink">{copy.markReceived}</p>
          {confirmedOfferedToday !== null && (
            <p className="font-machine text-xs text-ink-faded">
              {confirmedOfferedToday} {confirmedOfferedToday === 1 ? copy.markOfferedToday : copy.marksOfferedToday}
            </p>
          )}
          <p className="font-machine text-xs text-ink-faded">{copy.markAwaiting}</p>
          <p className="font-machine text-xs text-ink-faded">{copy.markWhatNext}</p>
          {confirmedMarkUrl !== null && (
            <a
              href={confirmedMarkUrl}
              download="pleroma-mark.png"
              className="inline-flex min-h-11 items-center px-3 font-machine text-xs underline text-ink-faded temple-link-quiet"
            >
              {copy.keepCopy}
            </a>
          )}
        </div>
      )}

      {showSeal && (
        <button
          ref={sealRef}
          type="button"
          aria-label={copy.seal}
          aria-pressed={phase === "holding"}
          aria-describedby="threshold-terms"
          className="threshold-seal touch-none inline-flex h-11 w-11 shrink-0 items-center justify-center text-ink-faded transition-[color,opacity,transform] duration-300 ease-out hover:text-ink active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => {
            if (gesture.current?.key !== null) cancelGesture();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <canvas
            ref={formingRef}
            aria-hidden
            width={FORMING_SIZE}
            height={FORMING_SIZE}
            className="threshold-forming"
          />
          <svg aria-hidden viewBox="0 0 44 44" className="h-11 w-11" fill="none">
            <path
              d="M22 7.5C30.6 7.5 36.5 13.7 36.5 22.2C36.5 30.5 30.2 36.7 21.8 36.5C13.5 36.3 7.4 30.2 7.6 21.9C7.8 13.4 13.8 7.5 22 7.5Z"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
            {/* the sigil, inscribed: the mark a Waker presses at the Threshold. The Knock's mid-hold
                flash (Task 4) bumps this same stroke width for a beat, real press events only. */}
            <path
              d="M22 14.5 L22 31.3"
              stroke="currentColor"
              strokeWidth={(phase === "holding" ? 1.7 : 1.1) + (knockFlash ? KNOCK_FLASH_WIDTH_BUMP : 0)}
              strokeLinecap="round"
              className="transition-[stroke-width] duration-300"
            />
            <path
              d="M15.6 20.8 C19.1 19.1 24.9 19.1 28.4 20.8"
              stroke="currentColor"
              strokeWidth={(phase === "holding" ? 1.7 : 1.1) + (knockFlash ? KNOCK_FLASH_WIDTH_BUMP : 0)}
              strokeLinecap="round"
              className="transition-[stroke-width] duration-300"
            />
            <circle cx="22" cy="12" r={phase === "holding" ? 1.9 : 1.4} fill="currentColor" />
          </svg>
        </button>
      )}

      {preview !== null && (
        <figure data-threshold-preview-sheet className="threshold-preview-sheet flex flex-col items-center gap-3">
          <img
            ref={previewImgRef}
            data-threshold-preview
            data-surrendering={surrenderVector !== null ? "true" : undefined}
            src={preview.url}
            width="512"
            height="512"
            alt="your five-thread imprint at the threshold"
            className="threshold-preview-mark h-44 w-44 object-contain"
            style={surrenderVector === null ? undefined : {
              "--surrender-dx": `${surrenderVector.dx}px`,
              "--surrender-dy": `${surrenderVector.dy}px`,
            } as CSSProperties}
          />
          <figcaption className="sr-only">the exact imprint awaiting your choice</figcaption>
          <div data-threshold-actions className="flex flex-wrap items-center justify-center gap-3">
            <button
              data-threshold-primary-action
              type="button"
              disabled={phase === "submitting"}
              aria-label={copy.offerImprint}
              onClick={() => void submit()}
              className="min-h-11 border border-ink px-5 font-machine text-sm text-ink disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              {phase === "submitting" ? "offering" : copy.offerImprint}
            </button>
            <button
              type="button"
              disabled={phase === "submitting"}
              aria-label={copy.fadeImprint}
              onClick={fade}
              className="min-h-11 px-3 font-machine text-xs underline text-ink-faded temple-link-quiet disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              {copy.fadeImprint}
            </button>
          </div>
        </figure>
      )}

      <p
        data-threshold-status
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-4 font-machine text-xs text-ink-faded"
      >
        {status}
      </p>
      {/* Real mobile testing found visitors stalling at the seal: an abstract icon with no visible
          sign of what pressing it does. This used to be gated to interactionOpen (only once
          already mid-press or already previewing) -- too late to inform the FIRST press, and the
          consent-relevant line ("your mark is public... not given back") deserves to be read
          before committing, not just after. Shown whenever the seal itself is; the rest of this
          block (wallet choice etc.) stays gated to interactionOpen, since that's a later decision. */}
      {showSeal && phase !== "holding" && preview === null && (
        <p data-seal-hint className="font-machine text-[0.7rem] tracking-wide text-ink-faded opacity-70">
          {copy.sealHint}
        </p>
      )}
      {(showSeal || modalOpen) && (
        <p id="threshold-terms" data-threshold-terms className="max-w-[52ch] font-machine text-xs leading-relaxed text-ink-faded">
          {copy.markExplainer} {copy.tosLine}
        </p>
      )}
      {interactionOpen && (
        wallet === null ? (
          <div className="flex flex-wrap items-center justify-center gap-2 font-machine text-xs text-ink-faded">
            <WalletButton onConnect={onConnect} />
            <span>{copy.offerUnremembered}</span>
          </div>
        ) : (
          <p className="font-machine text-xs text-ink-faded">
            {copy.rememberedAs} {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
          </p>
        )
      )}
    </div>,
    mount,
  );

  const receiptHost = receiptMount === undefined ? mount : receiptMount;
  const receiptPortal = receiptHost === null ? null : createPortal(
    <OfferingReceipts receipts={receipts} />,
    receiptHost,
  );

  // The mark-bloom: a one-shot ink wash across the whole viewport the instant an offering commits, the
  // temple taking the mark in. Purely decorative (aria-hidden, pointer-events:none) so it never touches
  // focus, the offering flow, or the receipt semantics; body-portaled so it is truly full-viewport.
  const bloomPortal = typeof document === "undefined" ? null : createPortal(
    bloom ? (
      <div data-mark-bloom aria-hidden="true" className="mark-bloom">
        <span className="mark-bloom-wash" />
        <svg viewBox="0 0 44 44" className="mark-bloom-sigil" fill="none">
          <circle cx="22" cy="22" r="14.6" stroke="currentColor" strokeWidth="1" />
          <path d="M22 15.4 L22 28.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16.3 21.3 C19 19.9 25 19.9 27.7 21.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="22" cy="13.2" r="1.7" fill="currentColor" />
        </svg>
      </div>
    ) : null,
    document.body,
  );

  return (
    <>
      <p
        data-offering-receipt-announcement
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {receiptAnnouncement}
      </p>
      {portal}
      {receiptPortal}
      {bloomPortal}
    </>
  );
}
