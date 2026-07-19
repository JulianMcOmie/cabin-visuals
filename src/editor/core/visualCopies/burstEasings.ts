// The Burst ease-out family, shared by every definition whose MIDI notes
// launch ease-out "bursts" (violent start, soft landing). Kept in its own
// module so definitions collected by library.ts can use it without importing
// the library itself. All curves map 0→0, 1→1; elastic and back deliberately
// overshoot en route.

export const BURST_EASINGS: { label: string; ease: (t: number) => number }[] = [
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
]
