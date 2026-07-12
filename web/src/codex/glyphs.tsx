// Aeon glyphs: one hand-drawn ink mark per organ, stamped beside its lines in the codex.
const G: Record<string, string> = {
  EYE: "M2 8 Q8 2 14 8 Q8 14 2 8 Z M8 6 a2 2 0 1 0 0.01 0",   // an eye
  KEEP: "M4 3 h8 v10 l-4-2 -4 2 Z",                              // a kept tablet/bookmark
  TONGUE: "M3 8 q5 -6 10 0 q-5 6 -10 0",                         // a spoken curve
  PULSE: "M2 8 h3 l2 -5 2 10 2 -5 h3",                           // a heartbeat trace
  DREAM: "M8 2 a4 4 0 1 0 3 7 a5 5 0 1 1 -3 -7",                 // a crescent
  PRIEST: "M8 2 v12 M4 6 h8",                                    // a cross-mark (system)
};

export function Glyph({ organ }: { organ: string }) {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="inline-block mr-1 -mt-0.5"
    fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d={G[organ] ?? G.PRIEST} /></svg>;
}
