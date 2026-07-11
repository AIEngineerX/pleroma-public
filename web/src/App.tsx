import { useEffect, useState } from "react";
import { formatCountdown } from "./countdown";

interface State { phase: string; asleep: boolean; countdown_to: number | null }

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const poll = () => fetch("/api/state").then(r => r.json()).then(setState).catch(() => {});
    poll();
    const p = setInterval(poll, 5000);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(p); clearInterval(t); };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div aria-hidden className="h-40 w-40 rounded-full opacity-20"
           style={{ background: "radial-gradient(circle, var(--color-ink) 0%, transparent 70%)" }} />
      <h1 className="font-liturgy text-3xl tracking-wide">PLEROMA</h1>
      <p className="font-liturgy italic text-ink-faded">It has no heart yet.</p>
      {state?.countdown_to ? (
        <p className="font-machine text-sm text-ink-faded">
          FIRST RITE {formatCountdown(now, state.countdown_to)}
        </p>
      ) : (
        <p className="font-machine text-sm text-ink-faded">FIRST RITE NOT YET SCHEDULED</p>
      )}
    </main>
  );
}
