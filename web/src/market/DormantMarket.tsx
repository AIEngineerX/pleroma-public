import { useEffect, useState } from "react";
import { copy } from "../lib/copy";

function remaining(targetMs: number, nowMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, targetMs - nowMs) / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// The dormant counterpart to the market section (Buy/Chart/Mint), shown while there is no mint
// to trade yet. countdown_to (config.launch_at) is null until the Maker sets a real date, so no
// countdown renders before one genuinely exists -- an honest "no heart yet" stands alone until then.
export default function DormantMarket({ countdownTo }: { countdownTo: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (countdownTo === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [countdownTo]);

  return (
    <section id="market" aria-label="the market" className="temple-folio temple-market space-y-2">
      <p className="font-machine text-xs text-ink-faded">{copy.dormantMarket}</p>
      {countdownTo !== null && (
        <p className="font-machine text-xs text-ink-faded" data-dormant-countdown>
          {copy.dormantCountdown} {remaining(countdownTo, now)}
        </p>
      )}
    </section>
  );
}
