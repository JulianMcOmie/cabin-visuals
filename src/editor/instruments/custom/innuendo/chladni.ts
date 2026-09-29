import * as THREE from 'three'
import { defineInstrument, p, particles, type Particles } from '../../code'

// Chladni sand: grains on a vibrating plate settle onto its nodal lines (where
// the plate is still). Each grain's resting place is found per frame on the GPU
// by Newton steps on the mode function, so the figure is exact and free.
//
//   48-59  Mode (C … B): the figure for a chord root. The newest onset sets the
//          figure; grains fly up and land into it over `settle` beats.
//   66     Climb: each onset since the last mode note climbs one harmonic.
//   60     Blast: every grain is thrown off the plate and falls into the figure (drops).
//   62     Hop: grains jump (kicks).
//   64     Shiver: grains dance off their lines while held (sustained bass).
//
// Square plate:  f = cos(nπx)cos(mπy) + s·cos(mπx)cos(nπy)
// Round plate:   f = cos(nθ)·sin(mπr) + s·0.35·sin(2mπr)

const ROW = { mode0: 48, blast: 60, hop: 62, shiver: 64, climb: 66 }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type Mode = [number, number, number]
const SQUARE: Mode[] = [[1, 5, 1], [3, 7, -1], [2, 5, -1], [4, 7, 1], [1, 4, -1], [3, 5, 1], [3, 4, -1], [2, 7, 1], [5, 6, -1], [3, 4, 1], [1, 6, -1], [2, 3, 1]]
const ROUND: Mode[] = [[3, 2, 1], [5, 3, -1], [4, 2, -1], [6, 3, 1], [3, 3, -1], [5, 2, 1], [6, 2, -1], [4, 3, 1], [8, 3, -1], [5, 3, 1], [7, 2, -1], [6, 4, 1]]

const VERTEX = /* glsl */ `
  vec2 p0 = aSeed.xy * 2.0 - 1.0;
  if (uRound > 0.5) { float r = sqrt(aSeed.x), a = aSeed.y * 6.2831853; p0 = vec2(cos(a), sin(a)) * r; }
  vec2 jitA = (hash31(aSeed.z * 91.0 + uA.x * 7.0 + uA.y * 13.0).xy - 0.5) * 0.06;
  vec2 jitB = (hash31(aSeed.z * 91.0 + uB.x * 7.0 + uB.y * 13.0).xy - 0.5) * 0.06;
  vec2 a = settle(p0 + jitA, uA);
  vec2 b = settle(p0 + jitB, uB);
  float delay = aSeed.w * 0.25 * uSettle;
  float k = clamp((uAgeB - delay) / uSettle, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  vec2 q = mix(a, b, e);
  float flight = sin(3.14159265 * k) * (1.0 - step(1.0, k));
  vec3 n = snoise3(vec3(p0 * 4.0, uSec * 1.7 + aSeed.z * 10.0));
  q += n.xy * (flight * 0.05 + uShake * 0.006);
  float h = flight * 0.18 * (0.3 + aSeed.w);
  float ha = uHopAge - aSeed.z * 0.02;
  float hop = ha > 0.0 ? max(0.0, ha * (0.45 - ha)) * 2.2 * uHop * (0.3 + aSeed.y) : 0.0;
  // A blast bursts OUTWARD across the plate (mostly radial, some turbulence) and
  // lifts the grains. Upright, "up" is toward the camera: lifting there brings
  // every grain up to the lens and the frame drowns in static - keep it shallow.
  float boom = uBoom * (0.35 + aSeed.w * 1.3);
  vec2 radial = q / max(length(q), 0.05);
  q += (radial * 0.65 + n.xy * 0.45) * boom * 0.32;
  h += boom * (0.6 + abs(n.z)) * 0.9 * (uUpright > 0.5 ? 0.22 : 1.0) + hop + abs(n.z) * uShake * 0.02;
  pos = (uUpright > 0.5 ? vec3(q.x, q.y, h) : vec3(q.x, h, q.y)) * uScale;
  float motion = clamp(flight * 1.5 + hop * 4.0 + uShake * 0.12 + uBoom * 1.5, 0.0, 1.0);
  float onLine = exp(-abs(plate(q, uB)) * 12.0);
  size = uGrain * (0.6 + aSeed.y * 0.8);
  vec3 c = mix(uCold, uHot, motion) + uLine * onLine * (1.0 - motion) * 0.4;
  c = mix(c, uLine * 1.25, clamp(uBoom * 0.45, 0.0, 0.55));   // a blast flashes white-gold, not red
  color = vec4(c, uAlpha * (0.45 + 0.55 * aSeed.w));
`

const HEADER = /* glsl */ `
  uniform vec3 uA, uB, uCold, uHot, uLine;
  uniform float uAgeB, uSettle, uShake, uHop, uHopAge, uBoom, uScale, uRound, uUpright, uGrain, uAlpha;
  float plate(vec2 p, vec3 m){
    if (uRound > 0.5) {
      float r = length(p), a = atan(p.y, p.x);
      return cos(m.x * a) * sin(m.y * 3.14159265 * r) + m.z * 0.35 * sin(2.0 * m.y * 3.14159265 * r + 1.0);
    }
    return cos(m.x * 3.14159265 * p.x) * cos(m.y * 3.14159265 * p.y) + m.z * cos(m.y * 3.14159265 * p.x) * cos(m.x * 3.14159265 * p.y);
  }
  vec2 settle(vec2 p, vec3 m){
    for (int i = 0; i < 9; i++) {
      float f = plate(p, m);
      const float e = 0.0015;
      vec2 g = vec2(plate(p + vec2(e, 0.0), m) - plate(p - vec2(e, 0.0), m), plate(p + vec2(0.0, e), m) - plate(p - vec2(0.0, e), m)) / (2.0 * e);
      p -= f * g / (dot(g, g) + 0.02);
      if (uRound > 0.5) { float r = length(p); if (r > 1.0) p /= r; } else p = clamp(p, -1.0, 1.0);
    }
    return p;
  }
`

function figure(round: boolean, pc: number, up: number): Mode {
  const m = (round ? ROUND : SQUARE)[((pc % 12) + 12) % 12]
  return [m[0] + up, m[1] + up, m[2]]
}

interface State { sand: Particles | null; count: number }

export const instrument = defineInstrument<State>({
  id: 'innuendo.chladni',
  name: 'Chladni Sand',
  description: 'Sand on a vibrating plate: chord rows pick the figure, grains fly and land on its nodal lines; blast, hop and shiver rows shake it.',
  color: '#ffd08a',
  params: {
    plate: p.select(['Square', 'Round'], 0),
    upright: p.bool(false, { label: 'Face camera' }),
    grains: p.int(120000, 10000, 400000),
    size: p.num(1.75, 0.2, 8, { label: 'Plate size' }),
    grain: p.num(1.9, 0.3, 6, { label: 'Grain size' }),
    settle: p.num(1.3, 0.1, 8, { label: 'Settle (beats)' }),
    alpha: p.num(0.42, 0.05, 1, { label: 'Density' }),
    cold: p.color('#ffd08a', { label: 'Sand' }),
    hot: p.color('#ff5a2a', { label: 'In flight' }),
    line: p.color('#fff4e0', { label: 'On the line' }),
  },
  rows: {
    [ROW.climb]: 'Climb (harmonic +1)',
    [ROW.shiver]: 'Shiver (hold)',
    [ROW.hop]: 'Hop',
    [ROW.blast]: { label: 'Blast', emphasized: true },
    ...Object.fromEntries(NAMES.map((n, i) => [ROW.mode0 + i, `Mode · ${n}`])),
  },

  setup() {
    return { sand: null, count: 0 }
  },

  frame(ctx, s) {
    const count = Math.round(ctx.params.grains)
    if (!s.sand || s.count !== count) {
      if (s.sand) { ctx.root.remove(s.sand); s.sand.dispose() }
      s.sand = particles({
        count, seed: 11, header: HEADER, vertex: VERTEX, hardness: 0.3,
        uniforms: {
          uA: { value: new THREE.Vector3(1, 2, 1) }, uB: { value: new THREE.Vector3(1, 2, 1) },
          uCold: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
          uAgeB: { value: 99 }, uSettle: { value: 0.5 }, uShake: { value: 0 }, uHop: { value: 0 }, uHopAge: { value: 99 },
          uBoom: { value: 0 }, uScale: { value: 1.75 }, uRound: { value: 0 }, uUpright: { value: 0 }, uGrain: { value: 1.9 }, uAlpha: { value: 0.42 },
        },
      })
      s.count = count
      ctx.root.add(s.sand)
    }
    const sand = s.sand
    const round = ctx.params.plate >= 0.5
    const isMode = (pitch: number) => pitch >= ROW.mode0 && pitch < ROW.mode0 + 12
    // The figure now, and what it was just before the latest change (mode or climb).
    const modeNow = ctx.last(isMode)
    const pcNow = modeNow ? modeNow.pitch - ROW.mode0 : 0
    const climbsNow = modeNow ? ctx.count(ROW.climb, modeNow.beat) : ctx.count(ROW.climb)
    const change = ctx.last((pitch) => isMode(pitch) || pitch === ROW.climb)
    const B = figure(round, pcNow, climbsNow % 3)
    let A = B
    if (change) {
      if (change.pitch === ROW.climb) {
        A = figure(round, pcNow, (climbsNow - 1) % 3)
      } else {
        const before = ctx.hits(isMode, Infinity, 2)[1]
        A = before ? figure(round, before.pitch - ROW.mode0, ctx.between(ROW.climb, before.beat, change.beat).length % 3) : B
      }
    }
    const u = sand.mat.uniforms
    sand.tick(ctx.beat, ctx.sec, ctx.px)
    ;(u.uA.value as THREE.Vector3).set(A[0], A[1], A[2])
    ;(u.uB.value as THREE.Vector3).set(B[0], B[1], B[2])
    u.uAgeB.value = change ? change.age : 99
    u.uSettle.value = ctx.params.settle
    u.uShake.value = ctx.gate(ROW.shiver, 0.05, 0.3) * 1.2 + ctx.pulse(ROW.shiver, 0.3) * 0.6
    const hop = ctx.last(ROW.hop)
    u.uHop.value = hop ? hop.velocity : 0
    u.uHopAge.value = hop ? hop.ageSec : 99
    const blast = ctx.last(ROW.blast)
    u.uBoom.value = blast ? Math.exp(-blast.ageSec / 0.55) * 1.6 * blast.velocity : 0
    u.uScale.value = ctx.params.size
    u.uRound.value = round ? 1 : 0
    u.uUpright.value = ctx.params.upright
    u.uGrain.value = ctx.params.grain
    u.uAlpha.value = ctx.params.alpha
    ;(u.uCold.value as THREE.Color).copy(ctx.colors.cold)
    ;(u.uHot.value as THREE.Color).copy(ctx.colors.hot).multiplyScalar(1.6)
    ;(u.uLine.value as THREE.Color).copy(ctx.colors.line)
  },

  dispose(s) {
    s.sand?.dispose()
  },
})
