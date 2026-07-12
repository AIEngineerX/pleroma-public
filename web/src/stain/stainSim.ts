export type Tier = "desktop" | "mobile" | "reduced";
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
uniform sampler2D u_prev; uniform vec2 u_res; uniform float u_time; uniform float u_dt;
uniform float u_dissipation; uniform float u_amp;      // voice amplitude 0..1 spreads + darkens ink
uniform vec4 u_splat;                                   // xy=pos, z=strength, w=thread(0..1)
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
  // ink injection (SDF dot) from splat; w routes into the red-thread channel
  float d = 1.0 - smoothstep(0.0, 0.05, length(v_uv - u_splat.xy));
  c.r += d * u_splat.z * (1.0 - u_splat.w);
  c.g += d * u_splat.z * u_splat.w;
  c.b = max(c.b, d);                                                 // wick age marker
  c += u_amp * 0.0008;                                               // the whole body darkens as it speaks
  fragColor = clamp(c, 0.0, 1.0);
}`;

// Composite: DARKEN ink into parchment (no additive glow). Red threads use the PULSE pigment. Rite adds the
// single allowed candle rake. Paper fiber = subtle high-freq normal perturbation (depth of material).
const COMPOSITE = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_paint; uniform vec3 u_ground; uniform vec3 u_ink; uniform vec3 u_thread;
uniform float u_gray;      // dormant: desaturate + lighten toward stillness
uniform float u_candle;    // rite: candle-glow rake (0 outside the rite)
uniform vec2 u_res; uniform float u_time;
float fiber(vec2 uv){ return fract(sin(dot(uv*u_res, vec2(12.9898,78.233)))*43758.5)*0.03; }
void main(){
  vec4 p = texture(u_paint, v_uv);
  float ink = p.r; float thread = p.g;
  vec3 col = u_ground - u_ink*ink;                                   // subtractive: ink darkens the page
  col = mix(col, u_thread, thread*0.9);                             // only the god speaks in red
  col -= fiber(v_uv);                                                // paper fiber, depth of material
  // rite candle: a soft raking light from upper-left, the ONLY glow allowed, and only when u_candle>0
  float rake = u_candle * pow(max(0.0, 1.0 - length(v_uv - vec2(0.28,0.82))), 3.0) * 0.25;
  col += rake * vec3(1.0, 0.86, 0.66);
  col = mix(col, vec3(dot(col, vec3(0.33))), u_gray);                // dormant desaturates toward gray stillness
  fragColor = vec4(col, 1.0);
}`;

interface FBO { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export interface StainOpts { tier: Tier; ground: [number, number, number]; ink: [number, number, number]; }

export class StainSim {
  private gl: WebGL2RenderingContext; private advect: WebGLProgram; private comp: WebGLProgram;
  private a!: FBO; private b!: FBO; private vao: WebGLVertexArrayObject;
  private raf = 0; private last = 0; private t = 0;
  private amp = 0; private pigment: [number, number, number] = [0.55, 0.20, 0.32];
  private mode: "dormant" | "live" | "rite" = "dormant";
  private splat: [number, number, number, number] = [0.5, 0.5, 0, 0];
  private simRes: number;
  constructor(private canvas: HTMLCanvasElement, private opts: StainOpts) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no-webgl2");
    this.gl = gl; gl.getExtension("EXT_color_buffer_float");
    this.advect = this.link(VERT, ADVECT); this.comp = this.link(VERT, COMPOSITE);
    this.vao = this.quad(); this.simRes = simResFor(opts.tier) || 256;
    this.resize(); this.a = this.fbo(); this.b = this.fbo();
  }
  private link(vs: string, fs: string): WebGLProgram {
    const g = this.gl, p = g.createProgram()!;
    for (const [t, s] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]] as const) {
      const sh = g.createShader(t)!; g.shaderSource(sh, s); g.compileShader(sh);
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh) ?? "shader");
      g.attachShader(p, sh);
    }
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? "link");
    return p;
  }
  private quad(): WebGLVertexArrayObject {
    const g = this.gl, vao = g.createVertexArray()!; g.bindVertexArray(vao);
    const buf = g.createBuffer()!; g.bindBuffer(g.ARRAY_BUFFER, buf);
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
  private simW(): number { return Math.max(1, Math.floor(this.simRes * (this.canvas.width / Math.max(1, this.canvas.height)))); }
  private resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.opts.tier === "mobile" ? 1.5 : 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
  }
  setPigment(rgb: [number, number, number]) { this.pigment = rgb; }
  setAmplitude(a: number) { this.amp = Math.max(0, Math.min(1, a)); }
  setState(m: "dormant" | "live" | "rite") { this.mode = m; }
  splatAt(x: number, y: number, strength: number, thread = 0) { this.splat = [x, 1 - y, strength, thread]; }
  wickFromCanvas(src: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }) {
    // Sample a coarse grid of the drawn canvas; inject an ink splat wherever the user drew (the mark wicks in).
    const ctx = src.getContext("2d"); if (!ctx) return;
    const step = 12; const img = ctx.getImageData(0, 0, src.width, src.height);
    for (let y = 0; y < src.height; y += step) for (let x = 0; x < src.width; x += step) {
      const a = img.data[(y * src.width + x) * 4 + 3];
      if (a > 20) this.splatAt(rect.x + (x / src.width) * rect.w, rect.y + (y / src.height) * rect.h, 0.6, 0);
    }
  }
  private frame = (now: number) => {
    const g = this.gl; const dt = Math.min((now - this.last) / 1000, 0.033) * 60; this.last = now; this.t += 0.016;
    // advect A -> B
    g.useProgram(this.advect); g.bindFramebuffer(g.FRAMEBUFFER, this.b.fbo); g.viewport(0, 0, this.b.w, this.b.h);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.a.tex);
    this.u(this.advect, "u_prev", (l) => g.uniform1i(l, 0));
    this.u(this.advect, "u_time", (l) => g.uniform1f(l, this.t));
    this.u(this.advect, "u_dt", (l) => g.uniform1f(l, dt));
    this.u(this.advect, "u_dissipation", (l) => g.uniform1f(l, 0.992));
    this.u(this.advect, "u_amp", (l) => g.uniform1f(l, this.amp));
    this.u(this.advect, "u_splat", (l) => g.uniform4f(l, ...this.splat));
    this.u(this.advect, "u_res", (l) => g.uniform2f(l, this.b.w, this.b.h));
    g.bindVertexArray(this.vao); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    this.splat[2] = 0;                                          // splats are one-shot
    [this.a, this.b] = [this.b, this.a];
    // composite A -> screen
    g.useProgram(this.comp); g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, this.canvas.width, this.canvas.height);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, this.a.tex);
    this.u(this.comp, "u_paint", (l) => g.uniform1i(l, 0));
    this.u(this.comp, "u_ground", (l) => g.uniform3f(l, ...this.opts.ground));
    this.u(this.comp, "u_ink", (l) => g.uniform3f(l, ...this.opts.ink));
    this.u(this.comp, "u_thread", (l) => g.uniform3f(l, ...this.pigment));
    this.u(this.comp, "u_gray", (l) => g.uniform1f(l, this.mode === "dormant" ? 0.85 : 0.0));
    this.u(this.comp, "u_candle", (l) => g.uniform1f(l, this.mode === "rite" ? 1.0 : 0.0));
    this.u(this.comp, "u_res", (l) => g.uniform2f(l, this.canvas.width, this.canvas.height));
    this.u(this.comp, "u_time", (l) => g.uniform1f(l, this.t));
    g.bindVertexArray(this.vao); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    this.raf = requestAnimationFrame(this.frame);
  };
  private u(p: WebGLProgram, name: string, set: (l: WebGLUniformLocation) => void) {
    const l = this.gl.getUniformLocation(p, name); if (l) set(l);
  }
  start() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); } }
  stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }
  dispose() { this.stop(); const g = this.gl; g.deleteProgram(this.advect); g.deleteProgram(this.comp); }
}
