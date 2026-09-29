// The motion library for code instruments: easing, springs, envelopes,
// oscillators, noise and seeded randomness - every function PURE, so anything
// built from them is a function of the beat and scrub == playback == export.
//
// Conventions: time arguments are whatever unit the caller uses consistently
// (beats or seconds - `ctx.sec` / `hit.ageSec` when a motion should keep its
// speed across tempos, beats when it should lock to the grid). Progress
// arguments (`p`) run 0..1.

import { bezier, ease, easeByName, easeNames, type Ease } from '../../core/easing'

export const TAU = Math.PI * 2

// ------------------------------------------------------------------ scalars

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, x: number) => (b === a ? 0 : (x - a) / (b - a))
export const remap = (x: number, a0: number, a1: number, b0: number, b1: number, clamped = true) => {
  const t = invLerp(a0, a1, x)
  return lerp(b0, b1, clamped ? clamp(t) : t)
}
export const fract = (x: number) => x - Math.floor(x)
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp(invLerp(a, b, x))
  return t * t * (3 - 2 * t)
}
export const smootherstep = (a: number, b: number, x: number) => {
  const t = clamp(invLerp(a, b, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}
/** 0 → 1 → 0 over one period (a triangle), for back-and-forth motion. */
export const pingpong = (x: number) => 1 - Math.abs(fract(x) * 2 - 1)
/** Shortest signed angle from a to b (radians). */
export const angleDelta = (a: number, b: number) => {
  const d = fract((b - a) / TAU + 0.5) * TAU - Math.PI
  return d
}

// ------------------------------------------------------------------ easing (Penner family, plus CSS bezier)
// The curves live in core/easing.ts - the engine's automation keyframes use the
// same names ('expo.out', 'back.inOut' …) as instruments.

export { bezier, ease, easeByName, easeNames }
export type { Ease }

/** Eased progress of a motion that starts at `t0` and lasts `dur` (0 before, 1 after). */
export function tween(t: number, t0: number, dur: number, f: Ease = ease.expo.out): number {
  return f(clamp((t - t0) / Math.max(1e-9, dur)))
}

// ------------------------------------------------------------------ keyframes

/** [time, value, ease-into-this-key?] */
export type Keyframe = [number, number, Ease?]

/** A keyframe track as a pure function of time: holds the first value before the
 *  first key and the last after the last; each segment eases with the ease on
 *  its END key (default smooth). Keys must be sorted by time. */
export function keyframes(keys: Keyframe[]): (t: number) => number {
  return (t) => {
    if (keys.length === 0) return 0
    if (t <= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, f] = keys[i]
      if (t < t1) {
        const [t0, v0] = keys[i - 1]
        return lerp(v0, v1, (f ?? ease.sine.inOut)(clamp((t - t0) / Math.max(1e-9, t1 - t0))))
      }
    }
    return keys[keys.length - 1][1]
  }
}

// ------------------------------------------------------------------ physics-shaped responses (closed form)

export interface SpringOpts {
  /** Natural frequency in cycles per time unit. */
  freq?: number
  /** Damping ratio: < 1 overshoots and rings, 1 is critical, > 1 creeps. */
  damping?: number
}

/**
 * Step response of a damped spring: 0 at t=0, settling at 1 (overshooting when
 * underdamped). The closed form, not an integrator, so any t can be sampled
 * directly - a spring started by a note is `spring(hit.age)`.
 */
export function spring(t: number, { freq = 2, damping = 0.35 }: SpringOpts = {}): number {
  if (t <= 0) return 0
  const w = freq * TAU
  const z = damping
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
  }
  if (z === 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const s = Math.sqrt(z * z - 1)
  const r1 = -w * (z - s), r2 = -w * (z + s)
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2)
}

/** Impulse response of the same spring, normalised so its first peak is 1: a
 *  kick's "thump then ring". 0 at t=0, back to ~0 as it settles. */
export function springKick(t: number, { freq = 2, damping = 0.25 }: SpringOpts = {}): number {
  if (t <= 0) return 0
  const w = freq * TAU
  const z = Math.min(0.999, damping)
  const wd = w * Math.sqrt(1 - z * z)
  const tp = Math.atan2(wd, z * w) / wd
  const peak = Math.exp(-z * w * tp) * Math.sin(wd * tp)
  return (Math.exp(-z * w * t) * Math.sin(wd * t)) / peak
}

/** A strike: linear attack, exponential decay (`decay` = time to fall to 1/e). */
export function impulse(t: number, attack = 0.01, decay = 0.25): number {
  if (t < 0) return 0
  if (t < attack) return t / Math.max(1e-9, attack)
  return Math.exp(-(t - attack) / Math.max(1e-9, decay))
}

/** Exponential decay with a half-life. */
export const decay = (t: number, halfLife: number) => (t < 0 ? 0 : Math.pow(0.5, t / Math.max(1e-9, halfLife)))

/** ADSR for a note held for `held` (time since onset = t). */
export function adsr(t: number, held: number, { a = 0.01, d = 0.1, s = 0.7, r = 0.2 } = {}): number {
  if (t < 0) return 0
  const level = (x: number) => (x < a ? x / Math.max(1e-9, a) : x < a + d ? lerp(1, s, (x - a) / Math.max(1e-9, d)) : s)
  if (t <= held) return level(t)
  return level(held) * Math.max(0, 1 - (t - held) / Math.max(1e-9, r))
}

// ------------------------------------------------------------------ oscillators (period 1 unless freq given)

export const osc = {
  sine: (t: number, freq = 1, phase = 0) => Math.sin((t * freq + phase) * TAU),
  cos: (t: number, freq = 1, phase = 0) => Math.cos((t * freq + phase) * TAU),
  tri: (t: number, freq = 1, phase = 0) => pingpong(t * freq + phase) * 2 - 1,
  saw: (t: number, freq = 1, phase = 0) => fract(t * freq + phase) * 2 - 1,
  square: (t: number, freq = 1, phase = 0, duty = 0.5) => (fract(t * freq + phase) < duty ? 1 : -1),
}

// ------------------------------------------------------------------ seeded randomness

/** Deterministic hash of any numbers → [0, 1). Same inputs, same output, every run. */
export function hash(...n: number[]): number {
  let h = 2166136261 >>> 0
  for (const v of n) {
    const x = Math.floor(v * 1000003) | 0
    h ^= x & 0xff; h = Math.imul(h, 16777619)
    h ^= (x >>> 8) & 0xff; h = Math.imul(h, 16777619)
    h ^= (x >>> 16) & 0xff; h = Math.imul(h, 16777619)
    h ^= (x >>> 24) & 0xff; h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** A seeded generator (mulberry32) for building layouts at setup time. */
export function rng(seed: number): () => number {
  let a = (Math.floor(seed * 2654435761) >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------------ noise (simplex, Gustavson; seeded permutation)

const grad3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1])
const perm = new Uint8Array(512)
const permMod12 = new Uint8Array(512)
{
  const r = rng(1337)
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12 }
}

/** 2D simplex noise in [-1, 1]. */
export function noise2(xin: number, yin: number): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6
  const s = (xin + yin) * F2
  const i = Math.floor(xin + s), j = Math.floor(yin + s)
  const t = (i + j) * G2
  const x0 = xin - (i - t), y0 = yin - (j - t)
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2
  const ii = i & 255, jj = j & 255
  let n = 0
  let t0 = 0.5 - x0 * x0 - y0 * y0
  if (t0 > 0) { const g = permMod12[ii + perm[jj]] * 3; t0 *= t0; n += t0 * t0 * (grad3[g] * x0 + grad3[g + 1] * y0) }
  let t1 = 0.5 - x1 * x1 - y1 * y1
  if (t1 > 0) { const g = permMod12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n += t1 * t1 * (grad3[g] * x1 + grad3[g + 1] * y1) }
  let t2 = 0.5 - x2 * x2 - y2 * y2
  if (t2 > 0) { const g = permMod12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n += t2 * t2 * (grad3[g] * x2 + grad3[g + 1] * y2) }
  return 70 * n
}

/** 3D simplex noise in [-1, 1]. */
export function noise3(xin: number, yin: number, zin: number): number {
  const F3 = 1 / 3, G3 = 1 / 6
  const s = (xin + yin + zin) * F3
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s)
  const t = (i + j + k) * G3
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t)
  let i1, j1, k1, i2, j2, k2
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3
  const ii = i & 255, jj = j & 255, kk = k & 255
  let n = 0
  const corner = (x: number, y: number, z: number, g: number) => {
    let tt = 0.6 - x * x - y * y - z * z
    if (tt < 0) return 0
    tt *= tt
    return tt * tt * (grad3[g] * x + grad3[g + 1] * y + grad3[g + 2] * z)
  }
  n += corner(x0, y0, z0, permMod12[ii + perm[jj + perm[kk]]] * 3)
  n += corner(x1, y1, z1, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3)
  n += corner(x2, y2, z2, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3)
  n += corner(x3, y3, z3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3)
  return 32 * n
}

/** Fractal (fbm) 3D noise, roughly in [-1, 1]. */
export function fbm3(x: number, y: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 0.5, f = 1, sum = 0, norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f)
    norm += amp
    amp *= gain
    f *= lacunarity
  }
  return sum / norm
}

/** Divergence-free curl of 3D noise: smoke-like flow for particles. Returns [x,y,z]. */
export function curl3(x: number, y: number, z: number, e = 0.01): [number, number, number] {
  // Vector potential ψ = (ψ1, ψ2, ψ3): three independent noise fields (offset
  // copies of one), and the flow is curl ψ.
  const psi = (k: number, a: number, b: number, c: number) => noise3(a + k * 31.4, b - k * 17.2, c + k * 54.1)
  const d = (k: number, ax: 0 | 1 | 2) => {
    const o = [0, 0, 0]
    o[ax] = e
    return (psi(k, x + o[0], y + o[1], z + o[2]) - psi(k, x - o[0], y - o[1], z - o[2])) / (2 * e)
  }
  return [d(2, 1) - d(1, 2), d(0, 2) - d(2, 0), d(1, 0) - d(0, 1)]
}

// ------------------------------------------------------------------ layout helpers

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Point i of n on a Fibonacci sphere (unit radius). */
export function fibonacciSphere(i: number, n: number): [number, number, number] {
  const y = 1 - (i / Math.max(1, n - 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = GOLDEN_ANGLE * i
  return [Math.cos(th) * r, y, Math.sin(th) * r]
}

/** Inigo Quilez's cosine palette: a + b·cos(2π(c·t + d)), per channel → [r,g,b]. */
export function cosinePalette(
  t: number,
  a: [number, number, number] = [0.5, 0.5, 0.5],
  b: [number, number, number] = [0.5, 0.5, 0.5],
  c: [number, number, number] = [1, 1, 1],
  d: [number, number, number] = [0, 0.33, 0.67],
): [number, number, number] {
  return [0, 1, 2].map((k) => a[k] + b[k] * Math.cos(TAU * (c[k] * t + d[k]))) as [number, number, number]
}
