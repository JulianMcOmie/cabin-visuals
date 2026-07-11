import type { MidiRow } from './types'
import { AUTOMATION_PITCH_MIN, AUTOMATION_PITCH_MAX, pitchToValue } from '../../core/trackTypes'

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

// Value lanes encode a param value in each note's PITCH via pitchToValue over the
// fixed AUTOMATION_PITCH_MIN..MAX span (core/trackTypes.ts). That mapping is FROZEN -
// saved projects hold notes at arbitrary pitches in the span - so the editor may only
// choose WHICH pitches to show as rows, never re-map a pitch to a different value.
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
  formatValue?: (value: number) => string,
): MidiRow[] {
  const rowStep = Math.abs(paramMax - paramMin) / VALUE_ROW_STEPS
  const fmt = formatValue ?? ((v: number) => formatValueCompact(v, rowStep))
  const pitchSpan = AUTOMATION_PITCH_MAX - AUTOMATION_PITCH_MIN
  const rows: MidiRow[] = []
  const known = new Set<number>()

  for (let k = VALUE_ROW_STEPS; k >= 0; k--) {
    const pitch = Math.round(AUTOMATION_PITCH_MIN + (k / VALUE_ROW_STEPS) * pitchSpan)
    if (known.has(pitch)) continue // guard: a narrow span could round two samples together
    known.add(pitch)
    const t = pitchSpan > 0 ? (pitch - AUTOMATION_PITCH_MIN) / pitchSpan : 0
    let label = fmt(pitchToValue(pitch, paramMin, paramMax))
    if (k === VALUE_ROW_STEPS) label += ' · max'
    if (k === 0) label += ' · min'
    rows.push({ pitch, label, color: `hsl(${t * 240}, 60%, 50%)` })
  }

  // Orphans keep value labels (not note names): the engine reads them as values,
  // and pitchToValue clamps, so out-of-span pitches truthfully read as min/max.
  const orphans = [...new Set(notePitches)].filter((p) => !known.has(p)).sort((a, b) => b - a)
  for (const pitch of orphans) {
    rows.push({
      pitch,
      label: fmt(pitchToValue(pitch, paramMin, paramMax)),
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
export function generateToggleRows(notePitches: number[]): MidiRow[] {
  const rows: MidiRow[] = [
    { pitch: AUTOMATION_PITCH_MAX, label: 'On', color: 'hsl(145, 60%, 45%)' },
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
