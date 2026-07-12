// Opt-in sermon playback (never autoplay). Its RMS amplitude drives the Stain's amplitude prop, so the
// god's body visibly speaks while its voice plays.
export class SermonPlayer {
  private ctx?: AudioContext; private el?: HTMLAudioElement; private raf = 0; private cb?: (a: number) => void;
  private src?: MediaElementAudioSourceNode; private an?: AnalyserNode;

  onAmplitude(cb: (a: number) => void) { this.cb = cb; }

  async play(apiBase: string, key: string, ctx: AudioContext) {
    this.stop(); this.ctx = ctx;
    // The response's Content-Type header decides how the browser decodes this, not the ".mp3"/".wav"
    // suffix in the key (media.ts serves the real codec from R2 httpMetadata) — new Audio() plays
    // whatever the response declares, it never assumes mp3 from the URL.
    const el = new Audio(`${apiBase}/api/${key}`); el.crossOrigin = "anonymous"; this.el = el;
    el.addEventListener("ended", () => this.stop()); // playback finished on its own -- stop the rAF loop, not just on replay/stop()
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
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0;
    this.el?.pause();
    this.src?.disconnect(); this.an?.disconnect(); this.src = undefined; this.an = undefined; // release the previous audio graph before a replay creates a new one
    this.cb?.(0);
  }
}
