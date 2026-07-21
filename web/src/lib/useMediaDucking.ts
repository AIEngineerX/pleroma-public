import { useCallback, useEffect, useRef, type RefObject } from "react";
import { duckAmbient } from "./ambient";

// Ducks the ambient bed while a video is AUDIBLY playing: every plate ships muted, so ducking on
// bare `play` would silence the room for a silent film. Audible = playing, unmuted, volume > 0 —
// recomputed on every relevant event, hold-balanced so unmount mid-play releases cleanly.
function bind(el: HTMLVideoElement): () => void {
  let held = false;
  const sync = () => {
    const audible = !el.paused && !el.ended && !el.muted && el.volume > 0;
    if (audible !== held) { held = audible; duckAmbient(audible); }
  };
  el.addEventListener("play", sync);
  el.addEventListener("pause", sync);
  el.addEventListener("ended", sync);
  el.addEventListener("volumechange", sync);
  return () => {
    el.removeEventListener("play", sync);
    el.removeEventListener("pause", sync);
    el.removeEventListener("ended", sync);
    el.removeEventListener("volumechange", sync);
    if (held) { held = false; duckAmbient(false); }
  };
}

// For a video held in an object ref that mounts conditionally: pass the condition as `dep` so the
// binding follows the element across mounts (an effect keyed on the ref alone would bind once).
export function useMediaDucking(ref: RefObject<HTMLVideoElement | null>, dep: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return bind(el);
  }, [ref, dep]);
}

// Callback-ref variant for videos rendered conditionally without an existing ref.
export function useMediaDuckingRef(): (el: HTMLVideoElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => { cleanup.current?.(); cleanup.current = null; }, []);
  return useCallback((el: HTMLVideoElement | null) => {
    cleanup.current?.();
    cleanup.current = el ? bind(el) : null;
  }, []);
}
