import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { copy } from "../lib/copy";
import WalletButton from "../offering/WalletButton";
import { buildOffering, postOffering, type WalletHandle } from "../offering/wallet";
import { pigmentAtIntensity } from "../state/pigment";
import {
  IMPRINT_SIZE,
  buildImprintPaths,
  imprintHold,
  renderImprintBlob,
  type ImprintGesture,
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
  const [mobileViewport, setMobileViewport] = useState(() => (
    typeof matchMedia === "function" && matchMedia(MOBILE_THRESHOLD_QUERY).matches
  ));
  const sealRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalWasOpen = useRef(false);
  const gesture = useRef<GestureDraft | null>(null);
  const previewRef = useRef<Preview | null>(null);
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
    if (thresholdLocked.current) {
      thresholdLocked.current = false;
      thresholdCallback.current(false);
    }
  }, []);

  const beginGesture = useCallback((draft: Omit<GestureDraft, "generation" | "seed" | "startedAt">) => {
    if (gesture.current !== null || previewRef.current !== null || phaseRef.current === "submitting") return false;
    dismissConfirmed();
    const seed = crypto.getRandomValues(new Uint32Array(4));
    const next: GestureDraft = {
      ...draft,
      generation: ++generation.current,
      seed,
      startedAt: performance.now(),
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
  }, [dismissConfirmed, onEnter, setLocked]);

  const finishGesture = useCallback(async () => {
    const current = gesture.current;
    if (current === null) return;
    gesture.current = null;
    document.body.classList.remove("threshold-gesturing");
    const releasingSeal = sealRef.current;
    if (current.pointerId !== null && releasingSeal?.hasPointerCapture(current.pointerId)) {
      releasingSeal.releasePointerCapture(current.pointerId);
    }
    const imprint: ImprintGesture = {
      seed: current.seed,
      start: current.start,
      end: current.end,
      holdMs: Math.max(0, performance.now() - current.startedAt),
      pressure: current.pressure,
    };
    try {
      const blob = await renderImprintBlob(buildImprintPaths(imprint), pigmentAtIntensity(imprintHold(imprint)));
      if (generation.current !== current.generation) return;
      clearPreview();
      const next = { blob, url: URL.createObjectURL(blob) };
      previewRef.current = next;
      setPreview(next);
      setStatus("");
      setPhase("preview");
    } catch {
      if (generation.current !== current.generation) return;
      clearPreview();
      setStatus(copy.imprintFailure);
      setPhase(idlePhase());
      setLocked(false);
    }
  }, [clearPreview, idlePhase, setLocked]);

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
    })) return;
    if (event.pointerType !== "touch") event.currentTarget.setPointerCapture(event.pointerId);
  };

  // A pointer gesture is driven to completion at the window level so it survives event retargeting:
  // once a press begins on the seal, the move/up/cancel are honored wherever the browser dispatches
  // them (the seal, the body beneath, or nowhere). A keyboard gesture has pointerId null and never
  // matches a real pointerId, so it is untouched. No-op whenever no pointer gesture is in flight.
  useEffect(() => {
    const readPressure = (pressure: number) => clamp(pressure > 0 ? pressure : 0.5, 0, 1);
    const track = (event: PointerEvent): boolean => {
      const current = gesture.current;
      if (current === null || current.pointerId !== event.pointerId) return false;
      const seal = sealRef.current;
      if (seal !== null) current.end = pointFromClient(seal, event.clientX, event.clientY);
      current.pressure = Math.max(current.pressure, readPressure(event.pressure));
      return true;
    };
    const onMove = (event: PointerEvent) => { track(event); };
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
    clearPreview();
    setStatus("");
    setPhase(idlePhase());
    setLocked(false);
  };

  const submit = async () => {
    const current = previewRef.current;
    if (current === null || phaseRef.current === "submitting") return;
    const submissionGeneration = ++generation.current;
    setPhase("submitting");
    setStatus("");
    try {
      const form = await buildOffering(apiBase, current.blob, wallet);
      const result = await postOffering(apiBase, form);
      if (generation.current !== submissionGeneration) return;
      if ("id" in result) {
        onSubmitted(result.id);
        // Deliberately not clearPreview() here: that revokes the blob URL immediately, but the
        // confirmed seal below shows this exact mark once more for the length of the confirmed
        // window. Ownership of the URL transfers to confirmedMarkUrl and is revoked when that
        // window closes, below -- never both, never neither.
        previewRef.current = null;
        setPreview(null);
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
        setPhase("preview");
        setStatus(rejectionMessage(result.status));
      }
    } catch {
      if (generation.current !== submissionGeneration) return;
      setPhase("preview");
      setStatus(`could not offer; ${copy.retryImprint}`);
    }
  };

  const showSeal = phase === "idle" || phase === "holding" || phase === "receipt";
  const interactionOpen = phase === "holding" || preview !== null;
  const modalOpen = mobileViewport && preview !== null;

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
          <svg aria-hidden viewBox="0 0 44 44" className="h-11 w-11" fill="none">
            <path
              d="M22 7.5C30.6 7.5 36.5 13.7 36.5 22.2C36.5 30.5 30.2 36.7 21.8 36.5C13.5 36.3 7.4 30.2 7.6 21.9C7.8 13.4 13.8 7.5 22 7.5Z"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
            {/* the sigil, inscribed: the mark a Waker presses at the Threshold */}
            <path
              d="M22 14.5 L22 31.3"
              stroke="currentColor"
              strokeWidth={phase === "holding" ? 1.7 : 1.1}
              strokeLinecap="round"
              className="transition-[stroke-width] duration-300"
            />
            <path
              d="M15.6 20.8 C19.1 19.1 24.9 19.1 28.4 20.8"
              stroke="currentColor"
              strokeWidth={phase === "holding" ? 1.7 : 1.1}
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
            data-threshold-preview
            src={preview.url}
            width="512"
            height="512"
            alt="your five-thread imprint at the threshold"
            className="h-44 w-44 object-contain"
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
