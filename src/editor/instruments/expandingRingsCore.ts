// Pure math for Expanding Rings (the def: ExpandingRings.tsx; the R3F half:
// ExpandingRingsVisual.tsx). Everything is a function of the beat, so a static
// playhead is a static frame and scrubbing backward equals playing forward.

export const RINGS_MAX = 32

/** Polygon side counts by `shape` select value; 0 = circle (many-sided). */
export const RING_SIDES = [64, 3, 4, 5, 6, 8] as const

/** Expansion easing. `curve` ∈ [-1, 1]: 0 is constant speed, positive starts
 *  slow and accelerates outward, negative bursts out and decelerates. The
 *  exponent is 2^(2·curve), so ±1 is t⁴ / t^¼ - strong but still readable,
 *  and ±0.5 is the familiar quadratic ease. */
export function easeLife(life: number, curve: number): number {
  const t = Math.min(1, Math.max(0, life))
  return t ** 2 ** (2 * Math.min(1, Math.max(-1, curve)))
}

export interface Ring {
  /** Which ring of its note this is: 0 is the one born on the key press. */
  spawn: number
  /** The beat it was born. */
  born: number
  /** 0 at the center, 1 at full reach. Linear in time; ease it for radius. */
  life: number
}

/** The rings alive at `beat`, newest first, up to RINGS_MAX. Nothing exists
 *  until a note is pressed: each note emits a ring on the press and another
 *  every period/count beats while it is held, and a ring lives `period` beats.
 *  `cut` ends a ring the moment its note is released; otherwise rings already
 *  in flight finish expanding. Overlapping notes simply add their rings. */
export function ringsFromNotes(
  notes: readonly { beat: number; durationBeats: number }[],
  beat: number, period: number, count: number, cut = false, out: Ring[] = [],
): Ring[] {
  const n = Math.max(1, Math.min(RINGS_MAX, Math.round(count)))
  const life = Math.max(1e-3, period)
  const spacing = life / n
  out.length = 0
  for (const note of notes) {
    const since = beat - note.beat
    if (since < 0 || since >= note.durationBeats + life) continue
    if (cut && since >= note.durationBeats) continue
    // Spawns j·spacing for j ≥ 0 while the key is down (the press always spawns).
    const last = Math.min(Math.floor(since / spacing), Math.ceil(note.durationBeats / spacing - 1e-9) - 1)
    const first = Math.max(0, Math.floor((since - life) / spacing) + 1)
    for (let j = last; j >= first; j--) {
      const age = since - j * spacing
      if (age >= 0 && age < life) out.push({ spawn: j, born: note.beat + j * spacing, life: age / life })
    }
  }
  out.sort((a, b) => b.born - a.born)
  if (out.length > RINGS_MAX) out.length = RINGS_MAX
  return out
}

/** Gradient position for a ring. mode 0 ("Radius"): color follows how far the
 *  ring has expanded, so the screen shows the whole gradient. mode 1
 *  ("Cycle"): each ring keeps the color it was born with, stepping A→B→A
 *  across consecutive spawns, so the colors cycle as rings emerge. */
export function ringGradientT(mode: number, spawn: number, easedLife: number, count: number): number {
  if (mode < 0.5) return easedLife
  const x = (((spawn / Math.max(1, count)) % 2) + 2) % 2
  return x < 1 ? x : 2 - x
}

/** Opacity over a ring's life: full, then fading to 0 across the last `fade` fraction. */
export function ringOpacity(life: number, fade: number): number {
  if (fade <= 0) return life < 1 ? 1 : 0
  return Math.min(1, Math.max(0, (1 - life) / fade))
}

export const WIDTH_FILL = 0
export const WIDTH_CONSTANT = 1
export const WIDTH_TAPER = 2

/** Inner radius of a ring whose outer radius is `outer` (world units).
 *  FILL: the band reaches in to `nextInner` - the radius of the ring born just
 *  after it (0 for the newest) - so the bands tile the area with no gaps.
 *  CONSTANT: every ring is `width` wide. TAPER: `width` at birth, thinning to
 *  5% of it at full reach (`eased` is the ring's eased 0..1 expansion). */
export function ringInnerRadius(mode: number, outer: number, nextInner: number, width: number, eased: number): number {
  if (mode < WIDTH_CONSTANT - 0.5) return Math.min(outer, Math.max(0, nextInner))
  const w = mode < WIDTH_TAPER - 0.5 ? width : width * (1 - 0.95 * eased)
  return Math.max(0, outer - Math.max(0, w))
}
