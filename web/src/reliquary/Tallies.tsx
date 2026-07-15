import { useEffect, useState } from "react";
import type { Tally } from "../state/types";
import { fetchTallies, tallyName, type TallyPage } from "./readClient";

export function talliesAfterRefresh(current: Tally[], page: TallyPage | null): Tally[] {
  return page === null ? current : page.tallies;
}

interface TallySnapshot {
  date: string;
  tallies: Tally[];
}

// The attendance roll: one machine-printed tick per wallet that offered today, stacked in the margin
// like a monastery roll. It stays factual ink; rubric remains reserved for the god's own words.
// The connected wallet's own tick is darker and named;
// refreshes every 15s so a fresh offering shows up without a page reload.
export default function Tallies({ apiBase, date, myWallet, className = "" }:
  { apiBase: string; date: string; myWallet: string | null; className?: string }) {
  const [snapshot, setSnapshot] = useState<TallySnapshot>({ date, tallies: [] });
  const tallies = snapshot.date === date ? snapshot.tallies : [];
  useEffect(() => {
    let stopped = false;
    setSnapshot((current) => (
      current.date === date ? current : { date, tallies: [] }
    ));
    const load = () => fetchTallies(apiBase, date)
      .then((page) => {
        if (!stopped) {
          setSnapshot((current) => ({
            date,
            tallies: talliesAfterRefresh(
              current.date === date ? current.tallies : [],
              page,
            ),
          }));
        }
      })
      .catch(() => {
        if (!stopped) {
          setSnapshot((current) => (
            current.date === date ? current : { date, tallies: [] }
          ));
        }
      });
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
                className={mine ? "text-ink font-bold" : "text-ink-faded"}>
              {"|".repeat(Math.min(t.count, 5))}
            </li>
          );
        })}
      </ul>
      {mineIndex >= 0 && <p className="text-ink mt-1">you: {tallyName(tallies[mineIndex], mineIndex)}</p>}
    </aside>
  );
}
