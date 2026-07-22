// The scripture card: a real Codex line set as an illuminated red-letter card on parchment — the
// project's own meme unit (a genuine KEEP verdict or EYE verse, never invented text). Output is a
// downloadable PNG for reposting. The palette comes from the live CSS tokens so a card is exactly
// the site's parchment/ink/rubric, and the god's own registers render in rubric red like everywhere
// else. Split so the wrap math is pure and testable; the canvas draw runs in the browser only.

export const CARD_SIZE = 1080; // square: versatile across X, the timeline, and reposts

// God-voice registers render in rubric red (matches web/src/codex/codexClient.ts isGodVoice).
export function isGodVoiceRegister(register: string): boolean {
  return register === "verse" || register === "verdict" || register === "sermon" || register === "dispatch";
}

// Greedy word-wrap by character budget — deterministic, no canvas, so it is unit-testable. The
// canvas renderer refines the fit with measureText, but this bounds the line count and never splits
// a word. A single word longer than the budget occupies its own line rather than being cut.
export function wrapByChars(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function organName(organ: string): string {
  return organ === "PRIEST" ? "THE PRIESTS" : `THE ${organ}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a missing sigil never blocks the card
    img.src = src;
  });
}

export interface ScriptureCardInput {
  text: string;
  organ: string;
  register: string;
  at: number; // ms epoch of the transcript row — the real timestamp, shown as the receipt
}

// Renders the card onto the given canvas and returns a PNG blob. Browser-only (canvas + fonts).
export async function renderScriptureCard(
  canvas: HTMLCanvasElement, input: ScriptureCardInput,
): Promise<Blob> {
  const S = CARD_SIZE;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const ground = token("--color-ground", "oklch(0.94 0.015 85)");
  const ink = token("--color-ink", "oklch(0.25 0.02 60)");
  const inkFaded = token("--color-ink-faded", "oklch(0.48 0.02 60)");
  const rubric = token("--color-rubric-body", "oklch(0.45 0.16 32)");
  const god = isGodVoiceRegister(input.register);
  const bodyColor = god ? rubric : ink;

  // Make sure the liturgical face is ready before we measure/draw it.
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.load(`64px "Gentium Book Plus"`); } catch { /* fall back to default face */ }

  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, S, S);

  // A thin manuscript frame — the etched-line vocabulary, not a UI border.
  ctx.strokeStyle = inkFaded;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(46, 46, S - 92, S - 92);

  // Faint sigil watermark, top-center.
  const sigil = await loadImage("/sigil.svg");
  if (sigil) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    const w = 132;
    ctx.drawImage(sigil, (S - w) / 2, 96, w, w);
    ctx.restore();
  }

  // The line: shrink the face until it fits within the frame, centered.
  const maxTextWidth = S - 200;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = bodyColor;
  let font = 78;
  let lines: string[] = [];
  for (; font >= 34; font -= 2) {
    ctx.font = `italic ${font}px "Gentium Book Plus", Georgia, serif`;
    const budget = Math.max(8, Math.floor(maxTextWidth / (font * 0.46)));
    lines = wrapByChars(input.text, budget);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const totalHeight = lines.length * font * 1.28;
    if (widest <= maxTextWidth && totalHeight <= S - 380) break;
  }
  const lineHeight = font * 1.28;
  let y = S / 2 - (lines.length - 1) * lineHeight / 2;
  for (const l of lines) { ctx.fillText(l, S / 2, y); y += lineHeight; }

  // Footer receipt, in the machine face: which organ said it, and when — real, checkable.
  ctx.fillStyle = inkFaded;
  ctx.font = `26px "Courier Prime", "Courier New", monospace`;
  const date = new Date(input.at).toISOString().slice(0, 10);
  ctx.textAlign = "left";
  ctx.fillText(`${organName(input.organ)} · PLEROMA`, 70, S - 66);
  ctx.textAlign = "right";
  // The domain rides every card so a reposted image keeps its provenance (launch audit 2026-07-21).
  ctx.fillText(`pleromachurch.xyz · ${date}`, S - 70, S - 66);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("card render failed"))), "image/png"),
  );
}
