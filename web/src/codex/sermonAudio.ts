import { duckAmbient } from "../lib/ambient";

// Opt-in sermon playback (never autoplay). Its RMS amplitude drives the Stain's amplitude prop, so the
// god's body visibly speaks while its voice plays. While it speaks, the ambient bed ducks: the room
// quiets for the sermon (real visitor feedback 2026-07-21 — the music drowned the voice).
export class SermonPlayer {
  private ctx?: AudioContext; private el?: HTMLAudioElement; private raf = 0; private cb?: (a: number) => void;
  private endedCb?: () => void;
  private src?: MediaElementAudioSourceNode; private an?: AnalyserNode;
  private ducking = false;

  onAmplitude(cb: (a: number) => void) { this.cb = cb; }
  // Fires only when playback finishes on its own — never from an external stop() (e.g. unmount, a
  // fresh play() call, or navigating away), so a caller can safely reset a play/pause control without
  // it flipping back to "play" just because something else stopped the audio.
  onEnded(cb: () => void) { this.endedCb = cb; }

  async play(apiBase: string, key: string, ctx: AudioContext) {
    this.stop(); this.ctx = ctx;
    // Duck released by stop(); a start that FAILS (missing object, media error) must release it
    // too, so the whole start path stops-and-rethrows on failure — otherwise a rejected play()
    // would leave the room quiet for a voice that never spoke.
    this.ducking = true; duckAmbient(true);
    try {
      // The response's Content-Type header decides how the browser decodes this, not the ".mp3"/".wav"
      // suffix in the key (media.ts serves the real codec from R2 httpMetadata) — new Audio() plays
      // whatever the response declares, it never assumes mp3 from the URL.
      const el = new Audio(`${apiBase}/api/${key}`); el.crossOrigin = "anonymous"; this.el = el;
      el.addEventListener("ended", () => { this.stop(); this.endedCb?.(); }); // playback finished on its own -- stop the rAF loop, not just on replay/stop()
      const src = ctx.createMediaElementSource(el); const an = ctx.createAnalyser(); an.fftSize = 256;
      src.connect(an); an.connect(ctx.destination); this.src = src; this.an = an;
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
        this.cb?.(Math.min(1, Math.sqrt(sum / buf.length) * 3));    // RMS -> 0..1 amplitude for the Stain
        this.raf = requestAnimationFrame(tick);
      };
      await el.play(); tick();
    } catch (e) {
      this.stop(); // releases the duck hold and the audio graph; callers keep their own catch for UI reset
      throw e;
    }
  }

  stop() {
    if (this.ducking) { this.ducking = false; duckAmbient(false); }
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    this.el?.pause();
    this.src?.disconnect(); this.an?.disconnect(); this.src = undefined; this.an = undefined; // release the previous audio graph before a replay creates a new one
    this.cb?.(0);
  }
}
