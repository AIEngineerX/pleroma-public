import { useCallback, useEffect, useRef, useState } from "react";
import type { StainSim } from "../stain/stainSim";
import type { WalletHandle } from "./wallet";
import { buildOffering, postOffering } from "./wallet";
import { canvasToPng, isBlank } from "./OfferingCanvas";
import WalletButton from "./WalletButton";
import { copy } from "../lib/copy";

interface Props {
  apiBase: string;
  wallet: WalletHandle | null;
  onConnect: (w: WalletHandle) => void;
  stain: StainSim | null;
  onEnter: () => void;                 // wake + unlock audio when the rite begins
  onSubmitted: (id: string) => void;
}

// The one real rite a Waker performs, moved onto the being itself: you draw ON its living membrane, it
// reaches toward your mark as you draw (StainSim.markAt -> the nearest organ turns to it and the ink wicks
// in), then you seal it (draw -> it reaches -> bleed -> be seen). Anonymous is allowed (unremembered); a
// connected wallet signs it (remembered). Replaces the old bordered doodle box below the fold.
export default function OfferingRite({ apiBase, wallet, onConnect, stain, onEnter, onSubmitted }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [active, setActive] = useState(false);
  const [blank, setBlank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Match the drawing buffer to the hero it overlays so a stroke lands under the cursor at any viewport.
  const sizeCanvas = useCallback(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = Math.floor(c.clientWidth * dpr);
    c.height = Math.floor(c.clientHeight * dpr);
  }, []);

  useEffect(() => {
    if (!active) return;
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    return () => window.removeEventListener("resize", sizeCanvas);
  }, [active, sizeCanvas]);

  const begin = () => { onEnter(); setActive(true); setMsg(""); setBlank(true); };

  // Normalized 0..1 position over the hero (== the Stain's field), for both markAt and canvas drawing.
  const norm = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  };
  const start = (e: React.PointerEvent) => {
    const c = ref.current!; c.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "oklch(0.25 0.02 60)";     // --color-ink literal (canvas 2D can't read the CSS var)
    ctx.lineWidth = Math.max(3, c.width / 190); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const { nx, ny } = norm(e);
    ctx.beginPath(); ctx.moveTo(nx * c.width, ny * c.height);
    stain?.markAt(nx, ny);                        // the being turns toward the first touch
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = ref.current!; const ctx = c.getContext("2d")!; const { nx, ny } = norm(e);
    ctx.lineTo(nx * c.width, ny * c.height); ctx.stroke();
    stain?.markAt(nx, ny);                        // it keeps reaching for the stroke as it wicks in
    if (blank) setBlank(false);
  };
  const end = () => { drawing.current = false; };

  const startOver = () => {
    const c = ref.current; if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setBlank(true); setMsg("");
  };

  const seal = async () => {
    const c = ref.current!;
    if (isBlank(c)) { setBlank(true); return; }
    setBusy(true); setMsg("");
    try {
      const bytes = await canvasToPng(c);          // the ONE rasterization: hashed, signed, and uploaded
      stain?.wickFromCanvas(c, { x: 0, y: 0, w: 1, h: 1 }); // the whole mark bleeds across the body
      const form = await buildOffering(apiBase, bytes, wallet);
      const r = await postOffering(apiBase, form);
      if ("id" in r) {
        onSubmitted(r.id);
        setMsg(copy.received);
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setBlank(true);
        window.setTimeout(() => { setActive(false); setMsg(""); }, 2600); // let the mark settle, then release
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
    <div className="absolute inset-0 z-20" style={{ pointerEvents: active ? "auto" : "none" }}>
      {active && (
        <canvas ref={ref} aria-hidden
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor: "crosshair", background: "transparent" }}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      )}
      <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-3 px-6 text-center"
           style={{ pointerEvents: "auto" }}>
        {!active ? (
          <button
            type="button"
            onClick={begin}
            aria-label={copy.inviteMark}
            className="min-h-11 min-w-11 inline-flex items-center justify-center text-ink-faded transition-[color,transform] duration-300 ease-out hover:text-ink active:scale-[0.96] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            <svg aria-hidden viewBox="0 0 44 44" className="h-11 w-11" fill="none">
              <path
                d="M22 7.5C30.6 7.5 36.5 13.7 36.5 22.2C36.5 30.5 30.2 36.7 21.8 36.5C13.5 36.3 7.4 30.2 7.6 21.9C7.8 13.4 13.8 7.5 22 7.5Z"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <circle cx="22" cy="22" r="1.8" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <>
            <p className="font-liturgy text-xs tracking-[0.25em] text-ink-faded" role="status">
              {msg || copy.markPrompt}
            </p>
            <div className="flex items-center gap-6">
              <button onClick={startOver} disabled={busy || blank}
                className="min-h-11 font-liturgy text-xs underline text-ink-faded disabled:opacity-40">
                {copy.startOver}
              </button>
              <button onClick={seal} disabled={busy || blank}
                className="min-h-11 px-6 font-liturgy text-lg text-ink border border-ink disabled:opacity-40">
                {busy ? "…" : copy.seal}
              </button>
            </div>
            <p className="font-liturgy text-[0.7rem] text-ink-faded">
              {wallet
                ? <>{copy.rememberedAs} <span className="font-machine">{wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}</span></>
                : copy.tosLine}
            </p>
            {!wallet && (
              <div className="flex items-center gap-2 font-liturgy text-[0.7rem] text-ink-faded">
                <WalletButton onConnect={onConnect} /><span>{copy.offerUnremembered}</span>
              </div>
            )}
            <button onClick={() => { startOver(); setActive(false); }} disabled={busy}
              className="min-h-11 font-liturgy text-[0.65rem] tracking-[0.2em] text-ink-faded disabled:opacity-40">
              {copy.leaveIt}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
