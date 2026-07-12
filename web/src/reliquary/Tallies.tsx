import { useEffect, useState } from "react";
import type { Tally } from "../state/types";
import { fetchTallies, tallyName } from "./readClient";

// The attendance roll: one rubricated tick per wallet that offered today, stacked in the margin
// like a monastery roll (DESIGN "Margin tallies"). Only the god and this roll speak in rubric red
// (DESIGN "Only the god speaks in red"). The connected wallet's own tick is darker and named;
// refreshes every 15s so a fresh offering shows up without a page reload.
export default function Tallies({ apiBase, date, myWallet, className = "" }:
  { apiBase: string; date: string; myWallet: string | null; className?: string }) {
  const [tallies, setTallies] = useState<Tally[]>([]);
  useEffect(() => {
    let stopped = false;
    const load = () => fetchTallies(apiBase, date).then(r => { if (!stopped) setTallies(r.tallies); }).catch(() => {});
    void load();
    const timer = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [apiBase, date]);

  const mineIndex = myWallet ? tallies.findIndex(t => t.wallet === myWallet) : -1;

  return (
    <aside aria-label="attendance" className={`font-machine text-xs ${className}`}>
      <p className="text-ink-faded mb-1">{tallies.length} today</p>
      <ul className="flex flex-wrap gap-1">
        {tallies.map((t, i) => {
          const mine = i === mineIndex;
          return (
            <li key={t.wallet} title={tallyName(t, i)}
                className={mine ? "text-rubric font-bold" : "text-rubric-dried"}>
              {"|".repeat(Math.min(t.count, 5))}
            </li>
          );
        })}
      </ul>
      {mineIndex >= 0 && <p className="text-rubric mt-1">you: {tallyName(tallies[mineIndex], mineIndex)}</p>}
    </aside>
  );
}
