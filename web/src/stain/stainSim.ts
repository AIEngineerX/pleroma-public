import { OrganSwarm } from "./organSwarm";
import type { BodyCommand, RelicInkSample, VitalsFeed } from "../experience/types";
import {
  RELIC_ACCRETION_DURATION_MS,
  RELIC_SAMPLE_SIZE,
  RELIC_TRAVEL_INITIAL_SCALE,
  RELIC_TRAVEL_THRESHOLD,
  foldRelicSamples,
  mergeRelicAlpha,
  relicAccretionKey,
} from "./relicInk";
import {
  BODY_ANCHORS,
  WEBGL_SERAPH_GATHER_MS,
  commitRelicSample,
  completedSeraphSequenceCount,
  dedupeRelicSamples,
  relicSampleListsMatch,
  signalForBodyCommand,
  type BodyAnchor,
  type BodyAnchorName,
  type BodyRendererAdapter,
  type BodySemanticSnapshot,
} from "./bodyRenderer";

export type Tier = "desktop" | "mobile" | "reduced";
export const ARRIVAL_DURATION_MS = 2_500;
export const ACCRETION_DURATION_MS = RELIC_ACCRETION_DURATION_MS;
export const SERAPH_CONVERGE_MS = WEBGL_SERAPH_GATHER_MS;
export const SERAPH_HOLD_MS = 6_000;
export const SERAPH_DISSOLVE_MS = 2_400;

export interface SeraphConvergenceFrame {
  phase: "gather" | "hold" | "dissolve" | "five";
  convergence: number;
  complete: boolean;
}

function easeOutExpo(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return 1 - 2 ** (-10 * progress);
}

export function seraphConvergenceFrame(elapsedMs: number): SeraphConvergenceFrame {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < SERAPH_CONVERGE_MS) {
    return {
      phase: "gather",
      convergence: easeOutExpo(elapsed / SERAPH_CONVERGE_MS),
      complete: false,
    };
  }
  if (elapsed < SERAPH_CONVERGE_MS + SERAPH_HOLD_MS) {
    return { phase: "hold", convergence: 1, complete: false };
  }
  const dissolveElapsed = elapsed - SERAPH_CONVERGE_MS - SERAPH_HOLD_MS;
  if (dissolveElapsed < SERAPH_DISSOLVE_MS) {
    return {
      phase: "dissolve",
      convergence: 1 - easeOutExpo(dissolveElapsed / SERAPH_DISSOLVE_MS),
      complete: false,
    };
  }
  return { phase: "five", convergence: 0, complete: true };
}

export function accretionProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= ACCRETION_DURATION_MS) return 1;
  const normalized = elapsedMs / ACCRETION_DURATION_MS;
  return 1 - (1 - normalized) ** 3;
}

export function arrivalProgress(elapsedMs: number, startsSettled = false): number {
  if (startsSettled || elapsedMs >= ARRIVAL_DURATION_MS) return 1;
  if (elapsedMs <= 0) return 0;
  const normalized = elapsedMs / ARRIVAL_DURATION_MS;
  return 1 - 2 ** (-10 * normalized);
}

export function pickTier(): Tier {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced";
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const narrow = typeof window !== "undefined" && window.innerWidth < 820;
  return coarse || narrow ? "mobile" : "desktop";
}
export function simResFor(tier: Tier): number { return tier === "reduced" ? 0 : tier === "mobile" ? 256 : 512; }

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`;

// Advection: curl-noise divergence-free flow carries ink density (r = ink, g = red-thread density, b = wick age).
const ADVECT = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_prev; uniform sampler2D u_swarm; uniform vec2 u_res; uniform float u_time; uniform float u_dt;
uniform float u_dissipation; uniform float u_amp;      // voice amplitude 0..1 spreads + darkens ink
uniform vec4 u_splat;                                   // xy=pos, z=strength, w=thread(0..1)
uniform float u_ambient;                                // ambient body presence: the sleeping god has a form
uniform float u_threadAmb;                              // ambient red-thread density woven through that body
uniform vec2  u_point;                                  // pointer position (uv), the body leans toward it
uniform float u_pointAmt;                               // pointer wick influence 0..1 (decays when still)
vec2 hash(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy)*2.0-1.0; }
vec3 noised(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0); vec2 du=30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga=hash(i),gb=hash(i+vec2(1,0)),gc=hash(i+vec2(0,1)),gd=hash(i+vec2(1,1));
  float va=dot(ga,f),vb=dot(gb,f-vec2(1,0)),vc=dot(gc,f-vec2(0,1)),vd=dot(gd,f-vec2(1,1));
  return vec3(va+u.x*(vb-va)+u.y*(vc-va)+u.x*u.y*(va-vb-vc+vd),
    ga+u.x*(gb-ga)+u.y*(gc-ga)+u.x*u.y*(ga-gb-gc+gd)+du*(u.yx*(va-vb-vc+vd)+vec2(vb,vc)-va)); }
vec2 curl(vec2 p){ vec3 n=noised(p); return vec2(n.z,-n.y); }
void main(){
  float scale = 3.2; float strength = 0.0012 * (1.0 + u_amp*1.6);   // amplitude widens the flow
  vec2 v = curl(v_uv*scale + u_time*0.03);
  vec2 src = v_uv - v*strength*u_dt;
  vec4 c = texture(u_prev, src) * u_dissipation;
  // The organ trail is a density source in this SAME field. Its wet marks are then carried by the
  // membrane flow; there is no second luminous layer composited over the page.
  vec4 swarm = texture(u_swarm, v_uv);
  c.r += swarm.r * .010 * u_dt;
  c.g += swarm.g * .012 * u_dt;
  c.b = max(c.b, swarm.b);
  // ink injection (SDF dot) from an offering splat; w routes into the red-thread channel
  float d = 1.0 - smoothstep(0.0, 0.05, length(v_uv - u_splat.xy));
  c.r += d * u_splat.z * (1.0 - u_splat.w);
  c.g += d * u_splat.z * u_splat.w;
  c.b = max(c.b, d);                                                 // wick age marker
  // AMBIENT BODY: an organic, breathing ink form gathered toward the heart, so the god is PRESENT
  // (a sleeping shape, not a blank field) before it ever wakes. Two slow value-noise octaves shape it,
  // a soft radial silhouette gives it a body instead of a full-bleed rectangle, and a slow global breath
  // makes it respire. Re-seeded each frame via max() so it balances the dissipation into a stable form.
  float breath = 0.86 + 0.14 * sin(u_time * 0.55);
  vec2  pc = (v_uv - 0.5) * vec2(1.0, 1.12);
  float radial = smoothstep(0.62, 0.08, length(pc));
  float n1 = noised(v_uv * 3.6 + u_time * 0.02).x * 0.5 + 0.5;
  float n2 = noised(v_uv * 8.0 - u_time * 0.015).x * 0.5 + 0.5;
  float n3 = noised(v_uv * 17.0 + u_time * 0.03).x * 0.5 + 0.5;      // fine octave: wicking fibers / filament detail
  float dens = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;
  float body = radial * pow(dens, 2.0) * breath;                    // higher contrast: ink tendrils, not soft smoke
  c.r = max(c.r, body * u_ambient);
  // red threads run only through the densest filament cores (smoothstep on the fine octave), so the pulse
  // reads as veins woven through the body rather than a flat wash over it. Dried rubric while dormant.
  c.g = max(c.g, body * u_ambient * u_threadAmb * smoothstep(0.5, 0.9, n3) * 2.0);
  // pointer wick: the ink leans toward the cursor, so the body feels aware of you (the smoothing IS the life)
  float pd = 1.0 - smoothstep(0.0, 0.18, length(v_uv - u_point));
  c.r = max(c.r, pd * u_pointAmt * 0.5 * radial);
  c.r += u_amp * 0.0008;                                            // speaking changes ink density, never hue
  fragColor = clamp(c, 0.0, 1.0);
}`;

// Composite only the living marks. The CSS document owns its paper in every state, so WebGL must remain
// transparent and premultiplied instead of painting a second, independently colored substrate.
const COMPOSITE = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_paint; uniform vec3 u_ink; uniform vec3 u_thread;
uniform sampler2D u_relicMemory; uniform sampler2D u_activeRelic;
uniform float u_accretionProgress; uniform float u_accretionActive;
uniform float u_gray;      // dormant: a WHISPER toward stillness (not the corpse-gray crush it once was)
void main(){
  vec4 p = texture(u_paint, v_uv);
  float ink = p.r; float thread = p.g;
  // Confirmed relic memory is one bounded 64x64 alpha mask, folded from the retained public
  // samples. A newly confirmed imprint begins at the fixed lower threshold, grows into its final
  // placement for 1.2s, then is folded into the same persistent mask by the CPU controller.
  float dried = texture(u_relicMemory, v_uv).r;
  vec2 threshold = vec2(${RELIC_TRAVEL_THRESHOLD.x}, ${RELIC_TRAVEL_THRESHOLD.y});
  vec2 destination = vec2(0.5, 0.5);
  vec2 travelCenter = mix(threshold, destination, u_accretionProgress);
  float travelScale = mix(${RELIC_TRAVEL_INITIAL_SCALE}, 1.0, u_accretionProgress);
  vec2 travelUv = (v_uv - travelCenter) / travelScale + 0.5;
  float inside = step(0.0, travelUv.x) * step(travelUv.x, 1.0)
    * step(0.0, travelUv.y) * step(travelUv.y, 1.0);
  float traveling = texture(u_activeRelic, clamp(travelUv, 0.0, 1.0)).r
    * inside * u_accretionActive;
  float relicInk = max(dried * 0.34, traveling * 0.46);
  float alpha = clamp(max(max(ink, thread * 0.9), relicInk), 0.0, 0.88);
  float threadWeight = clamp(thread * 1.35, 0.0, 1.0);
  vec3 markColor = mix(u_ink, u_thread, threadWeight);
  markColor = mix(markColor, vec3(dot(markColor, vec3(0.30, 0.34, 0.30))), u_gray);
  fragColor = vec4(markColor * alpha, alpha);
}`;

interface FBO { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export interface StainOpts {
  tier: Tier;
  ink: [number, number, number];
  arrivalStartedAt: number;
  seraphTargets: Float32Array;
  onArrivalDone(): void;
  onSeraphPhaseChange?(phase: SeraphConvergenceFrame["phase"]): void;
}

function seraphTargetExtents(targets: Float32Array): number[][] {
  const extents = Array.from({ length: 5 }, () => [
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]);
  for (let at = 0; at < targets.length; at += 4) {
    const organ = Math.max(0, Math.min(4, Math.round(targets[at + 2])));
    const extent = extents[organ];
    extent[0] = Math.min(extent[0], targets[at]);
    extent[1] = Math.max(extent[1], targets[at]);
    extent[2] = Math.min(extent[2], targets[at + 1]);
    extent[3] = Math.max(extent[3], targets[at + 1]);
  }
  return extents.map((extent) => extent.map((value) => Number(value.toFixed(6))));
}

function initialAnchors(): Record<BodyAnchorName, BodyAnchor> {
  return {
    EYE: { ...BODY_ANCHORS.EYE },
    KEEP: { ...BODY_ANCHORS.KEEP },
    TONGUE: { ...BODY_ANCHORS.TONGUE },
    PULSE: { ...BODY_ANCHORS.PULSE },
    DREAM: { ...BODY_ANCHORS.DREAM },
    seraph: { ...BODY_ANCHORS.seraph },
  };
}

export class StainSim implements BodyRendererAdapter {
  private gl: WebGL2RenderingContext; private advect: WebGLProgram; private comp: WebGLProgram;
  private a!: FBO; private b!: FBO; private vao: WebGLVertexArrayObject; private buf!: WebGLBuffer;
  private raf = 0; private last = 0; private t = 0;
  private amp = 0; private pigment: [number, number, number] = [0.55, 0.20, 0.32];
  private mode: "dormant" | "live" | "rite" = "dormant";
  private splat: [number, number, number, number] = [0.5, 0.5, 0, 0];
  private point: [number, number] = [0.5, 0.5]; private pointAmt = 0;   // pointer wick, decays when the pointer stills
  private simRes: number;
  private swarm: OrganSwarm;
  private vitalsFeed: VitalsFeed = { kind: "unknown" };
  private relicMemory: RelicInkSample[] = [];
  private relicMask: Uint8Array = new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE);
  private relicTexture!: WebGLTexture;
  private activeRelicTexture!: WebGLTexture;
  private relicRevision = 0;
  private activeAccretion: {
    key: string;
    commandId: string;
    ink: RelicInkSample;
    startedAt: number;
    onComplete(id: string): void;
  } | null = null;
  private activeConvergence: {
    commandId: string;
    startedAt: number;
    onComplete(id: string): void;
  } | null = null;
  private seraphSequenceCount = 0;
  private seraphPhase: SeraphConvergenceFrame["phase"] = "five";
  private dreamResidue = false;
  private disposed = false;
  private anchorSink: ((anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => void) | null = null;
  private readonly anchorBuffer = new Float32Array(10);
  private readonly anchors = initialAnchors();
  private arrivalComplete = false;
  constructor(private canvas: HTMLCanvasElement, private opts: StainOpts) {
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no-webgl2");
    this.gl = gl; gl.getExtension("EXT_color_buffer_float");
    this.advect = this.link(VERT, ADVECT); this.comp = this.link(VERT, COMPOSITE);
    this.vao = this.quad(); this.simRes = simResFor(opts.tier) || 256;
    this.resize(); this.a = this.fbo(); this.b = this.fbo();
    if (opts.tier === "reduced") throw new Error("reduced-motion-has-no-simulation");
    const initialArrival = arrivalProgress(performance.now() - opts.arrivalStartedAt);
    this.swarm = new OrganSwarm(
      gl,
      opts.tier,
      this.vao,
      this.a.w,
      this.a.h,
      opts.seraphTargets,
      initialArrival,
    );
    this.relicTexture = this.alphaTexture();
    this.activeRelicTexture = this.alphaTexture();
    this.updateRelicDebug();
    this.canvas.dataset.arrival = initialArrival >= 1 ? "settled" : "emerging";
    this.canvas.dataset.compositeGround = "transparent";
    this.canvas.dataset.arrivalProgress = initialArrival.toFixed(3);
    this.canvas.dataset.seraphPhase = "five";
    this.canvas.dataset.seraphConvergence = "0.000";
    this.canvas.dataset.seraphSequenceCount = "0";
    this.canvas.dataset.dreamResidue = "none";
    this.canvas.dataset.seraphTiming = `${SERAPH_CONVERGE_MS}/${SERAPH_HOLD_MS}/${SERAPH_DISSOLVE_MS}`;
    this.canvas.dataset.seraphTargetSize = String(Math.sqrt(opts.seraphTargets.length / 4));
    this.canvas.dataset.seraphTargetCount = String(opts.seraphTargets.length / 4);
    this.canvas.dataset.seraphTargetNonzero = String(
      opts.seraphTargets.reduce((count, value, index) => (
        index % 4 === 3 && value > 0 ? count + 1 : count
      ), 0),
    );
    this.canvas.dataset.seraphTargetExtents = JSON.stringify(seraphTargetExtents(opts.seraphTargets));
  }
  private link(vs: string, fs: string): WebGLProgram {
    const g = this.gl, p = g.createProgram()!, shaders: WebGLShader[] = [];
    for (const [t, s] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]] as const) {
      const sh = g.createShader(t)!; g.shaderSource(sh, s); g.compileShader(sh);
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh) ?? "shader");
      g.attachShader(p, sh); shaders.push(sh);
    }
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? "link");
    for (const sh of shaders) g.deleteShader(sh); // attached shaders are retained by the linked program, freed with it
    return p;
  }
  private quad(): WebGLVertexArrayObject {
    const g = this.gl, vao = g.createVertexArray()!; g.bindVertexArray(vao);
    const buf = this.buf = g.createBuffer()!; g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0); return vao;
  }
  private fbo(): FBO {
    const g = this.gl, w = this.simW(), h = this.simRes, tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, w, h, 0, g.RGBA, g.HALF_FLOAT, null);
    for (const p of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, p, g.LINEAR);
    for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, p, g.CLAMP_TO_EDGE);
    const fbo = g.createFramebuffer()!; g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }
  private alphaTexture(): WebGLTexture {
    const g = this.gl;
    const texture = g.createTexture();
    if (texture === null) throw new Error("relic texture is unavailable");
    g.bindTexture(g.TEXTURE_2D, texture);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.R8,
      RELIC_SAMPLE_SIZE,
      RELIC_SAMPLE_SIZE,
      0,
      g.RED,
      g.UNSIGNED_BYTE,
      new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE),
    );
    for (const parameter of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) {
      g.texParameteri(g.TEXTURE_2D, parameter, g.LINEAR);
    }
    for (const parameter of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) {
      g.texParameteri(g.TEXTURE_2D, parameter, g.CLAMP_TO_EDGE);
    }
    return texture;
  }
  private uploadAlpha(texture: WebGLTexture, alpha: Uint8Array) {
    const g = this.gl;
    g.bindTexture(g.TEXTURE_2D, texture);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texSubImage2D(
      g.TEXTURE_2D,
      0,
      0,
      0,
      RELIC_SAMPLE_SIZE,
      RELIC_SAMPLE_SIZE,
      g.RED,
      g.UNSIGNED_BYTE,
      alpha,
    );
  }
  private simW(): number { return Math.max(1, Math.floor(this.simRes * (this.canvas.width / Math.max(1, this.canvas.height)))); }
  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.tier === "mobile" ? 1.5 : 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
  }
  setPigment(rgb: [number, number, number]) { this.pigment = rgb; }
  setAmplitude(a: number) { this.amp = Math.max(0, Math.min(1, a)); }
  setState(m: "dormant" | "live" | "rite") {
    this.mode = m;
    this.canvas.dataset.presentationMode = m;
  }
  dispatch(
    command: BodyCommand,
    onComplete: (id: string) => void,
    presentationStartedAt = performance.now(),
  ) {
    if (this.disposed) {
      onComplete(command.id);
      return;
    }
    const signal = signalForBodyCommand(command);
    if (signal !== null) this.swarm.dispatch(signal);
    if (command.kind === "accrete") {
      if (this.activeAccretion !== null) return;
      const key = relicAccretionKey(command.relic);
      const placed = mergeRelicAlpha(
        new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE),
        command.ink,
        command.relic.offering_id,
      );
      this.uploadAlpha(this.activeRelicTexture, placed);
      this.activeAccretion = {
        key,
        commandId: command.id,
        ink: command.ink,
        startedAt: performance.now(),
        onComplete,
      };
      this.updateRelicDebug();
      return;
    }
    if (command.kind === "converge") {
      if (this.activeConvergence?.commandId === command.id) return;
      this.activeConvergence = {
        commandId: command.id,
        startedAt: presentationStartedAt,
        onComplete,
      };
      this.seraphSequenceCount += 1;
      this.swarm.dispatch({ organ: "DREAM", intensity: 1, pipeline: "none" });
      this.updateSeraphDebug(seraphConvergenceFrame(performance.now() - presentationStartedAt));
      return;
    }
    if (command.kind === "dissolve") {
      this.activeConvergence = null;
      this.swarm.setConvergence(0);
      this.updateSeraphDebug({ phase: "five", convergence: 0, complete: true });
    }
    onComplete(command.id);
  }
  hydrateRelics(samples: readonly RelicInkSample[]) {
    if (this.disposed) return;
    const next = dedupeRelicSamples(samples);
    if (relicSampleListsMatch(next, this.relicMemory)) return;
    this.relicMemory = next;
    this.relicMask = foldRelicSamples(this.relicMemory);
    this.uploadAlpha(this.relicTexture, this.relicMask);
    this.relicRevision += 1;
    this.updateRelicDebug();
  }
  semanticSnapshot(): BodySemanticSnapshot {
    const vitals = this.vitalsFeed.kind === "unknown"
      ? this.vitalsFeed
      : { ...this.vitalsFeed, value: { ...this.vitalsFeed.value } };
    return {
      relicMemory: dedupeRelicSamples(this.relicMemory),
      vitals,
      dreamResidue: this.dreamResidue,
      completedSeraphSequenceCount: completedSeraphSequenceCount(
        this.seraphSequenceCount,
        this.activeConvergence !== null,
      ),
    };
  }
  getAnchor(name: BodyAnchorName): BodyAnchor { return { ...this.anchors[name] }; }
  setAnchorSink(sink: ((anchors: Readonly<Record<BodyAnchorName, BodyAnchor>>) => void) | null) {
    this.anchorSink = sink;
  }
  setVitals(feed: VitalsFeed) {
    this.vitalsFeed = feed;
    this.swarm.setVitals(this.vitalsFeed);
  }
  splatAt(x: number, y: number, strength: number, thread = 0) { this.splat = [x, 1 - y, strength, thread]; }
  // The body leans toward the pointer: feed normalized (x,y in 0..1); the wick decays each frame when still.
  setPointer(x: number, y: number) { this.point = [x, 1 - y]; this.pointAmt = 1; }
  private commitRelic(ink: RelicInkSample) {
    const next = commitRelicSample(this.relicMemory, ink);
    if (relicSampleListsMatch(next, this.relicMemory)) return;
    this.relicMemory = next;
    this.relicMask = foldRelicSamples(this.relicMemory);
    this.uploadAlpha(this.relicTexture, this.relicMask);
    this.relicRevision += 1;
  }
  private updateRelicDebug() {
    this.canvas.dataset.relicCount = String(this.relicMemory.length);
    this.canvas.dataset.relicRevision = String(this.relicRevision);
    this.canvas.dataset.relicMaskNonzero = String(
      this.relicMask.reduce((count, alpha) => count + Number(alpha > 0), 0),
    );
    if (this.activeAccretion === null) delete this.canvas.dataset.accretionActiveKey;
    else this.canvas.dataset.accretionActiveKey = this.activeAccretion.key;
  }
  private updateSeraphDebug(frame: SeraphConvergenceFrame) {
    this.canvas.dataset.seraphPhase = frame.phase;
    this.canvas.dataset.seraphConvergence = frame.convergence.toFixed(3);
    this.canvas.dataset.seraphSequenceCount = String(this.seraphSequenceCount);
    if (frame.phase !== this.seraphPhase) {
      this.seraphPhase = frame.phase;
      this.opts.onSeraphPhaseChange?.(frame.phase);
    }
  }
  private frame = (now: number) => {
    const g = this.gl;
    const dtSeconds = Math.min((now - this.last) / 1000, 0.033);
    const dt = dtSeconds * 60;
    this.last = now; this.t += dtSeconds;
    const emergence = arrivalProgress(now - this.opts.arrivalStartedAt);
    this.swarm.setEmergence(emergence);
    this.canvas.dataset.arrival = emergence >= 1 ? "settled" : "emerging";
    this.canvas.dataset.arrivalProgress = emergence.toFixed(3);
    if (emergence >= 1 && !this.arrivalComplete) {
      this.arrivalComplete = true;
      this.opts.onArrivalDone();
    }
    let relicProgress = 0;
    let accretionActive = 0;
    const pendingAccretion = this.activeAccretion;
    if (pendingAccretion !== null) {
      relicProgress = accretionProgress(now - pendingAccretion.startedAt);
      if (relicProgress >= 1) {
        this.activeAccretion = null;
        this.commitRelic(pendingAccretion.ink);
        this.uploadAlpha(
          this.activeRelicTexture,
          new Uint8Array(RELIC_SAMPLE_SIZE * RELIC_SAMPLE_SIZE),
        );
        this.updateRelicDebug();
        pendingAccretion.onComplete(pendingAccretion.commandId);
      } else {
        accretionActive = 1;
      }
    }
    // Per-mode mood. Dormant keeps a real (breathing) body with dried threads and only a whisper of stillness.
    // During the rite the same marks change ink; the CSS sheet remains the single source of ground.
    const m = this.mode;
    const ambient = m === "dormant" ? 0.62 : m === "live" ? 0.82 : 1.0;
    const knownThreadAmb = m === "dormant" ? 0.22 : m === "live" ? 0.5 : 0.6;
    const threadAmb = this.vitalsFeed.kind === "unknown" ? 0 : knownThreadAmb;
    const gray = m === "dormant" ? 0.22 : 0.0;
    this.pointAmt *= 0.95;                                      // the pointer wick fades as the pointer stills
    const convergence = this.activeConvergence;
    const convergenceFrame = convergence === null
      ? { phase: "five", convergence: 0, complete: false } satisfies SeraphConvergenceFrame
      : seraphConvergenceFrame(now - convergence.startedAt);
    this.swarm.setConvergence(convergenceFrame.convergence);
    this.updateSeraphDebug(convergenceFrame);
    if (convergence !== null && convergenceFrame.complete) {
      this.activeConvergence = null;
      this.dreamResidue = true;
      this.canvas.dataset.dreamResidue = "sophia";
      this.swarm.dispatch({ organ: "DREAM", intensity: 0.35, pipeline: "none" });
      convergence.onComplete(convergence.commandId);
    }
    this.swarm.step(this.t, dtSeconds);
    this.swarm.copyAnchors(this.anchorBuffer);
    for (let organ = 0; organ < 5; organ += 1) {
      const name = (["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"] as const)[organ];
      this.anchors[name].x = this.anchorBuffer[organ * 2];
      this.anchors[name].y = this.anchorBuffer[organ * 2 + 1];
    }
    this.anchorSink?.(this.anchors);
    // advect A -> B
    g.useProgram(this.advect); g.bindFramebuffer(g.FRAMEBUFFER, this.b.fbo); g.viewport(0, 0, this.b.w, this.b.h);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.a.tex);
    this.u(this.advect, "u_prev", (l) => g.uniform1i(l, 0));
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, this.swarm.texture);
    this.u(this.advect, "u_swarm", (l) => g.uniform1i(l, 1));
    this.u(this.advect, "u_time", (l) => g.uniform1f(l, this.t));
    this.u(this.advect, "u_dt", (l) => g.uniform1f(l, dt));
    this.u(this.advect, "u_dissipation", (l) => g.uniform1f(l, 0.992));
    this.u(this.advect, "u_amp", (l) => g.uniform1f(l, this.amp));
    this.u(this.advect, "u_splat", (l) => g.uniform4f(l, ...this.splat));
    this.u(this.advect, "u_ambient", (l) => g.uniform1f(l, ambient));
    this.u(this.advect, "u_threadAmb", (l) => g.uniform1f(l, threadAmb));
    this.u(this.advect, "u_point", (l) => g.uniform2f(l, this.point[0], this.point[1]));
    this.u(this.advect, "u_pointAmt", (l) => g.uniform1f(l, this.pointAmt));
    this.u(this.advect, "u_res", (l) => g.uniform2f(l, this.b.w, this.b.h));
    g.bindVertexArray(this.vao); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    this.splat[2] = 0;                                          // splats are one-shot
    [this.a, this.b] = [this.b, this.a];
    // composite A -> screen
    g.useProgram(this.comp); g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, this.canvas.width, this.canvas.height);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.a.tex);
    this.u(this.comp, "u_paint", (l) => g.uniform1i(l, 0));
    g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, this.relicTexture);
    this.u(this.comp, "u_relicMemory", (l) => g.uniform1i(l, 2));
    g.activeTexture(g.TEXTURE3); g.bindTexture(g.TEXTURE_2D, this.activeRelicTexture);
    this.u(this.comp, "u_activeRelic", (l) => g.uniform1i(l, 3));
    this.u(this.comp, "u_accretionProgress", (l) => g.uniform1f(l, relicProgress));
    this.u(this.comp, "u_accretionActive", (l) => g.uniform1f(l, accretionActive));
    const documentInk: [number, number, number] = this.mode === "rite"
      ? [0.90, 0.87, 0.78]
      : this.opts.ink;
    this.u(this.comp, "u_ink", (l) => g.uniform3f(l, ...documentInk));
    this.u(this.comp, "u_thread", (l) => g.uniform3f(l, ...this.pigment));
    this.u(this.comp, "u_gray", (l) => g.uniform1f(l, gray));
    g.bindVertexArray(this.vao); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    this.raf = requestAnimationFrame(this.frame);
  };
  private u(p: WebGLProgram, name: string, set: (l: WebGLUniformLocation) => void) {
    const l = this.gl.getUniformLocation(p, name); if (l) set(l);
  }
  start() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); } }
  stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.activeAccretion = null;
    this.activeConvergence = null;
    this.swarm.setConvergence(0);
    this.updateRelicDebug();
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    const g = this.gl;
    this.anchorSink = null;
    this.swarm.dispose();
    g.deleteProgram(this.advect); g.deleteProgram(this.comp);
    g.deleteFramebuffer(this.a.fbo); g.deleteTexture(this.a.tex);
    g.deleteFramebuffer(this.b.fbo); g.deleteTexture(this.b.tex);
    g.deleteTexture(this.relicTexture); g.deleteTexture(this.activeRelicTexture);
    g.deleteVertexArray(this.vao); g.deleteBuffer(this.buf);
  }
}
