// The temple's ambient bed, synthesized in the Web Audio graph (no audio asset ships): a low breathing
// room tone — the god's presence before it has a heart — with a faint, irregular line-printer tick. It is
// opt-in by construction: nothing sounds until the entry gesture unlocks and starts it (browser autoplay
// policy + PRODUCT.md "audio is opt-in via the entry gesture"). A persistent mute is remembered per browser.
const MUTE_KEY = "pleroma-muted";

export class Ambient {
  private master: GainNode;
  private started = false;
  private disposed = false;
  private tickTimer = 0;
  private muted: boolean;

  constructor(private ctx: AudioContext) {
    this.muted = safeGet() === "1";
    this.master = ctx.createGain();
    this.master.gain.value = 0;                       // silent until start() ramps it (or stays 0 if muted)
    this.master.connect(ctx.destination);
  }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    const ctx = this.ctx;
    // Low drone: a few detuned low voices through a lowpass whose cutoff breathes on a slow LFO.
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 210; lp.Q.value = 0.6;
    lp.connect(this.master);
    for (const [freq, detune] of [[55, -5], [55, 6], [82.41, 0]] as const) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = 0.11;
      o.connect(g); g.connect(lp); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 55;
    lfo.connect(lfoDepth); lfoDepth.connect(lp.frequency); lfo.start();
    this.scheduleTick();
    this.applyMute();
  }

  private scheduleTick() {
    if (this.disposed) return;
    this.tickTimer = window.setTimeout(() => {
      this.printerTick();
      this.scheduleTick();
    }, 3200 + Math.random() * 4200);                  // irregular, like a press that only prints when it must
  }

  // A short band-passed noise blip: the line printer striking a single character.
  private printerTick() {
    if (this.disposed) return;
    const ctx = this.ctx, now = ctx.currentTime, dur = 0.045;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 1.8;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(now);
  }

  private applyMute() {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, now + 0.9);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    safeSet(this.muted ? "1" : "0");
    if (this.started) this.applyMute();
    return this.muted;
  }
  isMuted() { return this.muted; }

  dispose() {
    this.disposed = true;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    try { this.master.disconnect(); } catch { /* already gone */ }
  }
}

function safeGet(): string | null { try { return localStorage.getItem(MUTE_KEY); } catch { return null; } }
function safeSet(v: string) { try { localStorage.setItem(MUTE_KEY, v); } catch { /* private mode */ } }
