import type { Tier } from "./stainSim";
import {
  SWARM_ORGANS,
  SwarmActivity,
  swarmTextureSize,
} from "./swarmSignals";
import type { VitalsFeed } from "../experience/types";
import type { BodySignal } from "./bodyRenderer";

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const QUAD_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;

const VELOCITY_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_pos;
uniform sampler2D u_vel;
uniform ivec2 u_size;
uniform vec2 u_goals[5];
uniform float u_activity[5];
uniform float u_time;
uniform float u_dt;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
}
vec2 curl(vec2 p){
  float e=.035;
  float dx=noise(p+vec2(e,0))-noise(p-vec2(e,0));
  float dy=noise(p+vec2(0,e))-noise(p-vec2(0,e));
  return normalize(vec2(dy,-dx)+vec2(1e-5));
}
ivec2 wrapped(ivec2 p){ return ivec2((p.x%u_size.x+u_size.x)%u_size.x,(p.y%u_size.y+u_size.y)%u_size.y); }
void gather(ivec2 here, ivec2 offset, int organ, vec2 pos, inout vec2 separation,
  inout vec2 center, inout vec2 heading, inout float count){
  ivec2 q=wrapped(here+offset);
  vec4 np=texelFetch(u_pos,q,0);
  if(int(np.z+.5)!=organ) return;
  vec2 delta=pos-np.xy;
  float d=length(delta);
  if(d>.0001 && d<.065) separation+=delta/(d*d+0.0008);
  center+=np.xy;
  heading+=texelFetch(u_vel,q,0).xy;
  count+=1.0;
}
void main(){
  ivec2 here=ivec2(gl_FragCoord.xy);
  vec4 state=texelFetch(u_pos,here,0);
  vec2 pos=state.xy;
  int organ=int(state.z+.5);
  vec2 vel=texelFetch(u_vel,here,0).xy;
  vec2 separation=vec2(0), center=vec2(0), heading=vec2(0); float count=0.0;
  gather(here,ivec2(1,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(-1,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(2,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(-2,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(5,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(-5,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(11,0),organ,pos,separation,center,heading,count);
  gather(here,ivec2(-11,0),organ,pos,separation,center,heading,count);
  if(count>0.0){ center/=count; heading/=count; }
  vec2 sep=length(separation)>0.0?normalize(separation):vec2(0);
  vec2 coh=count>0.0?center-pos:vec2(0);
  vec2 align=count>0.0?heading-vel:vec2(0);
  float activity=u_activity[organ];
  // Separation is deliberately dominant: the five organs cohere without collapsing into dots.
  vec2 flock=(sep*1.75+coh*.9+align*1.0)*.022;
  vec2 goal=(u_goals[organ]-pos)*(.19+activity*.08);
  vec2 flow=curl(pos*5.2+vec2(u_time*.035,float(organ)*2.17))*(.016+activity*.052);
  vec2 fromEdge=pos-.5;
  float edge=length(fromEdge*vec2(1.0,1.12));
  vec2 boundary=edge>.43?-normalize(fromEdge)*(edge-.43)*1.2:vec2(0);
  vel*=pow(.986,u_dt*60.0);
  vel+=(flock+goal+flow+boundary)*u_dt;
  float maxSpeed=.028+activity*.038;
  float speed=length(vel);
  if(speed>maxSpeed) vel=vel/speed*maxSpeed;
  fragColor=vec4(vel,0,1);
}`;

const POSITION_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_pos;
uniform sampler2D u_vel;
uniform float u_dt;
void main(){
  ivec2 at=ivec2(gl_FragCoord.xy);
  vec4 state=texelFetch(u_pos,at,0);
  vec2 next=state.xy+texelFetch(u_vel,at,0).xy*u_dt;
  // The goal and edge force keep this clamp dormant in normal motion; it is only a numerical guardrail.
  next=clamp(next,vec2(.035),vec2(.965));
  fragColor=vec4(next,state.zw);
}`;

const TRAIL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_prev;
uniform vec2 u_centroids[5];
uniform float u_activity[5];
uniform vec2 u_pipeline;
uniform float u_tongueRubric;
uniform float u_threshold;
uniform float u_dt;

float segmentDistance(vec2 p,vec2 a,vec2 b){
  vec2 ab=b-a;
  float h=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-5),0.0,1.0);
  return length(p-(a+ab*h));
}
float capillary(int a,int b,float forced){
  float span=length(u_centroids[a]-u_centroids[b]);
  float near=clamp(1.0-span/u_threshold,0.0,1.0);
  float shared=sqrt((.06+u_activity[a])*(.06+u_activity[b]));
  float strength=max(near*shared,forced);
  float width=.00075+shared*.0021+forced*.0014;
  float fiber=.82+.18*sin((v_uv.x+v_uv.y)*1700.0+float(a*19+b*7));
  return (1.0-smoothstep(width,width*3.1,segmentDistance(v_uv,u_centroids[a],u_centroids[b])))*strength*fiber;
}
void main(){
  vec4 c=texture(u_prev,v_uv)*pow(.92,u_dt*60.0);
  float ordinary=0.0;
  ordinary=max(ordinary,capillary(0,1,u_pipeline.x));
  ordinary=max(ordinary,capillary(0,2,0.0));
  ordinary=max(ordinary,capillary(0,3,0.0));
  ordinary=max(ordinary,capillary(0,4,0.0));
  ordinary=max(ordinary,capillary(1,2,u_pipeline.y));
  ordinary=max(ordinary,capillary(1,3,0.0));
  ordinary=max(ordinary,capillary(1,4,0.0));
  ordinary=max(ordinary,capillary(2,3,0.0));
  ordinary=max(ordinary,capillary(2,4,0.0));
  ordinary=max(ordinary,capillary(3,4,0.0));
  c.r=max(c.r,ordinary*.34);
  // Only a real TONGUE utterance may misregister rubric into its outbound capillary.
  c.g=max(c.g,capillary(1,2,u_pipeline.y)*u_tongueRubric*.28);
  c.b=max(c.b,ordinary*.18);
  fragColor=clamp(c,0.0,1.0);
}`;

const PARTICLE_VERT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_pos;
uniform int u_size;
uniform float u_pointScale;
uniform float u_activity[5];
uniform float u_pulseBeat;
uniform float u_pulsePressure;
uniform float u_tongueRubric;
flat out int v_organ;
out float v_seed;
out float v_activity;
out float v_red;
void main(){
  int id=gl_VertexID;
  ivec2 at=ivec2(id%u_size,id/u_size);
  vec4 state=texelFetch(u_pos,at,0);
  v_organ=int(state.z+.5);
  v_seed=state.w;
  v_activity=u_activity[v_organ];
  float pulse=v_organ==3?u_pulsePressure*(.38+.62*u_pulseBeat):0.0;
  float tongue=v_organ==2?u_tongueRubric:0.0;
  v_red=max(pulse,tongue);
  gl_Position=vec4(state.xy*2.0-1.0,0,1);
  gl_PointSize=u_pointScale*(1.2+v_activity*1.7+(v_organ==3?u_pulseBeat*.65:0.0));
}`;

const PARTICLE_FRAG = `#version 300 es
precision highp float;
flat in int v_organ;
in float v_seed;
in float v_activity;
in float v_red;
out vec4 fragColor;
float hash(float n){ return fract(sin(n*91.17)*43758.5453); }
void main(){
  vec2 p=gl_PointCoord-.5;
  float r=length(p)*2.0;
  float rag=.72+hash(v_seed+floor(atan(p.y,p.x)*9.0))*0.22;
  float stamp=1.0-smoothstep(rag,1.0,r);
  if(stamp<=0.0) discard;
  float wet=.065+v_activity*.19+(v_organ==3?v_red*.12:0.0);
  float alpha=stamp*wet;
  // Premultiplied source-over density. This darkens paper; it never emits or adds light.
  fragColor=vec4(alpha,v_red*alpha,alpha*(.35+v_activity*.4),alpha);
}`;

const BASE_GOALS = [
  [0.50, 0.72], // EYE watches from above
  [0.70, 0.57], // KEEP receives
  [0.64, 0.34], // TONGUE speaks below
  [0.36, 0.34], // PULSE anchors the blood-side
  [0.30, 0.57], // DREAM closes the ring
] as const;

// The page begins as one loose field. These broad, overlapping centers are presentation only;
// emergence resolves them into the five canonical positions without implying activity.
const LOOSE_GOALS = [
  [0.47, 0.58],
  [0.58, 0.54],
  [0.56, 0.45],
  [0.43, 0.44],
  [0.39, 0.53],
] as const;

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class OrganSwarm {
  private readonly activity = new SwarmActivity();
  private readonly size: number;
  private readonly count: number;
  private readonly velocityProgram: WebGLProgram;
  private readonly positionProgram: WebGLProgram;
  private readonly trailProgram: WebGLProgram;
  private readonly particleProgram: WebGLProgram;
  private readonly particleVao: WebGLVertexArrayObject;
  private posA: Target;
  private posB: Target;
  private velA: Target;
  private velB: Target;
  private trailA: Target;
  private trailB: Target;
  private readonly goals = new Float32Array(10);
  // A Waker's mark pulls one organ toward it and fades: the being reaches for what you drew, then relaxes.
  private readonly markPos = new Float32Array(2);
  private markOrgan = -1;
  private markStrength = 0;
  private readonly centroids = new Float32Array(10);
  private readonly centroidVelocity = new Float32Array(10);
  private pulseThreadFactor = 0;
  private emergence: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly tier: Exclude<Tier, "reduced">,
    private readonly quadVao: WebGLVertexArrayObject,
    trailWidth: number,
    trailHeight: number,
    initialEmergence = 0,
  ) {
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float-color-buffer-unavailable");
    this.size = swarmTextureSize(tier);
    this.count = this.size * this.size;
    this.emergence = Math.max(0, Math.min(1, initialEmergence));
    const { positions, velocities } = this.initialState();
    this.posA = this.target(this.size, this.size, gl.RGBA32F, gl.FLOAT, positions, gl.NEAREST);
    this.posB = this.target(this.size, this.size, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST);
    this.velA = this.target(this.size, this.size, gl.RGBA32F, gl.FLOAT, velocities, gl.NEAREST);
    this.velB = this.target(this.size, this.size, gl.RGBA32F, gl.FLOAT, null, gl.NEAREST);
    // Trails are normalized ink-density, not simulation state. RGBA8 keeps source-over blending
    // available on WebGL2 implementations that expose float render targets but not float blending.
    this.trailA = this.target(trailWidth, trailHeight, gl.RGBA8, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    this.trailB = this.target(trailWidth, trailHeight, gl.RGBA8, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    this.velocityProgram = this.link(QUAD_VERT, VELOCITY_FRAG);
    this.positionProgram = this.link(QUAD_VERT, POSITION_FRAG);
    this.trailProgram = this.link(QUAD_VERT, TRAIL_FRAG);
    this.particleProgram = this.link(PARTICLE_VERT, PARTICLE_FRAG);
    this.particleVao = gl.createVertexArray()!;
    this.seedCentroids();
    this.clear(this.posB); this.clear(this.velB); this.clear(this.trailA); this.clear(this.trailB);
  }

  dispatch(signal: BodySignal) { this.activity.dispatch(signal); }
  setVitals(feed: VitalsFeed) { this.activity.setVitals(feed); }
  setEmergence(value: number) { this.emergence = Math.max(0, Math.min(1, value)); }
  // Mark at (x,y) in 0..1 swarm space (y up): the nearest organ turns toward it and quickens, so the being
  // visibly reaches for the Waker's mark. updateGoals() blends its goal toward markPos while markStrength lasts.
  markAt(x: number, y: number) {
    let nearest = 0, best = Infinity;
    for (let o = 0; o < 5; o += 1) {
      const dx = BASE_GOALS[o][0] - x, dy = BASE_GOALS[o][1] - y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; nearest = o; }
    }
    this.markOrgan = nearest;
    this.markPos[0] = x; this.markPos[1] = y;
    this.markStrength = 1;
    this.activity.dispatch({
      organ: SWARM_ORGANS[nearest],
      intensity: 1,
      pipeline: "none",
    });
  }
  get texture() { return this.trailA.tex; }
  get currentPulseThreadFactor() { return this.pulseThreadFactor; }

  copyAnchors(target: Float32Array): void {
    for (let organ = 0; organ < SWARM_ORGANS.length; organ += 1) {
      target[organ * 2] = this.centroids[organ * 2];
      target[organ * 2 + 1] = 1 - this.centroids[organ * 2 + 1];
    }
  }

  step(elapsed: number, dt: number) {
    const g = this.gl;
    this.activity.advance(dt);
    this.markStrength *= Math.exp(-dt * 1.2);   // the reach toward a Waker's mark relaxes back over ~1s
    const signal = this.activity.snapshot(elapsed);
    this.pulseThreadFactor = signal.pulsePressure;
    this.updateGoals(elapsed, signal.activity);
    this.updateCentroids(dt, signal.activity);
    g.disable(g.BLEND);

    g.useProgram(this.velocityProgram);
    g.bindFramebuffer(g.FRAMEBUFFER, this.velB.fbo);
    g.viewport(0, 0, this.size, this.size);
    this.textureUniform(this.velocityProgram, "u_pos", this.posA.tex, 0);
    this.textureUniform(this.velocityProgram, "u_vel", this.velA.tex, 1);
    this.u(this.velocityProgram, "u_size", l => g.uniform2i(l, this.size, this.size));
    // The persistent centroid is the sub-swarm's immediate target; a slower goal vector moves it.
    this.u(this.velocityProgram, "u_goals[0]", l => g.uniform2fv(l, this.centroids));
    this.u(this.velocityProgram, "u_activity[0]", l => g.uniform1fv(l, signal.activity));
    this.u(this.velocityProgram, "u_time", l => g.uniform1f(l, elapsed));
    this.u(this.velocityProgram, "u_dt", l => g.uniform1f(l, dt));
    g.bindVertexArray(this.quadVao);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    g.useProgram(this.positionProgram);
    g.bindFramebuffer(g.FRAMEBUFFER, this.posB.fbo);
    this.textureUniform(this.positionProgram, "u_pos", this.posA.tex, 0);
    this.textureUniform(this.positionProgram, "u_vel", this.velB.tex, 1);
    this.u(this.positionProgram, "u_dt", l => g.uniform1f(l, dt));
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    g.useProgram(this.trailProgram);
    g.bindFramebuffer(g.FRAMEBUFFER, this.trailB.fbo);
    g.viewport(0, 0, this.trailB.w, this.trailB.h);
    this.textureUniform(this.trailProgram, "u_prev", this.trailA.tex, 0);
    this.u(this.trailProgram, "u_centroids[0]", l => g.uniform2fv(l, this.centroids));
    this.u(this.trailProgram, "u_activity[0]", l => g.uniform1fv(l, signal.activity));
    this.u(this.trailProgram, "u_pipeline", l => g.uniform2fv(l, signal.pipelineLinks));
    this.u(this.trailProgram, "u_tongueRubric", l => g.uniform1f(l, signal.tongueRubric));
    this.u(this.trailProgram, "u_threshold", l => g.uniform1f(l, this.tier === "mobile" ? .34 : .40));
    this.u(this.trailProgram, "u_dt", l => g.uniform1f(l, dt));
    g.bindVertexArray(this.quadVao);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

    // Source-over accumulation is a wet ink stamp, not additive light.
    g.enable(g.BLEND);
    g.blendEquation(g.FUNC_ADD);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.useProgram(this.particleProgram);
    this.textureUniform(this.particleProgram, "u_pos", this.posB.tex, 0);
    this.u(this.particleProgram, "u_size", l => g.uniform1i(l, this.size));
    this.u(this.particleProgram, "u_pointScale", l => g.uniform1f(l, this.tier === "mobile" ? 1.15 : 1.35));
    this.u(this.particleProgram, "u_activity[0]", l => g.uniform1fv(l, signal.activity));
    this.u(this.particleProgram, "u_pulseBeat", l => g.uniform1f(l, signal.pulseBeat));
    this.u(this.particleProgram, "u_pulsePressure", l => g.uniform1f(l, signal.pulsePressure));
    this.u(this.particleProgram, "u_tongueRubric", l => g.uniform1f(l, signal.tongueRubric));
    g.bindVertexArray(this.particleVao);
    g.drawArrays(g.POINTS, 0, this.count);
    g.disable(g.BLEND);

    [this.posA, this.posB] = [this.posB, this.posA];
    [this.velA, this.velB] = [this.velB, this.velA];
    [this.trailA, this.trailB] = [this.trailB, this.trailA];
  }

  dispose() {
    const g = this.gl;
    for (const program of [this.velocityProgram, this.positionProgram, this.trailProgram, this.particleProgram]) g.deleteProgram(program);
    for (const target of [this.posA, this.posB, this.velA, this.velB, this.trailA, this.trailB]) {
      g.deleteFramebuffer(target.fbo); g.deleteTexture(target.tex);
    }
    g.deleteVertexArray(this.particleVao);
  }

  private initialState() {
    const positions = new Float32Array(this.count * 4);
    const velocities = new Float32Array(this.count * 4);
    const random = seeded(0x504c4552);
    const tightness = this.tier === "mobile" ? .82 : 1;
    for (let i = 0; i < this.count; i += 1) {
      const organ = Math.min(4, Math.floor((i * 5) / this.count));
      const base = [
        mix(LOOSE_GOALS[organ][0], BASE_GOALS[organ][0], this.emergence),
        mix(LOOSE_GOALS[organ][1], BASE_GOALS[organ][1], this.emergence),
      ];
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * mix(.115, .065, this.emergence) * tightness;
      const at = i * 4;
      positions[at] = .5 + (base[0] - .5) * tightness + Math.cos(angle) * radius;
      positions[at + 1] = .5 + (base[1] - .5) * tightness + Math.sin(angle) * radius;
      positions[at + 2] = organ;
      positions[at + 3] = random();
      velocities[at] = -Math.sin(angle) * .0015;
      velocities[at + 1] = Math.cos(angle) * .0015;
      velocities[at + 3] = 1;
    }
    return { positions, velocities };
  }

  private updateGoals(time: number, activity: number[]) {
    const tightness = this.tier === "mobile" ? .82 : 1;
    for (let organ = 0; organ < 5; organ += 1) {
      const base = [
        mix(LOOSE_GOALS[organ][0], BASE_GOALS[organ][0], this.emergence),
        mix(LOOSE_GOALS[organ][1], BASE_GOALS[organ][1], this.emergence),
      ];
      const phase = organ * 1.73;
      const drift = .010 + activity[organ] * .013;
      this.goals[organ * 2] = .5 + (base[0] - .5) * tightness + Math.sin(time * .19 + phase) * drift;
      this.goals[organ * 2 + 1] = .5 + (base[1] - .5) * tightness + Math.cos(time * .16 + phase) * drift;
      // The marked organ leans toward the Waker's mark, easing back as markStrength decays.
      if (organ === this.markOrgan && this.markStrength > 0.01) {
        const k = this.markStrength * 0.8;
        this.goals[organ * 2] += (this.markPos[0] - this.goals[organ * 2]) * k;
        this.goals[organ * 2 + 1] += (this.markPos[1] - this.goals[organ * 2 + 1]) * k;
      }
    }
  }

  private seedCentroids() {
    const tightness = this.tier === "mobile" ? .82 : 1;
    for (let organ = 0; organ < 5; organ += 1) {
      const x = mix(LOOSE_GOALS[organ][0], BASE_GOALS[organ][0], this.emergence);
      const y = mix(LOOSE_GOALS[organ][1], BASE_GOALS[organ][1], this.emergence);
      this.centroids[organ * 2] = .5 + (x - .5) * tightness;
      this.centroids[organ * 2 + 1] = .5 + (y - .5) * tightness;
    }
  }

  private updateCentroids(dt: number, activity: number[]) {
    for (let organ = 0; organ < 5; organ += 1) {
      const at = organ * 2;
      let vx = this.centroidVelocity[at];
      let vy = this.centroidVelocity[at + 1];
      const damping = Math.exp(-dt * (1.9 - activity[organ] * .35));
      vx = vx * damping + (this.goals[at] - this.centroids[at]) * dt * (.9 + activity[organ] * .5);
      vy = vy * damping + (this.goals[at + 1] - this.centroids[at + 1]) * dt * (.9 + activity[organ] * .5);
      const speed = Math.hypot(vx, vy);
      const maxSpeed = .018 + activity[organ] * .012;
      if (speed > maxSpeed) { vx = vx / speed * maxSpeed; vy = vy / speed * maxSpeed; }
      this.centroidVelocity[at] = vx;
      this.centroidVelocity[at + 1] = vy;
      this.centroids[at] += vx * dt;
      this.centroids[at + 1] += vy * dt;
    }
  }

  private target(w: number, h: number, internal: number, type: number, data: ArrayBufferView | null, filter: number): Target {
    const g = this.gl;
    const tex = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, tex);
    g.texImage2D(g.TEXTURE_2D, 0, internal, w, h, 0, g.RGBA, type, data);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    const fbo = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) throw new Error("swarm-framebuffer-incomplete");
    return { fbo, tex, w, h };
  }

  private clear(target: Target) {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
    g.viewport(0, 0, target.w, target.h);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
  }

  private link(vertexSource: string, fragmentSource: string): WebGLProgram {
    const g = this.gl;
    const program = g.createProgram()!;
    const shaders: WebGLShader[] = [];
    for (const [kind, source] of [[g.VERTEX_SHADER, vertexSource], [g.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = g.createShader(kind)!;
      g.shaderSource(shader, source); g.compileShader(shader);
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(shader) ?? "swarm-shader");
      g.attachShader(program, shader); shaders.push(shader);
    }
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? "swarm-link");
    for (const shader of shaders) g.deleteShader(shader);
    return program;
  }

  private textureUniform(program: WebGLProgram, name: string, texture: WebGLTexture, unit: number) {
    const g = this.gl;
    g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D, texture);
    this.u(program, name, location => g.uniform1i(location, unit));
  }

  private u(program: WebGLProgram, name: string, set: (location: WebGLUniformLocation) => void) {
    const location = this.gl.getUniformLocation(program, name);
    if (location !== null) set(location);
  }
}
