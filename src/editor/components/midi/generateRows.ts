import type { MidiRow, RangeLabel } from './types'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface MidiRowLabelOverride {
  label: string
  color?: string
  emphasized?: boolean
}

/**
 * Generate MidiRow[] for a given pitch range.
 * Higher pitches at the top (descending order).
 * Falls back to C1–C7 (24–96) if no range provided.
 */
export function generateRows(
  noteRange?: { min: number; max: number },
  labels?: Record<number, MidiRowLabelOverride>,
): MidiRow[] {
  const min = noteRange?.min ?? 24
  const max = noteRange?.max ?? 96
  const rows: MidiRow[] = []

  for (let pitch = max; pitch >= min; pitch--) {
    const octave = Math.floor(pitch / 12) - 1
    const noteIndex = pitch % 12
    const noteLabel = `${NOTE_NAMES[noteIndex]}${octave}`
    const hue = (noteIndex / 12) * 360
    const label = labels?.[pitch]
    rows.push({
      pitch,
      label: label?.label ?? noteLabel,
      noteLabel: label ? noteLabel : undefined,
      color: label?.color ?? `hsl(${hue}, 70%, 55%)`,
      emphasized: label?.emphasized,
    })
  }

  return rows
}

/**
 * Rows for an instrument that declares its MIDI vocabulary (def.midiRows):
 * exactly those rows, in the declared order (first = top). Pitches already
 * used by notes that fell out of the vocabulary get dimmed extra rows so no
 * note can silently vanish from the editor.
 */
export function generateInstrumentRows(
  defRows: { pitch: number; label: string; color?: string; emphasized?: boolean }[],
  notePitches: number[],
): MidiRow[] {
  const rows: MidiRow[] = []
  const known = new Set<number>()
  defRows.forEach((r, i) => {
    known.add(r.pitch)
    const hue = (i / Math.max(1, defRows.length)) * 300
    rows.push({
      pitch: r.pitch,
      label: r.label,
      color: r.color ?? `hsl(${hue}, 65%, 55%)`,
      emphasized: r.emphasized,
    })
  })
  const orphans = [...new Set(notePitches)].filter((p) => !known.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    const octave = Math.floor(pitch / 12) - 1
    rows.push({
      pitch,
      label: `${NOTE_NAMES[pitch % 12]}${octave} · unmapped`,
      color: 'hsl(0, 0%, 45%)',
    })
  }
  return rows
}

// Trigger lanes ignore note PITCH (the engine reads only timing + velocity), so
// the editor shows a handful of interchangeable rows: enough vertical room to
// stagger rhythm patterns without a wall of piano keys. The pitches are display
// slots only - any pitch triggers identically.
const TRIGGER_PITCHES = [72, 67, 64, 60]

/**
 * Rows for a trigger/region lane (mover ballistic lanes, envelope gates,
 * suppress/mute modifiers): a short set of identical rows, all one label and
 * colour so they read as interchangeable. Pitches already used by notes outside
 * the slot set get dimmed extra rows (still functional - pitch is ignored) so
 * no note can silently vanish from the editor.
 */
export function generateTriggerRows(
  rowLabel: string,
  color: string,
  notePitches: number[],
): MidiRow[] {
  const known = new Set(TRIGGER_PITCHES)
  const rows: MidiRow[] = TRIGGER_PITCHES.map((pitch) => ({ pitch, label: rowLabel, color }))
  const orphans = [...new Set(notePitches)].filter((p) => !known.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    const octave = Math.floor(pitch / 12) - 1
    rows.push({
      pitch,
      label: `${rowLabel} · ${NOTE_NAMES[pitch % 12]}${octave}`,
      color: 'hsl(0, 0%, 45%)',
    })
  }
  return rows
}

/**
 * Rows for a Video track's pad bank: exactly one row per clip, growing as
 * clips are added — never the full piano roll. The most recently added clip
 * sits at the TOP (rows stack upward, matching pitches ascending upward).
 * Pitches already used by notes that no longer map to a clip (bank
 * reordered/shrunk) get dimmed extra rows so no note can silently vanish.
 * An empty bank shows a single hint row at baseNote.
 */
export function generateVideoClipRows(
  clipNames: string[],
  baseNote: number,
  notePitches: number[],
): MidiRow[] {
  const rows: MidiRow[] = []
  const clipPitches = new Set<number>()
  for (let i = clipNames.length - 1; i >= 0; i--) {
    const pitch = baseNote + i
    clipPitches.add(pitch)
    const hue = (i / Math.max(1, clipNames.length)) * 300
    rows.push({
      pitch,
      label: `${i + 1} · ${clipNames[i]}`,
      color: `hsl(${hue}, 65%, 55%)`,
      emphasized: i === 0,
    })
  }
  const orphans = [...new Set(notePitches)].filter((p) => !clipPitches.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    const octave = Math.floor(pitch / 12) - 1
    rows.push({
      pitch,
      label: `${NOTE_NAMES[pitch % 12]}${octave} · no clip`,
      color: 'hsl(0, 0%, 45%)',
    })
  }
  if (rows.length === 0) {
    rows.push({ pitch: baseNote, label: 'Add clips in the inspector', color: 'hsl(0, 0%, 45%)' })
  }
  return rows
}

/**
 * Generate rows for automation tracks where pitch maps to a parameter value.
 * Shows value labels instead of note names. Only labels a subset of rows.
 */
export function generateAutomationRows(
  noteRange: { min: number; max: number },
  paramMin: number,
  paramMax: number,
  paramLabel: string,
): { rows: MidiRow[]; rangeLabels: RangeLabel[] } {
  const pitchMin = noteRange.min
  const pitchMax = noteRange.max
  const pitchSpan = pitchMax - pitchMin
  const rows: MidiRow[] = []

  const labelCount = Math.min(9, pitchSpan + 1)
  const labelledPitches = new Set<number>()
  for (let i = 0; i < labelCount; i++) {
    labelledPitches.add(Math.round(pitchMin + (i / (labelCount - 1)) * pitchSpan))
  }

  for (let pitch = pitchMax; pitch >= pitchMin; pitch--) {
    const t = pitchSpan > 0 ? (pitch - pitchMin) / pitchSpan : 0
    const value = paramMin + t * (paramMax - paramMin)

    const formatted = value >= 100 ? Math.round(value).toString()
      : value >= 1 ? value.toFixed(1)
      : value.toFixed(3)

    const hue = t * 240
    rows.push({
      pitch,
      label: labelledPitches.has(pitch) ? formatted : '',
      color: `hsl(${hue}, 60%, 50%)`,
    })
  }

  const rangeLabels: RangeLabel[] = [{
    startPitch: pitchMin,
    endPitch: pitchMax,
    label: paramLabel,
  }]

  return { rows, rangeLabels }
}
