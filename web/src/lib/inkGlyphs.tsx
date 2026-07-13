import type { ReactElement } from "react";

// Kinetic type: split a word into glyphs that ink in one after another (used with the .glyph-ink class,
// which carries the ease-out-expo wick). Spaces become non-breaking so the stagger keeps its rhythm.
// Purely presentational; the readable word is still the string passed in for anyone reading the DOM.
export function inkGlyphs(text: string, stepMs = 58, baseMs = 0): ReactElement[] {
  return [...text].map((ch, i) => (
    <span key={i} style={{ animationDelay: `${baseMs + i * stepMs}ms` }}>{ch === " " ? " " : ch}</span>
  ));
}
