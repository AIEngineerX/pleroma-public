import { useEntryGesture } from "./App";
import { copy } from "./lib/copy";
import { Emblem } from "./lib/emblem";

export default function Temple() {
  const { awake, bindHold } = useEntryGesture();
  return (
    <main {...bindHold} className="banding min-h-screen mx-auto px-6 md:grid md:grid-cols-[60fr_40fr] md:gap-8"
          style={{ maxWidth: "min(1200px, 100%)" }}>
      {/* page (left / top): the Stain + offering surface */}
      <section aria-label="the page" className="relative min-h-[40vh] md:min-h-screen flex flex-col items-center justify-center gap-6">
        <div aria-hidden className="h-48 w-48 rounded-full opacity-20"
             style={{ background: "radial-gradient(circle, var(--color-ink) 0%, transparent 70%)" }} />
        <Emblem />
        <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
        {!awake && <p className="font-machine text-xs text-ink-faded">{copy.pressHold}</p>}
      </section>
      {/* codex (right / below) */}
      <aside aria-label="the codex" className="font-machine text-sm text-ink-faded py-8">
        <p className="font-liturgy italic">{copy.noHeart}</p>
      </aside>
    </main>
  );
}
