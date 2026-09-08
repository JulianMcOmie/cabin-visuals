// Glass Roll's pure half: keyboard geometry and the sparkle-plume kinematics.
// Type-only imports so the colocated test can import it (see CLAUDE.md,
// "Testing an instrument"). Everything here is a function of (age, seed,
// params) - no state, no clock - which is what makes the roll's particles a
// pure function of the beat: a plume at age t looks the same whether you
// played into it or scrubbed to it.

/** Same formula as core/visual/instrumentFrame's seededRand, duplicated so
 *  this module stays engine-free. */
export function rand01(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

// ── Keyboard geometry ───────────────────────────────────────────────────────

const BLACK_IN_OCTAVE = [false, true, false, true, false, false, true, false, true, false, true, false]
/** Semitone → white-key ordinal within the octave (black keys take the white below). */
const WHITE_ORDINAL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]

export function isBlackKey(pitch: number): boolean {
  return BLACK_IN_OCTAVE[((pitch % 12) + 12) % 12]
}

/** Count of white keys strictly below `pitch` from pitch 0 (C-1). */
export function whiteIndex(pitch: number): number {
  const oct = Math.floor(pitch / 12)
  return oct * 7 + WHITE_ORDINAL[((pitch % 12) + 12) % 12]
}

/** Snap a range onto white keys so the keyboard starts and ends on one. */
export function whiteKeyRange(low: number, high: number): [number, number] {
  let lo = Math.min(low, high)
  let hi = Math.max(low, high)
  while (isBlackKey(lo)) lo--
  while (isBlackKey(hi)) hi++
  return [lo, hi]
}

export interface KeyLayout {
  lowKey: number
  highKey: number
  whiteCount: number
  /** Width of one white key in canvas px. */
  whiteW: number
  /** Black key width in px (the reference piano's ~0.6 ratio). */
  blackW: number
}

export function keyLayout(low: number, high: number, width: number): KeyLayout {
  const [lowKey, highKey] = whiteKeyRange(low, high)
  const whiteCount = whiteIndex(highKey) - whiteIndex(lowKey) + 1
  const whiteW = width / whiteCount
  return { lowKey, highKey, whiteCount, whiteW, blackW: whiteW * 0.6 }
}

/** Center x of a pitch's key. White keys sit on the even grid; a black key
 *  straddles the boundary between its neighbouring whites, nudged the way a
 *  real keyboard cuts them (C#/F# lean left, D#/A# lean right, G# centered). */
export function keyCenterX(layout: KeyLayout, pitch: number): number {
  const wi = whiteIndex(pitch) - whiteIndex(layout.lowKey)
  if (!isBlackKey(pitch)) return (wi + 0.5) * layout.whiteW
  const semi = ((pitch % 12) + 12) % 12
  // Boundary right of the white key below, then the ergonomic nudge.
  const nudge = semi === 1 || semi === 6 ? -0.08 : semi === 3 || semi === 10 ? 0.08 : 0
  return (wi + 1 + nudge) * layout.whiteW
}

/** The tile width a note on this key wears (before the user's Note Width).
 *  A black-key tile is ~0.64 of a white one in the reference - wider than
 *  the black key itself (0.6), which is drawn to look like a key. */
export function keyNoteWidth(layout: KeyLayout, pitch: number): number {
  return isBlackKey(pitch) ? layout.whiteW * 0.64 : layout.whiteW
}

/** Fit-to-notes range: the sounding pitches, padded a white key each side,
 *  and never narrower than two octaves so a short motif does not blow up
 *  into three giant tiles. */
export function fitRange(minPitch: number, maxPitch: number): [number, number] {
  if (!Number.isFinite(minPitch) || !Number.isFinite(maxPitch)) return [48, 72]
  let lo = minPitch - 1
  let hi = maxPitch + 1
  const span = hi - lo
  if (span < 24) {
    const pad = Math.ceil((24 - span) / 2)
    lo -= pad
    hi += pad
  }
  return whiteKeyRange(Math.max(0, lo), Math.min(127, hi))
}

// ── Sparkle dust kinematics ─────────────────────────────────────────────────
//
// Measured off the reference press, 0.1 s per frame: on the strike the tile
// becomes a white pillar and a few sparks shoot up off its head; while it is
// held, dust gathers around the pillar; on release the pillar drops out in
// ~0.1 s and leaves a PUFF - a loose cluster of glowing motes about a tile
// and a half wide - that drifts up slowly (~45 px/s at 970p), spreads, and
// fades over ~1.5 s, with a few thin blue vapor streaks racing up ahead of
// it. So a note's dust is a set of MOTES (each a closed-form path in age)
// plus a handful of STREAKS, not a continuous ribbon.

export interface DustParams {
  /** Initial upward speed scale, px per second. */
  rise: number
  /** Initial lateral speed reach, px per second. */
  spread: number
  /** Wobble amplitude, px. */
  curl: number
  /** Mote lifetime, seconds (each mote lives a seeded fraction of it). */
  life: number
}

export interface DustPose {
  x: number
  y: number
  /** 0..1 life fraction. */
  t: number
}

/** Where mote `seed` sits `age` seconds after birth, from its origin: a
 *  kick upward that decays into a slow drift, a lateral shove that decays
 *  the same way, and a two-tone wobble that fades in. */
export function motePose(seed: number, age: number, origin: { x: number; y: number }, p: DustParams, out: DustPose, held = 0): DustPose {
  const r0 = rand01(seed)
  const r1 = rand01(seed + 1.37)
  const r2 = rand01(seed + 2.71)
  const r3 = rand01(seed + 3.91)
  const life = p.life * (0.7 + 0.6 * r3)
  const tau = 0.45
  const decay = tau * (1 - Math.exp(-age / tau))
  const vy0 = p.rise * (0.5 + 1.2 * r0)
  const drift = p.rise * 0.35
  // While the pillar under it still burns (`held` seconds after this
  // mote's birth) the dust is carried up faster - a long note lifts its
  // cloud high, a tap leaves a low puff.
  const lift = p.rise * 0.6 * Math.min(age, Math.max(0, held))
  const y = origin.y - vy0 * decay - drift * age - lift
  const vx0 = (r1 - 0.5) * 2 * p.spread
  // A SLOW lean, not a wobble: the reference dust curls over about a second;
  // anything faster reads as jitter in the glow under the note.
  const wob = Math.min(1, age / 0.6) * p.curl * (0.5 + r2)
  const x = origin.x + vx0 * decay * 1.3 + wob * Math.sin(age * (0.7 + 0.6 * r2) + r0 * 6.283)
  out.x = x
  out.y = y
  out.t = age / life
  return out
}

/** Mote alpha over its life: on fast, held, then a long fade. */
export function moteEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0
  const on = Math.min(1, t / 0.05)
  const off = t < 0.3 ? 1 : Math.pow(1 - (t - 0.3) / 0.7, 1.4)
  return on * off
}

/** A vapor streak's head: a fast rise that decays hard, gently curving. */
export function streakPose(seed: number, age: number, origin: { x: number; y: number }, rise: number, out: DustPose): DustPose {
  const r0 = rand01(seed)
  const r1 = rand01(seed + 1.37)
  const tau = 0.5
  const decay = tau * (1 - Math.exp(-age / tau))
  out.y = origin.y - rise * (1.4 + 1.2 * r0) * decay
  out.x = origin.x + (r1 - 0.5) * 30 * age + (r1 < 0.5 ? -1 : 1) * 45 * age * age
  out.t = age / 0.8
  return out
}
