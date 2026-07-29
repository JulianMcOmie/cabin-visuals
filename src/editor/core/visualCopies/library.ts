// Production mover-and-splitter definitions, collected for the registry (the
// new-registry analogue of core/visual/movers/library.ts). Each definition owns
// its complete MIDI grammar - the kernel and the chain resolver know nothing
// about pitches or velocities.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import {
  constantOrbitMover,
  constantRotateMover,
  orbitBurstMover,
  rotateBurstMover,
} from './rotationMovers'
import { translationOscillatorMover } from './translationOscillator'
import { calmHueRotateColorizer } from './hueColorizer'
import { forceFieldPushMover } from './forceFieldPush'
import { meteorImpactMover } from './meteorImpact'
import { impactScatterMover } from './impactScatter'
import { waveTerrainMover } from './waveTerrain'
import { visibilityMover } from './visibility'
import { consolidatedMover } from './consolidatedMover'
import { BURST_EASINGS } from './burstEasings'
import { BURST_DIRECTIONS, evaluateBurstOffset, type BurstSettings } from './burstOffset'
import { motionMover } from './motion'
import { radialMotionMover } from './radialMotion'
import { parametricPatternSplitter } from './parametricPattern'
import { polyhedronSplitter } from './polyhedron'
import { tunnelSplitter } from './tunnel'
import { noteDisablesSplitterSlot, splitterMidiRows } from './splitterMidi'

// ── Burst ────────────────────────────────────────────────────────────────────
// Directional step mover: each note permanently steps the object a fixed
// distance in one cardinal direction, animated by an ease-out "burst" (violent
// start, soft landing). Steps accumulate - repeated +X notes keep walking the
// object right, a -X note steps it back - so position is fully choreographed by
// the note history, and the summed offset stays a closed-form function of the
// beat (the pause invariant: scrub == playback == export).

// The vocabulary and the offset evaluator live in burstOffset.ts so Motion can
// reuse them without importing this library (a cycle); re-exported here because
// the Burst UI panel and the burst tests import them from this module.
export { BURST_DIRECTIONS, evaluateBurstOffset, type BurstSettings }

const BURST_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up (+Y)' },
  { pitch: 63, label: 'Down (−Y)' },
  { pitch: 60, label: 'Right (+X)' },
  { pitch: 61, label: 'Left (−X)' },
  { pitch: 64, label: 'Forward (+Z)' },
  { pitch: 65, label: 'Back (−Z)' },
]

export { BURST_EASINGS }

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
  radius: number
  /** 0 = XY (about Z), 1 = XZ (about Y), 2 = YZ (about X). */
  plane: number
}

const RADIAL_MAX_COPIES = 32
const RADIAL_AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]
const RADIAL_DIRECTIONS: [number, number, number][] = [[1, 0, 0], [1, 0, 0], [0, 1, 0]]

export const radialSplitter: MoverOrSplitterDefinition<RadialSettings> = {
  id: 'radial',
  label: 'Radial',
  kind: 'splitter',
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: RADIAL_MAX_COPIES, step: 1, default: 6 },
    { key: 'radius', label: 'Radius', min: 0, max: 10, step: 0.1, default: 0 },
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
  midiRows: (settings) => splitterMidiRows(
    Math.max(1, Math.min(RADIAL_MAX_COPIES, Math.round(settings.copies))),
    'copy',
    'copies',
  ),
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const count = Math.max(1, Math.min(RADIAL_MAX_COPIES, Math.round(settings.copies)))
    const plane = settings.plane === 1 || settings.plane === 2 ? settings.plane : 0
    const axis = RADIAL_AXES[plane]
    const direction = RADIAL_DIRECTIONS[plane]
    // Structural slot transforms, in slot order (slot 0 is unrotated).
    const transforms = Array.from({ length: count }, (_, slot) =>
      new Matrix4()
        .makeRotationAxis(axis, (slot / count) * Math.PI * 2)
        .multiply(new Matrix4().makeTranslation(
          direction[0] * settings.radius,
          direction[1] * settings.radius,
          direction[2] * settings.radius,
        )),
    )
    return {
      apply(visualCopy, { beat }) {
        return transforms.map((transform, slot) => ({
          transform: visualCopy.transform.clone().multiply(transform),
          opacity: noteDisablesSplitterSlot(notes, beat, slot, count) ? 0 : visualCopy.opacity,
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
  /** Distance between adjacent cell centers in the selected plane. */
  spacing: number
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
    { key: 'spacing', label: 'Spacing', min: 0, max: 4, step: 0.1, default: 1 },
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
  midiRows: (settings) => {
    const rows = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.rows)))
    const columns = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.columns)))
    return splitterMidiRows(rows * columns, 'cell', 'cells')
  },
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const rows = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.rows)))
    const columns = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.columns)))
    const [horizontalAxis, verticalAxis] = GRID_PLANES[settings.plane] ?? GRID_PLANES[0]
    const cells = gridCellOrder(rows, columns, settings.indexing).map(([row, column]) => {
      const position: [number, number, number] = [0, 0, 0]
      // Grid is a layout, not a fit-to-frame operation: adding rows/columns
      // expands the occupied area while every copy retains the incoming size.
      position[horizontalAxis] = (column - (columns - 1) / 2) * settings.spacing
      position[verticalAxis] = ((rows - 1) / 2 - row) * settings.spacing
      return new Matrix4().makeTranslation(position[0], position[1], position[2])
    })
    return {
      apply(visualCopy, { beat }) {
        return cells.map((cell, slot) => ({
          transform: visualCopy.transform.clone().multiply(cell),
          opacity: noteDisablesSplitterSlot(notes, beat, slot, cells.length) ? 0 : visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

export { evaluateVisibilityOpacity, visibilityMover, type VisibilitySettings } from './visibility'

/** Every production definition, in picker order. Seeded into the registry. */
export const MOVER_OR_SPLITTER_DEFINITIONS: MoverOrSplitterDefinition<any>[] = [
  consolidatedMover,
  motionMover,
  radialMotionMover,
  meteorImpactMover,
  impactScatterMover,
  burstMover,
  rotateBurstMover,
  orbitBurstMover,
  constantRotateMover,
  constantOrbitMover,
  translationOscillatorMover,
  forceFieldPushMover,
  waveTerrainMover,
  visibilityMover,
  calmHueRotateColorizer,
  radialSplitter,
  gridSplitter,
  polyhedronSplitter,
  parametricPatternSplitter,
  tunnelSplitter,
]
