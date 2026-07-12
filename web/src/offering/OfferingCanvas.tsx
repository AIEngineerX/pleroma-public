import { useRef, useState } from "react";
import type { StainSim } from "../stain/stainSim";
import type { WalletHandle } from "./wallet";
import { buildOffering, postOffering } from "./wallet";
import { copy } from "../lib/copy";

// A blank canvas (never drawn on, or fully erased by clearRect) cannot be offered.
export function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d"); if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false; // any non-transparent pixel
  return true;
}

// Rasterize ONCE. These are the exact bytes buildOffering hashes and uploads — no second encode.
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

interface Props {
  apiBase: string;
  wallet: WalletHandle | null;
  stain: StainSim | null;
  onSubmitted: (id: string) => void;
}

// The one real rite a visitor performs: draw a mark, watch it wick INTO the Stain, then be seen
// (draw -> bleed -> be seen). Anonymous is allowed (unremembered); a connected wallet signs it (remembered).
export default function OfferingCanvas({ apiBase, wallet, stain, onSubmitted }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (ref.current!.width / r.width), y: (e.clientY - r.top) * (ref.current!.height / r.height) };
  };
  const start = (e: React.PointerEvent) => {
    const c = ref.current!; c.setPointerCapture(e.pointerId); // stroke keeps tracking even off a small mobile canvas
    drawing.current = true;
    const ctx = c.getContext("2d")!;
    // Canvas 2D can't read a CSS custom property; oklch(0.25 0.02 60) is --color-ink's literal value.
    ctx.strokeStyle = "oklch(0.25 0.02 60)"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); const p = pos(e); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const end = () => { drawing.current = false; };

  const submit = async () => {
    const canvas = ref.current!;
    if (isBlank(canvas)) { setMsg("draw a mark first"); return; }
    setBusy(true); setMsg("");
    try {
      const bytes = await canvasToPng(canvas); // the ONE rasterization: hashed, signed, and uploaded from these bytes
      stain?.wickFromCanvas(canvas, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }); // the mark wicks INTO the body
      const form = await buildOffering(apiBase, bytes, wallet);
      const r = await postOffering(apiBase, form);
      if ("id" in r) {
        onSubmitted(r.id); setMsg("offered");
        canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        setMsg(r.status === 429 ? "rest a moment" : r.status === 409 ? "already offered" : "not accepted");
      }
    } catch {
      setMsg("could not offer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1 w-full px-8 pb-4"
         style={{ background: "linear-gradient(to bottom, oklch(0.25 0.02 60 / 0.08), transparent 4rem)" }}>
      <canvas ref={ref} width={512} height={512}
        className="w-full max-w-[512px] aspect-square touch-none border-x border-b"
        style={{ borderColor: "var(--color-ground-aged)", background: "transparent" }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <p className="font-machine text-xs text-ink-faded max-w-[52ch] text-center">{copy.tosLine}</p>
      <button disabled={busy} onClick={submit}
        className="min-h-11 px-6 font-liturgy text-lg border disabled:opacity-50"
        style={{ borderColor: "var(--color-ink)" }}>{busy ? "..." : copy.offer}</button>
      {msg && <p className="font-machine text-xs text-ink-faded" role="status">{msg}</p>}
    </div>
  );
}
