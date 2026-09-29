// Shared music-geometry helpers for the innuendo pack (the leading underscore
// keeps the registry generator from treating this as an instrument).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Just-intonation ratio for an interval in semitones - the shape of a Lissajous figure. */
export const JUST: Array<[number, number]> = [
  [1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [7, 5], [3, 2], [8, 5], [5, 3], [7, 4], [15, 8],
]

export const pitchClass = (pitch: number) => ((Math.round(pitch) % 12) + 12) % 12

/** Interval above the key root, 0..11. */
export const interval = (pitch: number, root: number) => (((Math.round(pitch) - root) % 12) + 12) % 12

/** Position of a pitch class on the circle of fifths (0..11), root at 0. */
export const fifths = (pc: number, root: number) => ((((pc - root) % 12) + 12) % 12) * 7 % 12

/** Angle for circle-of-fifths position k on side ±1 (mirrored across the vertical), root at the top. */
export function fifthsAngle(k: number, side: 1 | -1, spin = 0): number {
  const a = (k / 12) * Math.PI * 2
  return side > 0 ? Math.PI / 2 - a + spin : Math.PI / 2 + a - spin
}

/** Step k (0..15) of a bar on a mirrored ring: top = downbeat, bottom = the last 16th, both halves. */
export function stepAngle(k: number, side: 1 | -1): number {
  const x = ((k + 0.5) / 16) * Math.PI
  return side > 0 ? Math.PI / 2 - x : Math.PI / 2 + x
}

export const KEY_OPTIONS = NOTE_NAMES
