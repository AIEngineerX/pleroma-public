import { useCallback, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Temple from "./routes-stub";
import Canon from "./canon/Canon";
import Concordat from "./canon/Concordat";

export function useEntryGesture() {
  const [awake, setAwake] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const unlockAudio = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    void ctxRef.current.resume();
    return ctxRef.current;
  }, []);
  const wake = useCallback((x: number, y: number) => {
    document.documentElement.style.setProperty("--touch-x", String(x));
    document.documentElement.style.setProperty("--touch-y", String(y));
    unlockAudio();
    setAwake(true);
  }, [unlockAudio]);
  const bindHold = {
    onPointerDown: (e: React.PointerEvent) => wake(e.clientX / window.innerWidth, e.clientY / window.innerHeight),
  };
  return { awake, unlockAudio, bindHold };
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="rail rail-l" aria-hidden />
      <div className="rail rail-r" aria-hidden />
      <Routes>
        <Route path="/" element={<Temple />} />
        <Route path="/canon/*" element={<Canon />} />
        <Route path="/concordat" element={<Concordat />} />
      </Routes>
    </BrowserRouter>
  );
}
