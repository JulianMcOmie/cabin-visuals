// The Burst easing families, shared by every definition whose MIDI notes
// launch "bursts" (violent start, soft landing). Kept in its own module so
// definitions collected by library.ts can use it without importing the
// library itself.
//
// Two families live here, back to back:
//   STEP curves (indices 0-5) map 0→0, 1→1 - each note permanently steps the
//     object to a new destination. Elastic and Back deliberately overshoot
//     en route.
//   RETURN curves (indices 6+) map 0→0, 1→0 - like a normal ADSR envelope,
//     the excursion ends exactly where it started, so the note's
//     displacement is temporary instead of cumulative.
//
// The easing index is persisted in saved projects: append only, never
// reorder or remove entries.

export interface BurstEasing {
  label: string
  ease: (t: number) => number
  /** True for round-trip (ADSR-style) curves: ease(1) === ease(0), so once
   *  the burst lands the object is back at its pre-note position. */
  returnsHome?: boolean
}

export const BURST_EASINGS: BurstEasing[] = [
  // ── Step family: permanent displacement (0→0, 1→1) ────────────────────────
  { label: 'Expo', ease: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)) },
  { label: 'Cubic', ease: (t) => 1 - Math.pow(1 - t, 3) },
  { label: 'Quad', ease: (t) => 1 - (1 - t) * (1 - t) },
  {
    label: 'Elastic',
    ease: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  },
  {
    label: 'Back',
    ease: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  },
  { label: 'Linear', ease: (t) => t },

  // ── Return family: round trip, ends where it starts (0→0, 1→0) ───────────
  {
    // A literal ADSR: fast attack to the peak, decay to a sustain plateau,
    // hold, then release all the way back home.
    label: 'ADSR',
    returnsHome: true,
    ease: (t) => {
      if (t <= 0 || t >= 1) return 0
      const attack = 0.15
      const decay = 0.15
      const sustain = 0.65
      const holdEnd = 0.6
      if (t < attack) return t / attack
      if (t < attack + decay) return 1 - (1 - sustain) * ((t - attack) / decay)
      if (t < holdEnd) return sustain
      return sustain * (1 - (t - holdEnd) / (1 - holdEnd))
    },
  },
  { label: 'Sine', returnsHome: true, ease: (t) => Math.sin(Math.PI * t) },
  {
    label: 'Tri',
    returnsHome: true,
    ease: (t) => (t <= 0 || t >= 1 ? 0 : t < 0.5 ? 2 * t : 2 - 2 * t),
  },
  {
    // Violent expo jump out, mirrored violent snap back - the burst family's
    // signature aggression, but round-trip.
    label: 'Snap',
    returnsHome: true,
    ease: (t) =>
      t <= 0 || t >= 1
        ? 0
        : t < 0.5
          ? 1 - Math.pow(2, -20 * t) // easeOutExpo over the first half
          : 1 - Math.pow(2, 20 * t - 20), // mirrored easeInExpo back home
  },
]
