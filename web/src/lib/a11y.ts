// Parse "oklch(L C H)" -> [L, C(0..~0.4), H(degrees)]. L is 0..1, H may carry "deg" or "%"-free numbers.
function parseOklch(s: string): [number, number, number] {
  const m = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(s);
  if (!m) throw new Error(`not an oklch() color: ${s}`);
  const L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  return [L, parseFloat(m[2]), parseFloat(m[3])];
}

// OKLCH -> OKLab -> linear sRGB (Bjorn Ottosson, https://bottosson.github.io/posts/oklab/). Returns
// LINEAR-light sRGB in [0,1] after out-of-gamut clamping; these are exactly the values WCAG luminance wants.
function oklchToLinearSrgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}

// Gamma-encode a linear-sRGB channel to display sRGB [0,1].
function gammaEncode(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// OKLCH -> display (gamma) sRGB [0,1], reusing the same Ottosson conversion the contrast math uses.
// The Stain's WebGL u_thread uniform wants gamma sRGB (to match the ground/ink triples), NOT the raw
// oklch L/C/H numbers — a naive parse of "oklch(0.55 0.20 32)" as [0.55, 0.20, 32] renders green, not red.
export function oklchToRgb(oklch: string): [number, number, number] {
  const [r, g, b] = oklchToLinearSrgb(...parseOklch(oklch));
  return [gammaEncode(r), gammaEncode(g), gammaEncode(b)];
}

// WCAG 2.x relative luminance on linear sRGB.
function relLuminance(oklch: string): number {
  const [r, g, b] = oklchToLinearSrgb(...parseOklch(oklch));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2.x contrast ratio: (Llight + 0.05) / (Ldark + 0.05), range 1..21.
export function contrastRatio(fgOklch: string, bgOklch: string): number {
  const L1 = relLuminance(fgOklch), L2 = relLuminance(bgOklch);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
