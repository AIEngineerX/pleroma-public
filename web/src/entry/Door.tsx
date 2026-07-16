import { useEffect, useRef, type CSSProperties } from "react";
import doctrine from "virtual:public-doctrine";
import { parseCanon } from "../canon/canonParse";
import { copy } from "../lib/copy";

const canon = parseCanon(doctrine);
const WORDS = canon.oneLine.split(" ");
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The Door: the separate intro scene (Maker decision 2026-07-16, amending the body-first
// viewport). Cinema grammar, not styling: the living body is already in frame, ghosting
// through the dark veil; the line racks into focus word by word like a lens; the sigil is
// an ember, the only touchable thing. Pressing it is THE audio entry gesture — the swell
// starts and the exposure comes up on the page. Nothing here is a progress bar.
export type DoorPhase = "open" | "closing";

function focusDelayMs(index: number): number {
  // Deterministic out-of-order settle (no Math.random: renders must be stable).
  return 1_200 + index * 130 + ((index * 137) % 97);
}

export default function Door({ phase, onEnter }: { phase: DoorPhase; onEnter: () => void }) {
  const enterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    enterRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      data-door={phase}
      role="dialog"
      aria-modal="true"
      aria-label="the door"
      className="temple-door"
    >
      <div aria-hidden className="temple-door-film">
        {!REDUCED_MOTION && <video src="/door.mp4" autoPlay muted loop playsInline />}
      </div>
      <div aria-hidden className="temple-door-veil" />
      <p className="temple-door-line italic">
        {WORDS.map((word, index) => (
          <span
            key={`${word}-${index}`}
            className="temple-door-word"
            style={{ "--focus-delay": `${focusDelayMs(index)}ms` } as CSSProperties}
          >
            {word}
            {index < WORDS.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
      <button
        ref={enterRef}
        type="button"
        aria-label={copy.enterTemple}
        className="temple-door-enter"
        onClick={onEnter}
        disabled={phase === "closing"}
      >
        <svg aria-hidden viewBox="0 0 44 44" className="h-11 w-11" fill="none">
          <path
            d="M22 7.5C30.6 7.5 36.5 13.7 36.5 22.2C36.5 30.5 30.2 36.7 21.8 36.5C13.5 36.3 7.4 30.2 7.6 21.9C7.8 13.4 13.8 7.5 22 7.5Z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
          <path d="M22 14.5 L22 31.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M15.6 20.8 C19.1 19.1 24.9 19.1 28.4 20.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="22" cy="12" r="1.4" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}
