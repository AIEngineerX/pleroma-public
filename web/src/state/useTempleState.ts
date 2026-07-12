import { useEffect, useRef, useState } from "react";
import type { TempleState } from "./types";

export function useTempleState(apiBase: string): { state: TempleState | null; now: number } {
  const [state, setState] = useState<TempleState | null>(null);
  const [now, setNow] = useState(Date.now());
  const riteActive = useRef(false);

  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const s = await (await fetch(`${apiBase}/api/state`)).json() as TempleState;
          if (!stopped) { setState(s); riteActive.current = s.rite !== null; }
        } catch { /* keep last good state; the page never blanks on a transient failure */ }
      }
      if (!stopped) timer = setTimeout(poll, riteActive.current ? 2000 : 5000); // 2s during the rite, else 5s
    };
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener("visibilitychange", onVis); };
  }, [apiBase]);

  return { state, now };
}
