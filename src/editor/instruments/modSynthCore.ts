import type { SynthMod, SynthModPoint, SynthModTarget } from '../types'

// The Mod Synth's pure half: curve sampling and per-voice channel math. Every
// note on the track spawns a VOICE (a copy of the object) and each modulator
// in the rack shapes one channel of that voice's flight. Everything here is a
// closed-form function of (mod, ageBeats, noteDurBeats) so the visual, the
// panel's plots and the tests all read the same signal - the panel cannot
// drift from playback because there is only one sampler.

/** Instance budget for the visual's mesh pool. Voices past it evict OLDEST -
 *  the copy about to die - never the newborn (Approach's allocator rule). */
export const MAX_SYNTH_VOICES = 64

/** A note shorter than this still flies for this long, so a zero-length drum
 *  hit under a gate-life modulator is a flash rather than nothing. */
export const MIN_VOICE_BEATS = 1 / 32

/** Pitch span key tracking maps over - the automation lanes' 36..84 window,
 *  so the roll's familiar range is also the synth's keyboard. */
const KEY_PITCH_MIN = 36
const KEY_PITCH_SPAN = 48

export interface SynthModTargetSpec {
  target: SynthModTarget
  label: string
  /** AMOUNT knob range in the target's own units. */
  amountMin: number
  amountMax: number
  amountDefault: number
  amountStep: number
  /** Signed range whose zero is mid-travel - the knob takes `bipolar`. */
  bipolar: boolean
}

/** The add-menu's vocabulary, and the one place amount units are declared:
 *  size is a multiplier on the object's own size, positions are world units,
 *  hue and rotation are turns. */
export const SYNTH_MOD_TARGETS: readonly SynthModTargetSpec[] = [
  { target: 'size', label: 'SIZE', amountMin: 0, amountMax: 3, amountDefault: 1, amountStep: 0.01, bipolar: false },
  { target: 'posX', label: 'POS X', amountMin: -6, amountMax: 6, amountDefault: 1.5, amountStep: 0.05, bipolar: true },
  { target: 'posY', label: 'POS Y', amountMin: -6, amountMax: 6, amountDefault: 1.5, amountStep: 0.05, bipolar: true },
  { target: 'posZ', label: 'POS Z', amountMin: -6, amountMax: 6, amountDefault: 1.5, amountStep: 0.05, bipolar: true },
  { target: 'opacity', label: 'OPACITY', amountMin: 0, amountMax: 1, amountDefault: 1, amountStep: 0.01, bipolar: false },
  { target: 'hue', label: 'HUE', amountMin: -1, amountMax: 1, amountDefault: 0.25, amountStep: 0.01, bipolar: true },
  { target: 'rotZ', label: 'ROT Z', amountMin: -2, amountMax: 2, amountDefault: 0.5, amountStep: 0.01, bipolar: true },
]

export function synthModTargetSpec(target: SynthModTarget): SynthModTargetSpec {
  return SYNTH_MOD_TARGETS.find((t) => t.target === target) ?? SYNTH_MOD_TARGETS[0]
}

/** A fresh modulator with musical defaults. `id` is the caller's (stable per
 *  rack - the panel mints `mod-<n>`); this module stays clock- and RNG-free. */
export function mkSynthMod(target: SynthModTarget, id: string): SynthMod {
  return {
    id,
    target,
    enabled: true,
    shape: 'adsr',
    life: 'gate',
    attack: 0.08,
    decay: 0.3,
    sustain: 0.55,
    release: 0.35,
    bezier: [{ x: 0.2, y: 1.05 }, { x: 0.55, y: 0.15 }],
    points: [
      { x: 0, y: 0 }, { x: 0.18, y: 0.9 }, { x: 0.45, y: 0.3 },
      { x: 0.72, y: 0.65 }, { x: 1, y: 0 },
    ],
    beats: 1,
    amount: synthModTargetSpec(target).amountDefault,
    velocity: 0.5,
    keyTracking: 0,
  }
}

/** The starter rack an absent `synthMods` field resolves to: a size swell, a
 *  rising drift and an opacity gate, so a fresh Mod Synth answers its first
 *  note with a finished-looking voice. Frozen - never hand a caller a copy
 *  they could mutate into the shared default. */
export const DEFAULT_SYNTH_MODS: readonly SynthMod[] = Object.freeze([
  Object.freeze(mkSynthMod('size', 'default-size')),
  Object.freeze({ ...mkSynthMod('posY', 'default-posY'), shape: 'bezier' as const, life: 'oneshot' as const, beats: 1.5 }),
  Object.freeze(mkSynthMod('opacity', 'default-opacity')),
]) as readonly SynthMod[]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── ADSR (beat-based: an attack must not stretch with note length) ──────────

/** Envelope level before any release: attack ramp, decay to sustain, hold. */
function adsrPre(mod: SynthMod, t: number): number {
  const a = Math.max(mod.attack, 1e-4)
  const d = Math.max(mod.decay, 1e-4)
  if (t <= 0) return 0
  if (t < a) return t / a
  if (t < a + d) return 1 + (mod.sustain - 1) * ((t - a) / d)
  return mod.sustain
}

/** One ADSR cycle with the release starting at `relStart` (gate: note end;
 *  oneshot/loop: end of decay). Releases from the CURRENT level, so a note
 *  shorter than attack+decay lets go mid-ramp instead of jumping to sustain. */
function adsrValue(mod: SynthMod, t: number, relStart: number): number {
  const r = Math.max(mod.release, 1e-4)
  if (t < relStart) return adsrPre(mod, t)
  const remaining = 1 - (t - relStart) / r
  if (remaining <= 0) return 0
  return adsrPre(mod, relStart) * remaining
}

// ── Bezier (endpoints pinned at 0; y(x) via a cached parametric LUT) ────────

const BEZIER_LUT_STEPS = 48
const bezierLutCache = new WeakMap<SynthMod, Float32Array>()

/** x0,y0,x1,y1,... samples along the parametric cubic. Mods are immutable per
 *  edit (the store replaces the array), so the WeakMap invalidates for free. */
function bezierLut(mod: SynthMod): Float32Array {
  let lut = bezierLutCache.get(mod)
  if (lut) return lut
  lut = new Float32Array((BEZIER_LUT_STEPS + 1) * 2)
  const [p1, p2] = mod.bezier
  for (let i = 0; i <= BEZIER_LUT_STEPS; i++) {
    const t = i / BEZIER_LUT_STEPS
    const mt = 1 - t
    lut[i * 2] = 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t
    lut[i * 2 + 1] = 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y
  }
  bezierLutCache.set(mod, lut)
  return lut
}

function bezierValue(mod: SynthMod, u: number): number {
  if (u <= 0 || u >= 1) return 0
  const lut = bezierLut(mod)
  for (let i = 2; i < lut.length; i += 2) {
    if (lut[i] >= u) {
      const x0 = lut[i - 2], y0 = lut[i - 1], x1 = lut[i], y1 = lut[i + 1]
      const f = x1 > x0 ? (u - x0) / (x1 - x0) : 0
      return y0 + (y1 - y0) * f
    }
  }
  return lut[lut.length - 1]
}

// ── Points (monotone-x hermite, the automation spline's tangent rule) ───────

/** Value at u along the hand-drawn curve. Tangents are the non-uniform
 *  three-point difference (the spline lane's convention), endpoints 0, so the
 *  shape is C1 and gap-independent; segments evaluate closed-form. */
function pointsValue(pts: readonly SynthModPoint[], u: number): number {
  if (pts.length === 0) return 0
  if (u <= pts[0].x) return pts[0].y
  const last = pts[pts.length - 1]
  if (u >= last.x) return last.y
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= u) {
      const p0 = pts[i - 1], p1 = pts[i]
      const h = Math.max(p1.x - p0.x, 1e-5)
      const m0 = i >= 2 ? (p1.y - pts[i - 2].y) / Math.max(p1.x - pts[i - 2].x, 1e-5) : 0
      const m1 = i + 1 < pts.length ? (pts[i + 1].y - p0.y) / Math.max(pts[i + 1].x - p0.x, 1e-5) : 0
      const s = (u - p0.x) / h
      const s2 = s * s, s3 = s2 * s
      return (2 * s3 - 3 * s2 + 1) * p0.y + (s3 - 2 * s2 + s) * h * m0
        + (-2 * s3 + 3 * s2) * p1.y + (s3 - s2) * h * m1
    }
  }
  return last.y
}

// ── Spans and sampling ──────────────────────────────────────────────────────

/** How many beats past its onset this modulator keeps a voice alive. */
export function synthModSpanBeats(mod: SynthMod, noteDurBeats: number): number {
  const dur = Math.max(noteDurBeats, MIN_VOICE_BEATS)
  if (mod.shape === 'adsr') {
    if (mod.life === 'oneshot') return mod.attack + mod.decay + mod.release
    if (mod.life === 'loop') return dur
    return dur + mod.release
  }
  if (mod.life === 'oneshot') return Math.max(mod.beats, MIN_VOICE_BEATS)
  return dur
}

/**
 * THE sampler: one modulator's raw curve value at a voice age. Raw = before
 * amount/velocity/key scaling, so the panel can plot the shape alone.
 */
export function sampleSynthMod(mod: SynthMod, ageBeats: number, noteDurBeats: number): number {
  const dur = Math.max(noteDurBeats, MIN_VOICE_BEATS)
  if (ageBeats < 0) return 0
  if (mod.shape === 'adsr') {
    if (mod.life === 'oneshot') return adsrValue(mod, ageBeats, mod.attack + mod.decay)
    if (mod.life === 'loop') {
      if (ageBeats >= dur) return 0
      const cycle = Math.max(mod.attack + mod.decay + mod.release, 1e-3)
      return adsrValue(mod, ageBeats % cycle, mod.attack + mod.decay)
    }
    return adsrValue(mod, ageBeats, dur)
  }
  const curve = mod.shape === 'bezier'
    ? (u: number) => bezierValue(mod, u)
    : (u: number) => pointsValue(mod.points, u)
  if (mod.life === 'oneshot') {
    const span = Math.max(mod.beats, MIN_VOICE_BEATS)
    return ageBeats >= span ? 0 : curve(ageBeats / span)
  }
  if (mod.life === 'loop') {
    if (ageBeats >= dur) return 0
    const cycle = Math.max(mod.beats, MIN_VOICE_BEATS)
    return curve((ageBeats % cycle) / cycle)
  }
  return ageBeats >= dur ? 0 : curve(ageBeats / dur)
}

/** A voice lives as long as its longest enabled modulator says; with a bare
 *  rack the note itself is the flight. */
export function synthVoiceSpanBeats(mods: readonly SynthMod[], noteDurBeats: number): number {
  let span = 0
  let any = false
  for (const mod of mods) {
    if (!mod.enabled) continue
    any = true
    span = Math.max(span, synthModSpanBeats(mod, noteDurBeats))
  }
  if (!any) span = Math.max(noteDurBeats, MIN_VOICE_BEATS)
  return Math.max(span, MIN_VOICE_BEATS)
}

/** The channels one voice wears at one instant. Neutral values are what an
 *  unmodulated channel shows: full size, home position, fully opaque (`alpha`
 *  is the voice's own opacity channel - named off the lint-guarded word). */
export interface SynthVoiceChannels {
  size: number
  posX: number
  posY: number
  posZ: number
  alpha: number
  /** Hue rotation in turns off the instrument's own color. */
  hue: number
  /** Rotation about the view axis, in turns. */
  rotZ: number
}

/** Scratch-friendly: pass `out` to avoid per-voice allocation in the frame
 *  loop. velocity01 is the note's 0..1 velocity; pitch keys the tracking. */
export function computeSynthVoice(
  mods: readonly SynthMod[],
  ageBeats: number,
  noteDurBeats: number,
  velocity01: number,
  pitch: number,
  out: SynthVoiceChannels,
): SynthVoiceChannels {
  let sizeSum = 0, hasSize = false
  let opacitySum = 0, hasOpacity = false
  out.posX = 0; out.posY = 0; out.posZ = 0; out.hue = 0; out.rotZ = 0
  const keyNorm = clamp((pitch - KEY_PITCH_MIN) / KEY_PITCH_SPAN, 0, 1)
  const vel = clamp(velocity01, 0, 1)
  for (const mod of mods) {
    if (!mod.enabled) continue
    const raw = sampleSynthMod(mod, ageBeats, noteDurBeats)
    if (raw === 0 && mod.target !== 'size' && mod.target !== 'opacity') continue
    const v = raw * mod.amount
      * (1 + (vel - 1) * mod.velocity)
      * (1 + (keyNorm - 1) * mod.keyTracking)
    switch (mod.target) {
      case 'size': sizeSum += v; hasSize = true; break
      case 'posX': out.posX += v; break
      case 'posY': out.posY += v; break
      case 'posZ': out.posZ += v; break
      case 'opacity': opacitySum += v; hasOpacity = true; break
      case 'hue': out.hue += v; break
      case 'rotZ': out.rotZ += v; break
    }
  }
  out.size = hasSize ? Math.max(0, sizeSum) : 1
  out.alpha = hasOpacity ? clamp(opacitySum, 0, 1) : 1
  return out
}
