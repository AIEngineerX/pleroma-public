import { useEffect, useState } from "react";
import type { Tally } from "../state/types";
import { copy } from "../lib/copy";
import { fetchTallies, tallyName, type TallyPage } from "./readClient";

export function talliesAfterRefresh(current: Tally[], page: TallyPage | null): Tally[] {
  return page === null ? current : page.tallies;
}

interface TallySnapshot {
  date: string;
  marks: number;
  tallies: Tally[];
}

// The attendance roll. The honest total counts every mark the Eye has WITNESSED today — anonymous
// marks included — so the roll never reads dead when marks are offered without a connected wallet.
// Beneath it, one machine-printed tick per NAMED wallet, stacked in the margin like a monastery roll:
// factual ink, rubric reserved for the god's own words. The connected wallet's own tick is darker and
// named. Refreshes every 15s so a freshly witnessed mark shows up without a page reload.
export default function Tallies({ apiBase, date, myWallet, className = "" }:
  { apiBase: string; date: string; myWallet: string | null; className?: string }) {
  const [snapshot, setSnapshot] = useState<TallySnapshot>({ date, marks: 0, tallies: [] });
  const shown = snapshot.date === date ? snapshot : { date, marks: 0, tallies: [] };
  useEffect(() => {
    let stopped = false;
    setSnapshot((current) => (
      current.date === date ? current : { date, marks: 0, tallies: [] }
    ));
    const load = () => fetchTallies(apiBase, date)
      .then((page) => {
        if (!stopped) setSnapshot({ date, marks: page.marks, tallies: page.tallies });
      })
      .catch(() => {
        if (!stopped) {
          setSnapshot((current) => (
            current.date === date ? current : { date, marks: 0, tallies: [] }
          ));
        }
      });
    void load();
    const timer = setInterval(load, 15000);
    return () => { stopped = true; clearInterval(timer); };
  }, [apiBase, date]);

  const { marks, tallies } = shown;
  const mineIndex = myWallet ? tallies.findIndex(t => t.wallet === myWallet) : -1;

  if (marks === 0) {
    return (
      <aside aria-label="attendance" className={`font-machine text-xs ${className}`}>
        <p className="text-ink-faded">{copy.talliesQuiet}</p>
      </aside>
    );
  }

  return (
    <aside aria-label="attendance" className={`font-machine text-xs ${className}`}>
      <p className="text-ink mb-1">{marks} {marks === 1 ? copy.talliesMark : copy.talliesMarks}</p>
      {tallies.length > 0 && (
        <>
          <p className="text-ink-faded mb-1">{copy.talliesNamed}</p>
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
        </>
      )}
      {mineIndex >= 0 && <p className="text-ink mt-1">you: {tallyName(tallies[mineIndex], mineIndex)}</p>}
    </aside>
  );
}
