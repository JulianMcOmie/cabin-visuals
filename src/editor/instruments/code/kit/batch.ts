import * as THREE from 'three'
import { FORCE_TRANSPARENT_KEY } from '../../../core/visual/animatedOpacity'

// Two immediate-mode GPU batches for code instruments. An instrument refills them
// every frame from pure functions of time (begin → seg/put … → end), which keeps
// choreography in plain TypeScript while the GPU does the drawing. One draw call
// each, thousands of primitives.
//
//   Strokes: tapered capsules between two 3D points, camera-facing, with a soft
//            glow falloff - lines, rings, blades, Lissajous curves, sequencers.
//   Sprites: camera-facing dots, star flares, rings, and flat graphic cuts
//            (disc, square, half/quarter disc, annulus, triangle).
//
// Colours are LINEAR (THREE.Color does the sRGB conversion when built from hex);
// `gain` > 1 pushes a primitive into HDR so the scene bloom catches it.
// Both materials carry `uOpacity` + FORCE_TRANSPARENT_KEY so the placement
// wrapper's fades and visibility movers reach them (instruments/CLAUDE.md).

export type BlendMode = 'add' | 'normal'

const STROKE_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aW;
attribute vec4 aC;
uniform float uGlow;
varying vec2 vP;
varying vec4 vC;
varying vec2 vW;
varying float vL;
void main(){
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  vec3 d = b.xyz - a.xyz;
  float L = length(d.xy);
  vec2 dir = L > 1e-6 ? d.xy / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = max(aW.x, aW.y) * (1.0 + uGlow);
  float along = position.x;
  vec3 c = mix(a.xyz, b.xyz, along);
  vec2 off = dir * (along < 0.5 ? -r : r) + nrm * position.y * r;
  gl_Position = projectionMatrix * vec4(c.xy + off, c.z, 1.0);
  vP = vec2(mix(-r, L + r, along), position.y * r);
  vC = aC;
  vW = aW;
  vL = L;
}
`

const STROKE_FRAG = /* glsl */ `
uniform float uGlow;
uniform float uSoft;
uniform float uOpacity;
varying vec2 vP;
varying vec4 vC;
varying vec2 vW;
varying float vL;
// signed distance to an uneven capsule from (0,0) radius r1 to (h,0) radius r2
// (Inigo Quilez's sdUnevenCapsule runs along y, so swap into its frame first)
float sdUneven(vec2 p, float r1, float r2, float h){
  if (h < 1e-5) return length(p) - max(r1, r2);
  vec2 q = vec2(abs(p.y), p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(max(1.0 - b * b, 0.0));
  float k = dot(q, vec2(-b, a));
  if (k < 0.0) return length(q) - r1;
  if (k > a * h) return length(q - vec2(0.0, h)) - r2;
  return dot(q, vec2(a, b)) - r1;
}
void main(){
  float d = sdUneven(vP, vW.x, vW.y, vL);
  float w = max(vW.x, vW.y);
  float aa = fwidth(d) * 0.75 + 1e-5;
  float core = 1.0 - smoothstep(-aa - uSoft * w, aa, d);
  float glow = uGlow > 0.0 ? exp(-max(d, 0.0) / (w * uGlow * 0.35 + 1e-5)) * 0.45 : 0.0;
  float a = clamp(core + glow * (1.0 - core), 0.0, 1.0) * vC.a * uOpacity;
  if (a < 0.002) discard;
  #ifdef ADDITIVE
    gl_FragColor = vec4(vC.rgb * a, 1.0);
  #else
    gl_FragColor = vec4(vC.rgb, a);
  #endif
}
`

function makeMaterial(vertexShader: string, fragmentShader: string, blend: BlendMode, depthTest: boolean, uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uOpacity: { value: 1 }, ...uniforms },
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: blend === 'add' ? { ADDITIVE: '' } : {},
  })
  mat.userData[FORCE_TRANSPARENT_KEY] = true
  return mat
}

function markDynamic(geo: THREE.InstancedBufferGeometry, name: string, arr: Float32Array, size: number) {
  geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage))
}

function flush(geo: THREE.InstancedBufferGeometry, names: string[], n: number) {
  geo.instanceCount = n
  for (const name of names) {
    const attr = geo.getAttribute(name) as THREE.InstancedBufferAttribute
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize)
    attr.needsUpdate = true
  }
}

export interface StrokeOpts {
  blend?: BlendMode
  /** Extra glow radius as a multiple of the width (0 = crisp). */
  glow?: number
  /** Edge softness as a fraction of the width. */
  soft?: number
  depthTest?: boolean
}

export class Strokes extends THREE.Mesh {
  private readonly cap: number
  private readonly aA: Float32Array
  private readonly aB: Float32Array
  private readonly aW: Float32Array
  private readonly aC: Float32Array
  private readonly geo: THREE.InstancedBufferGeometry
  private n = 0
  readonly mat: THREE.ShaderMaterial

  constructor(capacity = 4096, opts: StrokeOpts = {}) {
    const geo = new THREE.InstancedBufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    const mat = makeMaterial(STROKE_VERT, STROKE_FRAG, opts.blend ?? 'add', opts.depthTest ?? false, {
      uGlow: { value: opts.glow ?? 1.2 },
      uSoft: { value: opts.soft ?? 0.15 },
    })
    super(geo, mat)
    this.mat = mat
    this.geo = geo
    this.cap = capacity
    this.aA = new Float32Array(capacity * 3)
    this.aB = new Float32Array(capacity * 3)
    this.aW = new Float32Array(capacity * 2)
    this.aC = new Float32Array(capacity * 4)
    markDynamic(geo, 'aA', this.aA, 3)
    markDynamic(geo, 'aB', this.aB, 3)
    markDynamic(geo, 'aW', this.aW, 2)
    markDynamic(geo, 'aC', this.aC, 4)
    this.frustumCulled = false
  }

  begin() { this.n = 0 }

  /** Segment A→B, radius r1→r2 (world units), linear colour, alpha, HDR gain. */
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r1: number, r2: number, c: THREE.Color, alpha = 1, gain = 1) {
    if (this.n >= this.cap || alpha <= 0.001) return
    const i = this.n++
    this.aA[i * 3] = ax; this.aA[i * 3 + 1] = ay; this.aA[i * 3 + 2] = az
    this.aB[i * 3] = bx; this.aB[i * 3 + 1] = by; this.aB[i * 3 + 2] = bz
    this.aW[i * 2] = r1; this.aW[i * 2 + 1] = r2
    this.aC[i * 4] = c.r * gain; this.aC[i * 4 + 1] = c.g * gain; this.aC[i * 4 + 2] = c.b * gain; this.aC[i * 4 + 3] = alpha
  }

  /** A polyline through xyz triples; alpha(u) with u = 0..1 along it. */
  poly(pts: ArrayLike<number>, count: number, r: number, c: THREE.Color, alpha: (u: number) => number = () => 1, gain = 1, closed = false) {
    const last = closed ? count : count - 1
    for (let k = 0; k < last; k++) {
      const j = (k + 1) % count
      const a = alpha(k / Math.max(1, last - 1))
      if (a <= 0.001) continue
      this.seg(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2], pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2], r, r, c, a, gain)
    }
  }

  /** A circle (or arc) in the plane spanned by u and v (default XY). */
  ring(cx: number, cy: number, cz: number, radius: number, width: number, c: THREE.Color, alpha = 1, gain = 1,
    opts: { seg?: number; from?: number; to?: number; squash?: number; dash?: number } = {}) {
    const seg = opts.seg ?? 96
    const from = opts.from ?? 0, to = opts.to ?? Math.PI * 2
    const sq = opts.squash ?? 1
    for (let i = 0; i < seg; i++) {
      if (opts.dash && i % opts.dash === opts.dash - 1) continue
      const a0 = from + ((to - from) * i) / seg, a1 = from + ((to - from) * (i + 1)) / seg
      this.seg(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius * sq, cz,
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius * sq, cz, width, width, c, alpha, gain)
    }
  }

  /** A regular polygon; `progress` < 1 draws it partially (for draw-on). */
  polygon(cx: number, cy: number, cz: number, radius: number, sides: number, rot: number, width: number,
    c: THREE.Color, alpha = 1, gain = 1, progress = 1) {
    const total = sides * progress
    for (let i = 0; i < Math.ceil(total); i++) {
      const f = Math.min(1, total - i)
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2
      const x0 = cx + Math.cos(a0) * radius, y0 = cy + Math.sin(a0) * radius
      const x1 = cx + Math.cos(a1) * radius, y1 = cy + Math.sin(a1) * radius
      this.seg(x0, y0, cz, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, cz, width, width, c, alpha, gain)
    }
  }

  /** Offset every endpoint sideways by a function of its depth - bends a straight layout along a path. */
  bendXY(bx: (z: number) => number, by: (z: number) => number) {
    for (const a of [this.aA, this.aB]) {
      for (let i = 0; i < this.n; i++) {
        const z = a[i * 3 + 2]
        a[i * 3] += bx(z)
        a[i * 3 + 1] += by(z)
      }
    }
  }

  end() {
    flush(this.geo, ['aA', 'aB', 'aW', 'aC'], this.n)
    this.visible = this.n > 0
  }

  get used() { return this.n }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

const SPRITE_VERT = /* glsl */ `
attribute vec3 aP;
attribute vec2 aS;
attribute vec4 aC;
attribute float aR;
varying vec2 vUv;
varying vec4 vC;
varying float vK;
void main(){
  vec4 mv = modelViewMatrix * vec4(aP, 1.0);
  float c = cos(aR), s = sin(aR);
  vec2 q = mat2(c, s, -s, c) * position.xy;
  mv.xy += q * aS.x;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vC = aC;
  vK = aS.y;
}
`

const SPRITE_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec4 vC;
varying float vK;
void main(){
  float r = length(vUv);
  float a;
  if (vK < 0.5) {                 // soft dot with a hot core
    a = smoothstep(1.0, 0.0, r);
    a = a * a * 0.6 + smoothstep(0.35, 0.2, r) * 0.9;
  } else if (vK < 1.5) {          // four-point star flare
    float cross = exp(-abs(vUv.x) * 26.0) * exp(-abs(vUv.y) * 2.2) + exp(-abs(vUv.y) * 26.0) * exp(-abs(vUv.x) * 2.2);
    float diag = (exp(-abs(vUv.x - vUv.y) * 30.0) + exp(-abs(vUv.x + vUv.y) * 30.0)) * exp(-r * 4.0) * 0.35;
    a = cross + diag + exp(-r * r * 40.0) * 1.5 + exp(-r * 6.0) * 0.25;
    a *= smoothstep(1.0, 0.7, r);
  } else if (vK < 2.5) {          // thin ring
    float d = abs(r - 0.82);
    a = smoothstep(0.08, 0.0, d) + exp(-d * 18.0) * 0.3;
    a *= smoothstep(1.0, 0.95, r);
  } else if (vK < 3.5) {          // hard disc
    float aa = fwidth(r) * 1.2;
    a = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  } else if (vK < 4.5) {          // hard square
    vec2 q = abs(vUv);
    float d = max(q.x, q.y);
    float aa = fwidth(d) * 1.2;
    a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  } else {                        // flat cuts: half, quarter, annulus, triangle
    float aa = fwidth(r) * 1.2;
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
    float ay = fwidth(vUv.y) * 1.2, ax = fwidth(vUv.x) * 1.2;
    if (vK < 5.5) a = disc * smoothstep(-ay, ay, vUv.y);
    else if (vK < 6.5) a = disc * smoothstep(-ay, ay, vUv.y) * smoothstep(-ax, ax, vUv.x);
    else if (vK < 7.5) a = disc * smoothstep(0.86 - aa, 0.86 + aa, r);
    else {
      vec2 q = vUv; q.x = abs(q.x);
      float d = max(q.x * 0.866 + q.y * 0.5, -q.y) - 0.5;
      float at = fwidth(d) * 1.2;
      a = 1.0 - smoothstep(-at, at, d);
    }
  }
  a *= vC.a * uOpacity;
  if (a < 0.002) discard;
  #ifdef ADDITIVE
    gl_FragColor = vec4(vC.rgb * a, 1.0);
  #else
    gl_FragColor = vec4(vC.rgb, a);
  #endif
}
`

export const SPRITE = { dot: 0, flare: 1, ring: 2, disc: 3, square: 4, half: 5, quarter: 6, annulus: 7, tri: 8 } as const
export type SpriteKind = (typeof SPRITE)[keyof typeof SPRITE]

export class Sprites extends THREE.Mesh {
  private readonly cap: number
  private readonly aP: Float32Array
  private readonly aS: Float32Array
  private readonly aC: Float32Array
  private readonly aR: Float32Array
  private readonly geo: THREE.InstancedBufferGeometry
  private n = 0
  readonly mat: THREE.ShaderMaterial

  constructor(capacity = 4096, opts: { blend?: BlendMode; depthTest?: boolean } = {}) {
    const geo = new THREE.InstancedBufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    const mat = makeMaterial(SPRITE_VERT, SPRITE_FRAG, opts.blend ?? 'add', opts.depthTest ?? false, {})
    super(geo, mat)
    this.mat = mat
    this.geo = geo
    this.cap = capacity
    this.aP = new Float32Array(capacity * 3)
    this.aS = new Float32Array(capacity * 2)
    this.aC = new Float32Array(capacity * 4)
    this.aR = new Float32Array(capacity)
    markDynamic(geo, 'aP', this.aP, 3)
    markDynamic(geo, 'aS', this.aS, 2)
    markDynamic(geo, 'aC', this.aC, 4)
    markDynamic(geo, 'aR', this.aR, 1)
    this.frustumCulled = false
  }

  begin() { this.n = 0 }

  /** A sprite at (x,y,z): half-size in world units, SPRITE kind, colour, alpha, gain, rotation. */
  put(x: number, y: number, z: number, size: number, kind: SpriteKind, c: THREE.Color, alpha = 1, gain = 1, rot = 0) {
    if (this.n >= this.cap || alpha <= 0.001 || size <= 0) return
    const i = this.n++
    this.aP[i * 3] = x; this.aP[i * 3 + 1] = y; this.aP[i * 3 + 2] = z
    this.aS[i * 2] = size; this.aS[i * 2 + 1] = kind
    this.aC[i * 4] = c.r * gain; this.aC[i * 4 + 1] = c.g * gain; this.aC[i * 4 + 2] = c.b * gain; this.aC[i * 4 + 3] = alpha
    this.aR[i] = rot
  }

  bendXY(bx: (z: number) => number, by: (z: number) => number) {
    for (let i = 0; i < this.n; i++) {
      const z = this.aP[i * 3 + 2]
      this.aP[i * 3] += bx(z)
      this.aP[i * 3 + 1] += by(z)
    }
  }

  end() {
    flush(this.geo, ['aP', 'aS', 'aC', 'aR'], this.n)
    this.visible = this.n > 0
  }

  get used() { return this.n }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}
