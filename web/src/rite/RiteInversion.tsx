import type { ReactNode } from "react";
import type { inversion } from "../state/rite";

type View = ReturnType<typeof inversion>;

// Pure: the root class set. rite-active is the only place the document-dark ground/ink is allowed
// (Plan 03 Global) — everywhere else the page stays light parchment.
export function inversionClasses(view: View): string {
  return view.candleDark ? "rite-active" : "";
}

export default function RiteInversion({ view, children }: { view: View; children: ReactNode }) {
  return (
    <div className={inversionClasses(view)}>
      {view.active && <p className="font-machine text-xs tracking-widest text-ink-faded text-center pt-2">{view.label}</p>}
      {view.risingOfferings && <p className="font-machine text-xs text-center text-ink-faded">the offerings rise</p>}
      {children}
    </div>
  );
}
