// Production mover-and-splitter definitions, collected for the registry (the
// new-registry analogue of core/visual/movers/library.ts). Each definition owns
// its complete MIDI grammar - the kernel and the chain resolver know nothing
// about pitches or velocities.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'

// ── Burst ────────────────────────────────────────────────────────────────────
// Directional step mover: each note permanently steps the object a fixed
// distance in one cardinal direction, animated by an ease-out "burst" (violent
// start, soft landing). Steps accumulate - repeated +X notes keep walking the
// object right, a -X note steps it back - so position is fully choreographed by
// the note history, and the summed offset stays a closed-form function of the
// beat (the pause invariant: scrub == playback == export).

/** Burst's MIDI vocabulary: one row per cardinal direction. */
export const BURST_DIRECTIONS: Record<number, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  62: { axis: 1, sign: 1 }, // Up (+Y)
  63: { axis: 1, sign: -1 }, // Down (-Y)
  60: { axis: 0, sign: 1 }, // Right (+X)
  61: { axis: 0, sign: -1 }, // Left (-X)
  64: { axis: 2, sign: 1 }, // Forward (+Z)
  65: { axis: 2, sign: -1 }, // Back (-Z)
}

const BURST_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up (+Y)' },
  { pitch: 63, label: 'Down (−Y)' },
  { pitch: 60, label: 'Right (+X)' },
  { pitch: 61, label: 'Left (−X)' },
  { pitch: 64, label: 'Forward (+Z)' },
  { pitch: 65, label: 'Back (−Z)' },
]

export interface BurstSettings {
  /** Beats a burst takes to land on its destination. */
  burstBeats: number
  /** Ease-out family (see BURST_EASINGS order). */
  easing: number
  /** Time-warp exponent: >1 makes the initial jump more violent. */
  sharpness: number
  distanceX: number
  distanceY: number
  distanceZ: number
  /** Overall distance multiplier on top of the per-axis distances. */
  distance: number
}

/** Ease-out curves, indexed by the `easing` select value. All map 0→0, 1→1;
 *  elastic and back deliberately overshoot en route. */
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

/**
 * The summed offset of every burst launched at or before `beat`. Each note
 * contributes `direction * axisDistance * multiplier * velocity * ease(age)`,
 * where the eased progress clamps at 1 once the burst lands - the step is
 * permanent. Pitches outside the vocabulary are ignored.
 */
export function evaluateBurstOffset(
  notes: ResolvedNote[],
  settings: BurstSettings,
  beat: number,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const beats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  const axisDistance = [settings.distanceX, settings.distanceY, settings.distanceZ]
  for (const note of notes) {
    if (note.beat > beat) continue
    const dir = BURST_DIRECTIONS[note.pitch]
    if (!dir) continue
    const progress = Math.min(1, (beat - note.beat) / beats)
    const eased = ease(Math.pow(progress, 1 / sharpness))
    const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
    out[dir.axis] += dir.sign * axisDistance[dir.axis] * settings.distance * velocity * eased
  }
  return out
}

export const burstMover: MoverOrSplitterDefinition<BurstSettings> = {
  id: 'burst',
  label: 'Burst',
  kind: 'mover',
  params: [
    { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
    {
      key: 'easing',
      label: 'Easing',
      type: 'select',
      options: BURST_EASINGS.map((e, value) => ({ value, label: e.label })),
      default: 0,
    },
    { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
    { key: 'distanceX', label: 'Distance X', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceY', label: 'Distance Y', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceZ', label: 'Distance Z', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distance', label: 'Distance ×', min: 0, max: 10, step: 0.1, default: 1 },
  ],
  midiRows: () => BURST_ROWS,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        const [x, y, z] = evaluateBurstOffset(notes, settings, beat)
        // LOCAL composition (previous * delta): the burst translates in the
        // reference frame established by the entries above it, so a splitter
        // above this mover re-frames each copy's directions (a Radial above a
        // Burst blooms every copy outward along its own axes).
        const next: VisualCopy = {
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(x, y, z)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    }
  },
}

// ── Radial ───────────────────────────────────────────────────────────────────
// Radial splitter: N structural copies, copy i rotated by i/N of a full turn
// about the chosen plane's normal. The rotation composes LOCALLY (previous *
// delta), so it changes each copy's REFERENCE FRAME: movers BELOW it operate
// in their copy's rotated axes - one Burst +X note blooms every copy outward
// in its own direction. Movers above it are unaffected by the split frames
// (each copy inherits their motion, then rotates in place).
// Slot count comes only from settings, never from MIDI, so downstream indices
// and the React occurrence list stay stable; notes are ignored.

export interface RadialSettings {
  copies: number
  /** 0 = XY (about Z), 1 = XZ (about Y), 2 = YZ (about X). */
  plane: number
}

const RADIAL_MAX_COPIES = 32
const RADIAL_AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]

export const radialSplitter: MoverOrSplitterDefinition<RadialSettings> = {
  id: 'radial',
  label: 'Radial',
  kind: 'splitter',
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: RADIAL_MAX_COPIES, step: 1, default: 6 },
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
      ],
      default: 0,
    },
  ],
  resolve({ settings }) {
    const count = Math.max(1, Math.min(RADIAL_MAX_COPIES, Math.round(settings.copies)))
    const axis = RADIAL_AXES[settings.plane] ?? RADIAL_AXES[0]
    // Structural slot rotations, in slot order (slot 0 is unrotated).
    const rotations = Array.from({ length: count }, (_, slot) =>
      new Matrix4().makeRotationAxis(axis, (slot / count) * Math.PI * 2),
    )
    return {
      apply(visualCopy) {
        return rotations.map((rotation) => ({
          transform: visualCopy.transform.clone().multiply(rotation),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

// ── Grid ────────────────────────────────────────────────────────────────────

export interface GridSettings {
  rows: number
  columns: number
  /** 0 = XY, 1 = XZ, 2 = YZ. */
  plane: number
  /** 0 = English, 1 = reverse English, 2 = columns first, 3 = reverse columns. */
  indexing: number
}

const GRID_MAX_DIMENSION = 32
const GRID_PLANES: [0 | 1 | 2, 0 | 1 | 2][] = [
  [0, 1],
  [0, 2],
  [1, 2],
]

/** Cell coordinates in the exact order downstream movers will see them. */
export function gridCellOrder(rows: number, columns: number, indexing: number): [number, number][] {
  const cells: [number, number][] = []
  if (indexing === 2 || indexing === 3) {
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) cells.push([row, column])
    }
  } else {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) cells.push([row, column])
    }
  }
  return indexing === 1 || indexing === 3 ? cells.reverse() : cells
}

export const gridSplitter: MoverOrSplitterDefinition<GridSettings> = {
  id: 'grid',
  label: 'Grid',
  kind: 'splitter',
  params: [
    { key: 'rows', label: 'Rows', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    { key: 'columns', label: 'Columns', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    {
      key: 'plane',
      label: 'Axes',
      type: 'select',
      options: [
        { value: 0, label: 'X / Y' },
        { value: 1, label: 'X / Z' },
        { value: 2, label: 'Y / Z' },
      ],
      default: 0,
    },
    {
      key: 'indexing',
      label: 'Indexing',
      type: 'select',
      options: [
        { value: 0, label: 'English reading order' },
        { value: 1, label: 'English, reversed' },
        { value: 2, label: 'Columns first' },
        { value: 3, label: 'Columns first, reversed' },
      ],
      default: 0,
    },
  ],
  resolve({ settings }) {
    const rows = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.rows)))
    const columns = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.columns)))
    const [horizontalAxis, verticalAxis] = GRID_PLANES[settings.plane] ?? GRID_PLANES[0]
    const cells = gridCellOrder(rows, columns, settings.indexing).map(([row, column]) => {
      const position: [number, number, number] = [0, 0, 0]
      const scale: [number, number, number] = [1, 1, 1]
      position[horizontalAxis] = (column + 0.5) / columns - 0.5
      position[verticalAxis] = 0.5 - (row + 0.5) / rows
      scale[horizontalAxis] = 1 / columns
      scale[verticalAxis] = 1 / rows
      return new Matrix4()
        .makeTranslation(position[0], position[1], position[2])
        .multiply(new Matrix4().makeScale(scale[0], scale[1], scale[2]))
    })
    return {
      apply(visualCopy) {
        return cells.map((cell) => ({
          transform: visualCopy.transform.clone().multiply(cell),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

// ── Visibility ───────────────────────────────────────────────────────────────────

export interface VisibilitySettings {
  /** 0 = one note per index; other values are each group's percentage width. */
  grouping: number
  attackBeats: number
  decayBeats: number
  sustainLevel: number
  releaseBeats: number
}

const VISIBILITY_TOP_PITCH = 127
const VISIBILITY_GROUPING_OPTIONS = [
  { value: 0, label: 'Each index' },
  { value: 10, label: '10% groups' },
  { value: 20, label: '20% groups' },
  { value: 25, label: '25% groups' },
  { value: 50, label: '50% groups' },
]

function visibilityGroupCount(grouping: number, priorCount: number): number {
  return grouping > 0 ? Math.min(priorCount, Math.ceil(100 / grouping)) : priorCount
}

function visibilityMidiRows(
  settings: VisibilitySettings,
  context: { priorCount: number } = { priorCount: 1 },
): MidiRowDef[] {
  const priorCount = Math.max(1, Math.min(128, Math.round(context.priorCount)))
  const groupCount = visibilityGroupCount(settings.grouping, priorCount)
  return Array.from({ length: groupCount }, (_, index) => {
    if (settings.grouping <= 0) return { pitch: VISIBILITY_TOP_PITCH - index, label: `Index ${index + 1}` }
    const start = Math.min(100, index * settings.grouping)
    const end = Math.min(100, (index + 1) * settings.grouping)
    return { pitch: VISIBILITY_TOP_PITCH - index, label: `${start}–${end}%` }
  })
}

function noteControlsVisibilityIndex(note: ResolvedNote, index: number, count: number, grouping: number): boolean {
  const noteIndex = VISIBILITY_TOP_PITCH - note.pitch
  if (grouping <= 0) return noteIndex === index
  const groupCount = visibilityGroupCount(grouping, count)
  const groupIndex = Math.min(groupCount - 1, Math.floor((index / Math.max(1, count)) * groupCount))
  return noteIndex === groupIndex
}

/** Closed-form ADSR for one index/group. Velocity is intentionally ignored:
 * a held gate means visible (1), exactly as the mover's MIDI contract states. */
export function evaluateVisibilityOpacity(
  notes: readonly ResolvedNote[],
  beat: number,
  index: number,
  count: number,
  settings: VisibilitySettings,
): number {
  const attack = Math.max(0, settings.attackBeats)
  const decay = Math.max(0, settings.decayBeats)
  const release = Math.max(0, settings.releaseBeats)
  const sustain = Math.max(0, Math.min(1, settings.sustainLevel))
  const heldValue = (age: number): number => {
    if (attack > 0 && age < attack) return age / attack
    if (decay > 0 && age < attack + decay) return 1 - (1 - sustain) * ((age - attack) / decay)
    return sustain
  }

  let opacity = 0
  for (const note of notes) {
    if (!noteControlsVisibilityIndex(note, index, count, settings.grouping)) continue
    const age = beat - note.beat
    if (age < 0) continue
    const hold = Math.max(note.durationBeats || 0, attack)
    if (age < hold) opacity = Math.max(opacity, heldValue(age))
    else if (release > 0 && age < hold + release) {
      opacity = Math.max(opacity, heldValue(hold) * (1 - (age - hold) / release))
    }
  }
  return Math.max(0, Math.min(1, opacity))
}

export const visibilityMover: MoverOrSplitterDefinition<VisibilitySettings> = {
  id: 'visibility',
  label: 'Visibility',
  kind: 'mover',
  params: [
    {
      key: 'grouping',
      label: 'Note mapping',
      type: 'select',
      options: VISIBILITY_GROUPING_OPTIONS,
      default: 0,
    },
    { key: 'attackBeats', label: 'Attack (beats)', min: 0, max: 8, step: 0.01, default: 0 },
    { key: 'decayBeats', label: 'Decay (beats)', min: 0, max: 8, step: 0.01, default: 0 },
    { key: 'sustainLevel', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'releaseBeats', label: 'Release (beats)', min: 0, max: 8, step: 0.01, default: 0.05 },
  ],
  midiRows: visibilityMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat, index, count }) {
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity * evaluateVisibilityOpacity(notes, beat, index, count, settings),
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}

/** Every production definition, in picker order. Seeded into the registry. */
export const MOVER_OR_SPLITTER_DEFINITIONS: MoverOrSplitterDefinition<any>[] = [
  burstMover,
  visibilityMover,
  radialSplitter,
  gridSplitter,
]
