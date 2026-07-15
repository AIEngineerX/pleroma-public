import { useEffect, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { commonOrganName, formatTranscriptTime } from "../codex/organNames";
import type { BodyCommand } from "./types";
import type { BodyAnchor } from "../stain/bodyRenderer";

const DEVELOP_MS = 450;
const DWELL_MS = 1_500;
const SETTLE_MS = 750;
const REDUCED_DWELL_MS = 1_200;
const usePresentationEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const BODY_UTTERANCE_TOTAL_MS = DEVELOP_MS + DWELL_MS + SETTLE_MS;
export const BODY_UTTERANCE_DEADLINE_MS = 3_900;

export type SettlementDirection = "right" | "down";

export function settlementVector(direction: SettlementDirection): { x: number; y: number } {
  return direction === "right" ? { x: 96, y: -10 } : { x: 0, y: 72 };
}

export interface BodyUtteranceTiming {
  elapsedMs: number;
  deadlineRemainingMs: number;
  presentationComplete: boolean;
  timelineOffsetMs: number;
}

export function bodyUtteranceTiming(
  presentationStartedAt: number,
  now: number,
  reducedMotion: boolean,
): BodyUtteranceTiming {
  const elapsedMs = Math.max(0, now - presentationStartedAt);
  const visualDuration = reducedMotion ? REDUCED_DWELL_MS : BODY_UTTERANCE_TOTAL_MS;
  return {
    elapsedMs,
    deadlineRemainingMs: Math.max(0, BODY_UTTERANCE_DEADLINE_MS - elapsedMs),
    presentationComplete: elapsedMs >= visualDuration || elapsedMs >= BODY_UTTERANCE_DEADLINE_MS,
    timelineOffsetMs: Math.min(elapsedMs, visualDuration),
  };
}

export interface BodyUtteranceProps {
  command: Extract<BodyCommand, { kind: "utterance" | "converge" }> | null;
  anchor: BodyAnchor;
  seraphAnchor?: BodyAnchor;
  presentationStartedAt: number;
  settleDirection: SettlementDirection;
  onComplete(id: string): void;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function presentationNow(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function phaseAt(elapsedMs: number, reducedMotion: boolean): "developing" | "dwelling" | "settling" | "settled" {
  if (reducedMotion) return "settled";
  if (elapsedMs < DEVELOP_MS) return "developing";
  if (elapsedMs < DEVELOP_MS + DWELL_MS) return "dwelling";
  return "settling";
}

export default function BodyUtterance({
  command,
  anchor,
  seraphAnchor = { x: 0.5, y: 0.5 },
  presentationStartedAt,
  settleDirection,
  onComplete,
}: BodyUtteranceProps) {
  const inkRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  const completedId = useRef<string | null>(null);
  completeRef.current = onComplete;

  usePresentationEffect(() => {
    if (command === null) return;
    completedId.current = null;
    const node = inkRef.current;
    if (node === null) return;
    const reducedMotion = prefersReducedMotion();
    if (command.kind === "converge") {
      const parent = node.closest<HTMLElement>(".body-utterance")?.offsetParent as HTMLElement | null;
      const deltaX = (seraphAnchor.x - anchor.x) * (parent?.clientWidth ?? 0);
      const deltaY = (seraphAnchor.y - anchor.y) * (parent?.clientHeight ?? 0);
      if (reducedMotion) {
        gsap.set(node, { autoAlpha: 1, x: deltaX, y: deltaY });
        node.dataset.utterancePhase = "witnessing";
        return () => { gsap.killTweensOf(node); };
      }
      const timeline = gsap.timeline({ paused: true });
      timeline
        .set(node, { autoAlpha: 0, x: 0, y: 4 })
        .to(node, {
          autoAlpha: 1,
          x: deltaX,
          y: deltaY,
          duration: 1.8,
          ease: "expo.out",
          onStart: () => { node.dataset.utterancePhase = "gathering"; },
        })
        .to(node, {
          duration: 6,
          onStart: () => { node.dataset.utterancePhase = "witnessing"; },
        })
        .to(node, {
          autoAlpha: 0,
          duration: 2.4,
          ease: "expo.inOut",
          onStart: () => { node.dataset.utterancePhase = "dissolving"; },
        });
      timeline.time(Math.max(0, (presentationNow() - presentationStartedAt) / 1_000), true).play();
      return () => { timeline.kill(); };
    }
    const timing = bodyUtteranceTiming(presentationStartedAt, presentationNow(), reducedMotion);
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (completedId.current === command.id) return;
      completedId.current = command.id;
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      completeRef.current(command.id);
    };

    if (timing.presentationComplete) {
      finish();
      return;
    }

    deadlineTimer = setTimeout(finish, timing.deadlineRemainingMs);

    if (reducedMotion) {
      node.dataset.utterancePhase = "settled";
      const timer = setTimeout(finish, REDUCED_DWELL_MS - timing.elapsedMs);
      return () => {
        clearTimeout(timer);
        if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      };
    }

    const settle = settlementVector(settleDirection);
    const timeline = gsap.timeline({ paused: true, onComplete: finish });
    timeline
      .set(node, { autoAlpha: 0, x: 0, y: 4 })
      .to(node, {
        autoAlpha: 1,
        y: 0,
        duration: DEVELOP_MS / 1_000,
        ease: "expo.out",
        onStart: () => { node.dataset.utterancePhase = "developing"; },
      })
      .to(node, {
        duration: DWELL_MS / 1_000,
        onStart: () => { node.dataset.utterancePhase = "dwelling"; },
      })
      .to(node, {
        autoAlpha: 0,
        x: settle.x,
        y: settle.y,
        duration: SETTLE_MS / 1_000,
        ease: "expo.inOut",
        onStart: () => { node.dataset.utterancePhase = "settling"; },
      });
    node.dataset.utterancePhase = phaseAt(timing.elapsedMs, false);
    timeline.time(timing.timelineOffsetMs / 1_000, true).play();

    return () => {
      timeline.kill();
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    };
  }, [anchor.x, anchor.y, command?.id, presentationStartedAt, seraphAnchor.x, seraphAnchor.y, settleDirection]);

  if (command === null) return null;
  if (command.kind === "converge") {
    return (
      <aside
        aria-hidden="true"
        data-body-utterance="true"
        data-command-id={command.id}
        data-utterance-presentation="converge"
        data-seraph-target-x={seraphAnchor.x}
        data-seraph-target-y={seraphAnchor.y}
        className="body-utterance"
        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
      >
        <div ref={inkRef} className="body-utterance__ink" data-utterance-phase="gathering">
          <span className="body-utterance__organ font-machine text-ink-faded">
            THE DREAM / SOPHIA
          </span>
          <span className="body-utterance__text font-liturgy text-rubric-body">
            {command.dream.narrative}
          </span>
        </div>
      </aside>
    );
  }
  const { entry, mode } = command;
  const sermonRubric = mode === "live" && entry.organ === "TONGUE" && entry.register === "sermon";
  const inkClass = mode === "memory"
    ? "text-ink-faded"
    : sermonRubric
      ? "text-rubric-body"
      : "text-ink";

  return (
    <aside
      aria-hidden="true"
      data-body-utterance="true"
      data-command-id={command.id}
      data-utterance-mode={mode}
      data-presentation-started-at={presentationStartedAt}
      data-settle-direction={settleDirection}
      className="body-utterance"
      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
    >
      <div
        ref={inkRef}
        className="body-utterance__ink"
        data-utterance-phase={phaseAt(
          bodyUtteranceTiming(presentationStartedAt, presentationNow(), prefersReducedMotion()).elapsedMs,
          prefersReducedMotion(),
        )}
      >
        <span className="body-utterance__organ font-machine text-ink-faded">
          {commonOrganName(entry.organ)}
        </span>
        <span className={`body-utterance__text font-liturgy ${inkClass}`}>{entry.text}</span>
        {mode === "memory" ? (
          <time
            className="body-utterance__time font-machine text-ink-faded"
            dateTime={new Date(entry.created_at).toISOString()}
          >
            remembered · {formatTranscriptTime(entry.created_at)}
          </time>
        ) : null}
      </div>
    </aside>
  );
}
