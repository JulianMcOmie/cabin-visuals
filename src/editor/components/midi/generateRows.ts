import type { MidiRow } from './types'
import { AUTOMATION_PITCH_MIN, AUTOMATION_PITCH_MAX, automationTopPitch, pitchToValue, pitchToValueRanged, type AutomationRange } from '../../core/trackTypes'
import { midiNoteBaseColor, midiValueColor } from '../../utils/midiEditorPalette'

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
 * Every row wears the track's note color (one voice per track); label
 * overrides with explicit colors win.
 */
export function generateRows(
  trackColor: string,
  noteRange?: { min: number; max: number },
  labels?: Record<number, MidiRowLabelOverride>,
): MidiRow[] {
  const min = noteRange?.min ?? 24
  const max = noteRange?.max ?? 96
  const baseColor = midiNoteBaseColor(trackColor)
  const rows: MidiRow[] = []

  for (let pitch = max; pitch >= min; pitch--) {
    const octave = Math.floor(pitch / 12) - 1
    const noteIndex = pitch % 12
    const noteLabel = `${NOTE_NAMES[noteIndex]}${octave}`
    const label = labels?.[pitch]
    rows.push({
      pitch,
      label: label?.label ?? noteLabel,
      noteLabel: label ? noteLabel : undefined,
      color: label?.color ?? baseColor,
      // C rows anchor the octave: their labels light up in the track color.
      emphasized: label?.emphasized ?? noteIndex === 0,
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
  trackColor: string,
): MidiRow[] {
  const rows: MidiRow[] = []
  const known = new Set<number>()
  const baseColor = midiNoteBaseColor(trackColor)
  defRows.forEach((r) => {
    known.add(r.pitch)
    rows.push({
      pitch: r.pitch,
      label: r.label,
      // One voice per track: undeclared row colors all wear the track hue;
      // only explicit per-row colors (semantic, e.g. a white flash row) win.
      color: r.color ?? baseColor,
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
 * envelope and ability triggers): a short set of identical rows, all one label and
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
  trackColor: string,
): MidiRow[] {
  const rows: MidiRow[] = []
  const clipBaseColor = midiNoteBaseColor(trackColor)
  const clipPitches = new Set<number>()
  for (let i = clipNames.length - 1; i >= 0; i--) {
    const pitch = baseNote + i
    clipPitches.add(pitch)
    rows.push({
      pitch,
      label: `${i + 1} · ${clipNames[i]}`,
      color: clipBaseColor,
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
 * Rows for a Photo track's photo bank: exactly one row per photo, growing as
 * photos are added - never the full piano roll. The most recently added photo
 * sits at the TOP (rows stack upward, matching pitches ascending upward).
 * Pitches already used by notes that no longer map to a photo (bank
 * reordered/shrunk) get dimmed extra rows so no note can silently vanish.
 * An empty bank shows a single hint row at baseNote. (The still-image sibling
 * of generateVideoClipRows.)
 */
export function generatePhotoRows(
  photoNames: string[],
  baseNote: number,
  notePitches: number[],
  trackColor: string,
): MidiRow[] {
  const rows: MidiRow[] = []
  const photoBaseColor = midiNoteBaseColor(trackColor)
  const photoPitches = new Set<number>()
  for (let i = photoNames.length - 1; i >= 0; i--) {
    const pitch = baseNote + i
    photoPitches.add(pitch)
    rows.push({
      pitch,
      label: `${i + 1} · ${photoNames[i]}`,
      color: photoBaseColor,
      emphasized: i === 0,
    })
  }
  const orphans = [...new Set(notePitches)].filter((p) => !photoPitches.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    const octave = Math.floor(pitch / 12) - 1
    rows.push({
      pitch,
      label: `${NOTE_NAMES[pitch % 12]}${octave} · no photo`,
      color: 'hsl(0, 0%, 45%)',
    })
  }
  if (rows.length === 0) {
    rows.push({ pitch: baseNote, label: 'Add photos in the inspector', color: 'hsl(0, 0%, 45%)' })
  }
  return rows
}

// Value lanes encode a param value in each note's PITCH via pitchToValue over the
// fixed AUTOMATION_PITCH_MIN..MAX span (core/trackTypes.ts). Absent a per-lane
// `automationRange`, that mapping is FROZEN - saved projects hold notes at
// arbitrary pitches in the span - so the editor may only choose WHICH pitches to
// show as rows, never re-map a pitch to a different value. A lane that DOES carry
// a range config remaps by design (the engine reads the identical config through
// pitchToValueRanged, so editor and playback stay one truth).
// 13 evenly-spaced samples keep the lane readable without a wall of unlabeled rows.
const VALUE_ROW_STEPS = 12

/** Compact value label: whole numbers stay whole, decimals trimmed to what the
 *  row step actually needs (e.g. "1", "0.75", "12.5"). */
function formatValueCompact(value: number, rowStep: number): string {
  const decimals = rowStep >= 1 ? 0 : rowStep >= 0.1 ? 1 : rowStep >= 0.01 ? 2 : 3
  return Number(value.toFixed(decimals)).toString()
}

/**
 * Rows for a value lane (instrument-param / effect-param / mover-input automation,
 * mover amount + continuous MIDI): 13 rows sampled evenly across the automation
 * pitch span, EVERY row labelled with the param value that pitch maps to (top row
 * is the max, bottom the min). Notes at in-between pitches remain fully valid to
 * the engine; any pitch outside the sampled set gets a dimmed extra row labelled
 * with its own value so no note can silently vanish from the editor.
 */
export function generateValueRows(
  paramMin: number,
  paramMax: number,
  notePitches: number[],
  trackColor: string,
  formatValue?: (value: number) => string,
  range?: AutomationRange,
): MidiRow[] {
  const valueAt = (pitch: number) => pitchToValueRanged(range, pitch, paramMin, paramMax)
  const topPitch = automationTopPitch(range)
  const pitchSpan = topPitch - AUTOMATION_PITCH_MIN
  const rowStep = range?.integer ? 1 : Math.abs(valueAt(topPitch) - valueAt(AUTOMATION_PITCH_MIN)) / Math.max(1, VALUE_ROW_STEPS)
  const fmt = formatValue ?? ((v: number) => formatValueCompact(v, rowStep))
  const rows: MidiRow[] = []
  const known = new Set<number>()

  // An explicit row COUNT shows every row (that IS the ask); the classic
  // full-span lane keeps its 13 readable samples.
  const steps = range?.rows ? pitchSpan : VALUE_ROW_STEPS
  for (let k = steps; k >= 0; k--) {
    const pitch = Math.round(AUTOMATION_PITCH_MIN + (steps > 0 ? (k / steps) * pitchSpan : 0))
    if (known.has(pitch)) continue // guard: a narrow span could round two samples together
    known.add(pitch)
    const t = pitchSpan > 0 ? (pitch - AUTOMATION_PITCH_MIN) / pitchSpan : 0
    let label = fmt(valueAt(pitch))
    if (k === steps) label += ' · max'
    if (k === 0) label += ' · min'
    // Lightness encodes the value (dim = min, bright = max) so magnitude
    // reads at a glance while the lane keeps its track's hue.
    rows.push({ pitch, label, color: midiValueColor(trackColor, t) })
  }

  // Orphans keep value labels (not note names): the engine reads them as values,
  // and the mapping clamps, so out-of-span pitches truthfully read as min/max.
  const orphans = [...new Set(notePitches)].filter((p) => !known.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    rows.push({
      pitch,
      label: fmt(valueAt(pitch)),
      color: 'hsl(0, 0%, 45%)',
    })
  }
  return rows
}

/**
 * Rows for a boolean (toggle) lane - effect On/Off and boolean params: exactly two
 * rows, On at the top of the automation span and Off at the bottom. The engine reads
 * the same pitch mapping as any value lane (value >= 0.5 of the span means on), so
 * in-between pitches from saved projects appear as dimmed extra rows labelled by
 * which side of the threshold they land on.
 */
export function generateToggleRows(notePitches: number[], trackColor: string): MidiRow[] {
  const rows: MidiRow[] = [
    { pitch: AUTOMATION_PITCH_MAX, label: 'On', color: midiNoteBaseColor(trackColor) },
    { pitch: AUTOMATION_PITCH_MIN, label: 'Off', color: 'hsl(0, 0%, 55%)' },
  ]
  const known = new Set([AUTOMATION_PITCH_MAX, AUTOMATION_PITCH_MIN])
  const orphans = [...new Set(notePitches)].filter((p) => !known.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    const on = pitchToValue(pitch, 0, 1) >= 0.5
    rows.push({ pitch, label: on ? 'On' : 'Off', color: 'hsl(0, 0%, 45%)' })
  }
  return rows
}
