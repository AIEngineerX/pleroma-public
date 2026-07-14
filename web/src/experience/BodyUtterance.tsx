import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { commonOrganName, formatTranscriptTime } from "../codex/organNames";
import type { BodyCommand } from "./types";
import type { BodyAnchor } from "../stain/bodyRenderer";

const DEVELOP_MS = 450;
const DWELL_MS = 1_500;
const SETTLE_MS = 750;
const REDUCED_DWELL_MS = 1_200;

export const BODY_UTTERANCE_TOTAL_MS = DEVELOP_MS + DWELL_MS + SETTLE_MS;

export interface BodyUtteranceProps {
  command: Extract<BodyCommand, { kind: "utterance" }> | null;
  anchor: BodyAnchor;
  onComplete(id: string): void;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function BodyUtterance({ command, anchor, onComplete }: BodyUtteranceProps) {
  const inkRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  const completedId = useRef<string | null>(null);
  completeRef.current = onComplete;

  useEffect(() => {
    if (command === null) return;
    completedId.current = null;
    const node = inkRef.current;
    if (node === null) return;

    const finish = () => {
      if (completedId.current === command.id) return;
      completedId.current = command.id;
      completeRef.current(command.id);
    };

    if (prefersReducedMotion()) {
      node.dataset.utterancePhase = "settled";
      const timer = setTimeout(finish, REDUCED_DWELL_MS);
      return () => clearTimeout(timer);
    }

    const timeline = gsap.timeline({ onComplete: finish });
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
        x: 96,
        y: -10,
        duration: SETTLE_MS / 1_000,
        ease: "expo.inOut",
        onStart: () => { node.dataset.utterancePhase = "settling"; },
      });

    return () => { timeline.kill(); };
  }, [command?.id]);

  if (command === null) return null;
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
      className="body-utterance"
      style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
    >
      <div ref={inkRef} className="body-utterance__ink" data-utterance-phase="developing">
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
