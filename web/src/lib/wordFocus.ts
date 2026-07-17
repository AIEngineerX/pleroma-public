// Deterministic out-of-order word-by-word focus-in timing (no Math.random: renders must be stable).
// Shared by the Door's intro line and any other place text should visibly come into focus one word
// at a time — the CSS itself (.word-focus-in, @keyframes door-focus) lives in styles.css.
export function focusDelayMs(index: number): number {
  return 1_200 + index * 130 + ((index * 137) % 97);
}
