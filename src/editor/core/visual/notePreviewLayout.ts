import type { Note } from '../../types'

/**
 * Returns each visible pitch's normalized top-to-bottom position.
 *
 * Semantic instruments use their declared row order (first = top), exactly as
 * the MIDI editor does. Unmapped pitches are appended below those rows in
 * descending order; strict vocabularies omit them. Plain piano-roll tracks
 * retain the familiar high-pitch-at-top numeric layout.
 */
export function notePreviewPitchPositions(
  notes: Pick<Note, 'pitch'>[],
  declaredPitches?: number[],
  strict = false,
): Map<number, number> {
  if (declaredPitches) {
    const ordered = [...new Set(declaredPitches)]
    const known = new Set(ordered)
    if (!strict) {
      const orphans = [...new Set(notes.map((note) => note.pitch))]
        .filter((pitch) => !known.has(pitch))
        .sort((a, b) => b - a)
      ordered.push(...orphans)
    }
    const denominator = Math.max(1, ordered.length - 1)
    return new Map(ordered.map((pitch, index) => [pitch, index / denominator]))
  }

  let minPitch = notes[0]?.pitch ?? 60
  let maxPitch = minPitch
  for (const note of notes) {
    if (note.pitch < minPitch) minPitch = note.pitch
    if (note.pitch > maxPitch) maxPitch = note.pitch
  }
  const span = Math.max(12, maxPitch - minPitch)
  const lo = (minPitch + maxPitch) / 2 - span / 2
  return new Map(
    [...new Set(notes.map((note) => note.pitch))]
      .map((pitch) => [pitch, 1 - (pitch - lo) / span]),
  )
}
