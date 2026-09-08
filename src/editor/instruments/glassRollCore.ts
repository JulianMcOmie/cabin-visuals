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

// ── Sparkle plume kinematics ────────────────────────────────────────────────
//
// The reference plume is a fluid sim: dust rising off the struck key in
// curling ribbons. Modeled as WISPS - a wisp is one ribbon, born at a fixed
// interval while the note sounds, riding its own drift and curl - and the
// dust is particles scattered around the wisp's spine, spreading as they
// age. Positions are closed-form in age, so any frame is computable alone.

export interface PlumeParams {
  /** Rise speed, px per second. */
  rise: number
  /** Lateral drift reach, px per second at full spread. */
  spread: number
  /** Curl amplitude, px. */
  curl: number
  /** Wisp lifetime, seconds (particles live a seeded fraction of it). */
  life: number
}

export interface WispPose {
  x: number
  y: number
  /** 0..1 life fraction. */
  t: number
}

/** Where wisp `seed` sits `age` seconds after birth, from its origin. */
export function wispPose(seed: number, age: number, origin: { x: number; y: number }, p: PlumeParams, out: WispPose): WispPose {
  const r0 = rand01(seed)
  const r1 = rand01(seed + 1.37)
  const r2 = rand01(seed + 2.71)
  const r3 = rand01(seed + 3.91)
  const life = p.life * (0.75 + 0.5 * r3)
  const t = age / life
  // An initial kick (the strike throws the dust up) settling into a steady
  // rise that eases slightly as the ribbon thins out.
  const vy = p.rise * (0.8 + 0.45 * r0)
  const kick = p.rise * 0.45 * (1 - Math.exp(-age / 0.3))
  const y = origin.y - kick - vy * age * (1 - 0.18 * Math.min(1, t))
  // Drift: a seeded constant lateral velocity, plus a curl that grows with
  // age so ribbons start straight off the key and bend as they climb.
  const vx = (r1 - 0.5) * 2 * p.spread
  const curlAmp = p.curl * (0.5 + r2) * Math.min(1, age / 0.6)
  const curlFreq = 1.6 + 2.2 * r2
  const x = origin.x + vx * age + curlAmp * Math.sin(age * curlFreq + r0 * 6.283)
  out.x = x
  out.y = y
  out.t = t
  return out
}

/** Alpha envelope for a life fraction: quick in, long tail out. */
export function plumeEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0
  const rise = Math.min(1, t / 0.08)
  const fall = 1 - t
  return rise * fall * fall
}
