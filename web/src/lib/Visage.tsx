import { useEffect, useRef, useState } from "react";
import plateRest from "../assets/visage-rest.png";
import plateLifted from "../assets/visage-lifted.png";

// The Visage: the god's face and screenshot/PFP anchor (DESIGN.md §Signature). An illuminated masked
// seraph whose vermilion mask lifts to reveal the many-eyed void beneath — the mask/reveal IS the
// Concordat made visual. Two plate layers crossfade on `awake`: the serene mask at rest, the true face
// when it wakes. Until the chosen plates land in /assets, both layers fall back to the locked sigil so
// the structure (breathing, reveal, eye-track) is already wired and a plate swap is a one-line change.
//
// GATED INPUT: rest/lifted plate art is being chosen (Task 15 / DESIGN §Visage variant-lock). Swap the two
// imports below for the picked plates; everything else — the breath, the reveal, the pointer parallax — holds.
const PLATE_REST = plateRest;
const PLATE_LIFTED = plateLifted;

export default function Visage({ awake, size = 260 }: { awake: boolean; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [reduced] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Eye-track: the plate leans a few degrees toward the pointer (parallax), lerped so the motion is the
  // life, never a snap. Desktop only; coarse pointers get the breath alone. Writes CSS vars, not React state,
  // so it never triggers a re-render (60fps on a transform, not the layout).
  useEffect(() => {
    if (reduced || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches)) return;
    const el = ref.current; if (!el) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;   // -0.5..0.5-ish
      ty = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
    };
    const tick = () => {
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;                  // exponential ease toward the pointer
      el.style.setProperty("--vx", (cx * 14).toFixed(2) + "px");
      el.style.setProperty("--vy", (cy * 14).toFixed(2) + "px");
      el.style.setProperty("--vr", (cx * 3).toFixed(2) + "deg");
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [reduced]);

  return (
    <div
      ref={ref}
      className="visage relative select-none"
      style={{ width: `min(${size}px, 74vw)`, aspectRatio: "1", transform: "translate3d(var(--vx,0),var(--vy,0),0) rotate(var(--vr,0))" }}
      data-awake={awake}
      data-reduced={reduced}
      aria-hidden
    >
      {/* rest: the serene mask. Fades OUT as the god wakes. */}
      <img
        src={PLATE_REST}
        alt=""
        className="visage-plate visage-rest absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      {/* lifted: the many-eyed true face beneath. Fades IN on wake. */}
      <img
        src={PLATE_LIFTED}
        alt=""
        className="visage-plate visage-lifted absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
    </div>
  );
}
