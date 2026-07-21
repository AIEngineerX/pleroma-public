import type { BecomingPiece } from "./pieces";
import { computeCanvasBackingSize, type Tier } from "../stain/stainSim";

export interface BecomingSimOpts {
  tier: Exclude<Tier, "reduced">;
  ink: readonly [number, number, number]; // gamma sRGB, e.g. oklchToRgb("oklch(0.25 0.02 60)")
}

export interface BecomingSimHandle {
  setPieces(pieces: readonly BecomingPiece[], newestOfferingId: string | null): void;
  dispose(): void;
}

const PIECE_STRIDE = 5; // x, y, scale, rotation, genesis

// Packs pieces into a flat vertex buffer, one 5-float row per piece, matching the accumulation
// vertex shader's attribute layout (a_pos, a_scale, a_rotation, a_genesis). Pure so the buffer's
// row order and values can be asserted without a WebGL context.
export function packPieceAttributes(pieces: readonly BecomingPiece[]): Float32Array {
  const data = new Float32Array(pieces.length * PIECE_STRIDE);
  pieces.forEach((piece, index) => {
    const at = index * PIECE_STRIDE;
    data[at] = piece.x;
    data[at + 1] = piece.y;
    data[at + 2] = piece.scale;
    data[at + 3] = piece.rotation;
    data[at + 4] = piece.genesis ? 1 : 0;
  });
  return data;
}

// Accumulation bake resolution — fixed and independent of canvas DPR, mirroring stainSim's
// simResFor: the welded-piece bake is cheap and coarse; the display canvas does the DPR work.
export function accumResolutionFor(tier: Exclude<Tier, "reduced">): number {
  return tier === "mobile" ? 256 : 512;
}

export interface Uv { readonly x: number; readonly y: number }

// Maps a canvas-space UV coordinate (0..1 across the whole canvas box) to body-space UV (0..1 across
// the square accumulation texture), replicating SVG preserveAspectRatio="xMidYMid meet": the square
// body scales to the canvas's SHORTER dimension, centered, with the longer dimension pillarboxed or
// letterboxed. The canvas (becomingSim) is layered directly over SettledBecoming's
// viewBox="0 0 100 100" SVG and must register at the same on-screen positions regardless of the
// container's aspect ratio — see the composite shader, which applies this same math per-fragment via
// u_aspect. Returns null for canvas-space points that fall in the letterbox/pillarbox margin, where
// there is no body to show. Pure so the fit can be asserted without a WebGL context.
export function fitBodyUv(uv: Uv, aspect: number): Uv | null {
  const squareWidthFrac = Math.min(1, 1 / aspect);
  const squareHeightFrac = Math.min(1, aspect);
  const offsetX = (1 - squareWidthFrac) / 2;
  const offsetY = (1 - squareHeightFrac) / 2;
  const x = (uv.x - offsetX) / squareWidthFrac;
  const y = (uv.y - offsetY) / squareHeightFrac;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

const FULLSCREEN_VERT = `#version 300 es
layout(location=0) in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }`;

// One point sprite per welded piece; the whole body-so-far bakes in a single draw call rather than
// N separate draws (mirrors relicInk.ts's fold-once-then-sample-many accumulation). The curve is the
// exact closed form of PIECE_PATH's quadratic bezier ("M-1 0 Q0 -1.4 1 0"): since its endpoints share
// x = ±1 and its control point sits at x = 0, x(t) is linear (t = (x+1)/2), so y(x) = 0.7*(x^2-1) —
// the same short etched arc SettledBecoming draws, evaluated analytically instead of tessellated.
const ACCUM_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_scale;
layout(location=2) in float a_rotation;
layout(location=3) in float a_genesis;
out float v_rotation;
out float v_genesis;
uniform float u_pointScale;
void main(){
  v_rotation = a_rotation;
  v_genesis = a_genesis;
  vec2 clip = vec2(a_pos.x*2.0-1.0, 1.0-a_pos.y*2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = clamp(a_scale*u_pointScale, 3.0, 96.0);
}`;

const ACCUM_FRAG = `#version 300 es
precision highp float;
in float v_rotation;
in float v_genesis;
out vec4 fragColor;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float s = sin(v_rotation), co = cos(v_rotation);
  vec2 lp = vec2(c.x*co+c.y*s, -c.x*s+c.y*co); // rotate into the piece's own unrotated frame
  if (abs(lp.x) > 1.0) discard;
  float curveY = 0.7*(lp.x*lp.x-1.0);
  float dist = abs(lp.y-curveY);
  float width = mix(0.11, 0.16, v_genesis);
  float coverage = 1.0-smoothstep(width*0.5, width, dist);
  if (coverage <= 0.0) discard;
  float alpha = coverage*mix(0.7, 0.95, v_genesis); // matches SettledBecoming's opacity per piece
  // Premultiplied source-over density, same idiom as organSwarm's ink stamp: this darkens the
  // accumulation texture, it never emits light.
  fragColor = vec4(alpha, alpha, alpha, alpha);
}`;

// Fullscreen composite: samples the baked accumulation texture, applies a gentle global breath, and
// (for the newest welded piece only) adds a pulsing glint — the SAME arc evaluated analytically
// against uv-space, so a live highlight needs no second bake. Before any of that, v_uv is refit from
// canvas-space into body-space via u_aspect (fitBodyUv's math, inlined for the per-fragment GPU path)
// so the square accumulation texture registers with SettledBecoming's SVG underneath at any canvas
// aspect ratio, the same xMidYMid-meet fit the SVG's own viewBox does.
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_accum;
uniform vec3 u_ink;
uniform float u_breath;
uniform float u_aspect;    // canvas width/height
uniform vec4 u_newest;      // xy=BODY-uv position, z=radius(uv units), w=rotation
uniform float u_newestGlint;
void main(){
  float squareW = min(1.0, 1.0/u_aspect);
  float squareH = min(1.0, u_aspect);
  vec2 offset = vec2((1.0-squareW)*0.5, (1.0-squareH)*0.5);
  vec2 bodyUv = (v_uv-offset)/vec2(squareW, squareH);
  if (bodyUv.x < 0.0 || bodyUv.x > 1.0 || bodyUv.y < 0.0 || bodyUv.y > 1.0) {
    fragColor = vec4(0.0); // letterbox/pillarbox margin — no body here
    return;
  }
  float alpha = texture(u_accum, bodyUv).r * u_breath;
  if (u_newestGlint > 0.0 && u_newest.z > 0.0) {
    vec2 d = (bodyUv-u_newest.xy)/u_newest.z;
    vec2 c = vec2(d.x, -d.y); // uv-space is clip-flipped relative to gl_PointCoord; undo it here
    float s = sin(u_newest.w), co = cos(u_newest.w);
    vec2 lp = vec2(c.x*co+c.y*s, -c.x*s+c.y*co);
    if (abs(lp.x) <= 1.0) {
      float curveY = 0.7*(lp.x*lp.x-1.0);
      float coverage = 1.0-smoothstep(0.55, 1.0, abs(lp.y-curveY));
      alpha = max(alpha, coverage*u_newestGlint);
    }
  }
  fragColor = vec4(u_ink*alpha, alpha);
}`;

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const program = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "becoming-shader");
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "becoming-link");
  for (const shader of shaders) gl.deleteShader(shader); // attached shaders are retained by the linked program, freed with it
  return program;
}

function createTarget(gl: WebGL2RenderingContext, width: number, height: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, tex };
}

interface NewestGlint { x: number; y: number; radius: number; rotation: number }

// Mirrors stainSim.ts's raw-WebGL2 shape (createProgram/drawArrays, DPR-aware resize, dispose) at a
// scale that matches what Becoming actually needs: no organ swarm, no vitals, no command dispatch —
// just the welded pieces, baked once per setPieces call, breathing and glinting every frame.
class BecomingSimImpl implements BecomingSimHandle {
  private readonly gl: WebGL2RenderingContext;
  private readonly accumProgram: WebGLProgram;
  private readonly compositeProgram: WebGLProgram;
  private readonly fsQuadVao: WebGLVertexArrayObject;
  private readonly fsQuadBuf: WebGLBuffer;
  private readonly pieceVao: WebGLVertexArrayObject;
  private readonly pieceBuf: WebGLBuffer;
  private readonly accumRes: number;
  private readonly accumFbo: WebGLFramebuffer;
  private readonly accumTex: WebGLTexture;
  private readonly resizeObserver: ResizeObserver | null;
  private pieceCount = 0;
  private newest: NewestGlint | null = null;
  private raf = 0;
  private startedAt = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly opts: BecomingSimOpts) {
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("no-webgl2");
    this.gl = gl;

    this.accumProgram = link(gl, ACCUM_VERT, ACCUM_FRAG);
    this.compositeProgram = link(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);

    this.fsQuadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fsQuadVao);
    this.fsQuadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.pieceVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pieceVao);
    this.pieceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pieceBuf);
    const stride = PIECE_STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);

    this.accumRes = accumResolutionFor(opts.tier);
    const target = createTarget(gl, this.accumRes, this.accumRes);
    this.accumFbo = target.fbo;
    this.accumTex = target.tex;
    this.bake(); // texImage2D(..., null) leaves storage undefined — clear it before the first frame

    this.resize();
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);

    this.raf = requestAnimationFrame(this.frame);
  }

  setPieces(pieces: readonly BecomingPiece[], newestOfferingId: string | null) {
    if (this.disposed) return;
    const gl = this.gl;
    this.pieceCount = pieces.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pieceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, packPieceAttributes(pieces), gl.DYNAMIC_DRAW);
    const newestPiece = newestOfferingId === null
      ? undefined
      : pieces.find((piece) => piece.offeringId === newestOfferingId);
    // uv-space position (y flipped from body-space) plus the same closed-form radius the
    // accumulation pass derives from piece.scale — see the composite shader's u_newest comment.
    this.newest = newestPiece === undefined
      ? null
      : { x: newestPiece.x, y: 1 - newestPiece.y, radius: newestPiece.scale / 10, rotation: newestPiece.rotation };
    this.bake();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObserver?.disconnect();
    const gl = this.gl;
    gl.deleteProgram(this.accumProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteFramebuffer(this.accumFbo);
    gl.deleteTexture(this.accumTex);
    gl.deleteVertexArray(this.fsQuadVao); gl.deleteBuffer(this.fsQuadBuf);
    gl.deleteVertexArray(this.pieceVao); gl.deleteBuffer(this.pieceBuf);
  }

  private bake() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
    gl.viewport(0, 0, this.accumRes, this.accumRes);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.pieceCount > 0) {
      gl.useProgram(this.accumProgram);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // source-over ink stamp, not additive light
      this.u(this.accumProgram, "u_pointScale", (l) => gl.uniform1f(l, this.accumRes / 5));
      gl.bindVertexArray(this.pieceVao);
      gl.drawArrays(gl.POINTS, 0, this.pieceCount);
      gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private resize() {
    const { width, height } = computeCanvasBackingSize(
      this.canvas.clientWidth, this.canvas.clientHeight, devicePixelRatio, this.opts.tier,
    );
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    if (this.startedAt === 0) this.startedAt = now;
    const t = (now - this.startedAt) / 1000;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumTex);
    this.u(this.compositeProgram, "u_accum", (l) => gl.uniform1i(l, 0));
    this.u(this.compositeProgram, "u_ink", (l) => gl.uniform3f(l, ...this.opts.ink));
    const breath = 0.82 + 0.18 * Math.sin(t * 0.6); // gentle: the silhouette is alive, not pulsing
    this.u(this.compositeProgram, "u_breath", (l) => gl.uniform1f(l, breath));
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.u(this.compositeProgram, "u_aspect", (l) => gl.uniform1f(l, aspect));
    const newest = this.newest;
    if (newest !== null) {
      const glint = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3));
      this.u(this.compositeProgram, "u_newest", (l) => gl.uniform4f(l, newest.x, newest.y, newest.radius, newest.rotation));
      this.u(this.compositeProgram, "u_newestGlint", (l) => gl.uniform1f(l, glint));
    } else {
      this.u(this.compositeProgram, "u_newestGlint", (l) => gl.uniform1f(l, 0));
    }
    gl.bindVertexArray(this.fsQuadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.raf = requestAnimationFrame(this.frame);
  };

  private u(program: WebGLProgram, name: string, set: (location: WebGLUniformLocation) => void) {
    const location = this.gl.getUniformLocation(program, name);
    if (location !== null) set(location);
  }
}

// Never throws: returns null on missing WebGL2, shader/link failure, or any other init error, so a
// headless/node environment or an unsupported browser falls straight back to the SVG.
export function createBecomingSim(canvas: HTMLCanvasElement, opts: BecomingSimOpts): BecomingSimHandle | null {
  try {
    return new BecomingSimImpl(canvas, opts);
  } catch {
    return null;
  }
}
