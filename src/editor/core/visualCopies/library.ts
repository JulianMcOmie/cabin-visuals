// Production mover-and-splitter definitions, collected for the registry (the
// new-registry analogue of core/visual/movers/library.ts). Each definition owns
// its complete MIDI grammar - the kernel and the chain resolver know nothing
// about pitches or velocities.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { moverDefinition } from './mover'
import { noteColorizer } from './colorizer'
import { gradientColorizer } from './gradientColorizer'
import { forceFieldPushMover } from './forceFieldPush'
import { meteorImpactMover } from './meteorImpact'
import { impactScatterMover } from './impactScatter'
import { impactPulseMover } from './impactPulse'
import { waveTerrainMover } from './waveTerrain'
import { visibilityMover } from './visibility'
import { freezeMover } from './freeze'
import { consolidatedMover } from './consolidatedMover'
import { BURST_EASINGS } from './burstEasings'
import { BURST_DIRECTIONS, evaluateBurstOffset, type BurstSettings } from './burstOffset'
import { motionMover } from './motion'
import { symmetricMotionMover } from './symmetricMotion'
import { conveyorMover } from './conveyor'
import { radialMotionMover } from './radialMotion'
import { parametricPatternSplitter } from './parametricPattern'
import { polyhedronSplitter } from './polyhedron'
import { symmetrySplitter } from './symmetry'
import { tunnelSplitter } from './tunnel'
import { duplicateTrailSplitter } from './duplicateTrail'
import { approachSplitter } from './approach'
import { noteDisablesSplitterSlot, splitterMidiRows } from './splitterMidi'
import { GRID_COLOR, RADIAL_COLOR } from './identityColors'

// ── Burst (RETIRED) ──────────────────────────────────────────────────────────
// Directional step mover: each note permanently steps the object a fixed
// distance in one cardinal direction, animated by an ease-out "burst" (violent
// start, soft landing). Steps accumulate - repeated +X notes keep walking the
// object right, a -X note steps it back - so position is fully choreographed by
// the note history, and the summed offset stays a closed-form function of the
// beat (the pause invariant: scrub == playback == export).
//
// Retired from the registry (2026-08): the unified `mover` definition's
// translate-burst cell is this exact behaviour, and persistence UPGRADES[12]
// rewrites old saves onto it. The definition object stays exported for the
// parity tests that pin the unified Mover against it.

// The vocabulary and the offset evaluator live in burstOffset.ts so Motion can
// reuse them without importing this library (a cycle); re-exported here because
// the burst tests import them from this module.
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
  identityColor: RADIAL_COLOR,
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
// Three structural dimensions - columns, rows, depth - each INDEPENDENTLY laid
// out as a grid (a run of evenly spaced offsets along its world axis) or as a
// circle (the same count wrapped into a ring about a fixed world axis, with its
// own radius knob). The combinations are the point: one circular dimension is a
// ring, circular columns + linear depth is a tunnel of rings, circular depth +
// linear rows is a standing cylinder, circular columns + circular depth nest
// into a true torus facing the camera - and ANY circular pair collapses to a
// sphere when the outer ring's radius is dialled to 0.
//
// Composition rules (deliberate, and load-bearing for predictability):
// - LINEAR offsets sum in WORLD axes, outside everything circular - the sliders
//   promise "copies along X/Y/Z", so a linear dimension never gets swept into
//   another dimension's rotation (no accidental pinwheels).
// - CIRCULAR steps compose LOCALLY in dimension order (columns, rows, depth):
//   R(axis, index/count · 2π) · T(radius), so an outer ring re-frames the inner
//   one - which is exactly what makes two rings a torus.
// - Rotation axes are fixed per dimension (columns about the plane NORMAL, rows
//   about the HORIZONTAL axis, depth about the VERTICAL axis), so with the
//   default X/Y plane: circular columns face the camera, circular rows are a
//   wheel, circular depth is a floor ring. The ring's radius direction is the
//   dimension's own linear axis, so slot 0 sits unrotated on that axis.
// The rotation lands in each copy's frame (copies face around their ring), the
// same convention as the Radial splitter.
//
// The three counts can multiply past MAX_VISUAL_COPIES (32 x 32 x 2 already
// does); the kernel then truncates in slot order, exactly as it does for
// chained splitters, and the bespoke panel labels the count CAPPED.

export interface GridSettings {
  rows: number
  columns: number
  /** Copy count along the plane normal - the grid's third dimension. */
  depth: number
  /** Distance between adjacent cell centers along every linear dimension. */
  spacing: number
  /** 0 = XY, 1 = XZ, 2 = YZ. */
  plane: number
  /** 0 = English, 1 = reverse English, 2 = columns first, 3 = reverse columns. */
  indexing: number
  /** Per-dimension layout: 0 = grid (linear), 1 = circular. */
  columnsMode: number
  rowsMode: number
  depthMode: number
  /** Ring radius per circular dimension, in world units. */
  columnsRadius: number
  rowsRadius: number
  depthRadius: number
}

const GRID_MAX_DIMENSION = 32
const GRID_PLANES: [0 | 1 | 2, 0 | 1 | 2][] = [
  [0, 1],
  [0, 2],
  [1, 2],
]
const GRID_AXIS_VECTORS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

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

/** [row, column, layer] triples: layers are the OUTERMOST loop (cell 1 is the
 *  front layer's first cell), each layer walks the 2D indexing order, and the
 *  reversed modes reverse the whole sequence - so depth 1 reproduces
 *  gridCellOrder exactly and existing projects keep their note mapping. */
export function gridCellOrder3(
  rows: number,
  columns: number,
  depth: number,
  indexing: number,
): [number, number, number][] {
  const forwardIndexing = indexing === 2 || indexing === 3 ? 2 : 0
  const planeOrder = gridCellOrder(rows, columns, forwardIndexing)
  const cells: [number, number, number][] = []
  for (let layer = 0; layer < depth; layer++) {
    for (const [row, column] of planeOrder) cells.push([row, column, layer])
  }
  return indexing === 1 || indexing === 3 ? cells.reverse() : cells
}

export const gridSplitter: MoverOrSplitterDefinition<GridSettings> = {
  id: 'grid',
  label: 'Grid',
  kind: 'splitter',
  identityColor: GRID_COLOR,
  params: [
    { key: 'rows', label: 'Rows', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    { key: 'columns', label: 'Columns', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    { key: 'depth', label: 'Depth', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 1 },
    { key: 'spacing', label: 'Spacing', min: 0, max: 4, step: 0.1, default: 1 },
    {
      key: 'columnsMode',
      label: 'Columns layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    {
      key: 'rowsMode',
      label: 'Rows layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    {
      key: 'depthMode',
      label: 'Depth layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    { key: 'columnsRadius', label: 'Columns radius', min: 0, max: 10, step: 0.1, default: 2, showIf: 'columnsMode=1' },
    { key: 'rowsRadius', label: 'Rows radius', min: 0, max: 10, step: 0.1, default: 2, showIf: 'rowsMode=1' },
    { key: 'depthRadius', label: 'Depth radius', min: 0, max: 10, step: 0.1, default: 2, showIf: 'depthMode=1' },
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
    const depth = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.depth ?? 1)))
    return splitterMidiRows(rows * columns * depth, 'cell', 'cells')
  },
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const rows = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.rows)))
    const columns = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.columns)))
    const depth = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.depth ?? 1)))
    const [horizontalAxis, verticalAxis] = GRID_PLANES[settings.plane] ?? GRID_PLANES[0]
    const normalAxis = (3 - horizontalAxis - verticalAxis) as 0 | 1 | 2
    // One record per dimension, in composition order. `offset` keeps the exact
    // legacy centering (rows grow downward from the top, layer 0 is the front).
    const dimensions = [
      {
        count: columns,
        circular: settings.columnsMode === 1,
        radius: Math.max(0, settings.columnsRadius ?? 0),
        offsetAxis: horizontalAxis,
        rotationAxis: normalAxis,
        offset: (index: number) => (index - (columns - 1) / 2) * settings.spacing,
      },
      {
        count: rows,
        circular: settings.rowsMode === 1,
        radius: Math.max(0, settings.rowsRadius ?? 0),
        offsetAxis: verticalAxis,
        rotationAxis: horizontalAxis,
        offset: (index: number) => ((rows - 1) / 2 - index) * settings.spacing,
      },
      {
        count: depth,
        circular: settings.depthMode === 1,
        radius: Math.max(0, settings.depthRadius ?? 0),
        offsetAxis: normalAxis,
        rotationAxis: verticalAxis,
        offset: (index: number) => ((depth - 1) / 2 - index) * settings.spacing,
      },
    ]
    const cells = gridCellOrder3(rows, columns, depth, settings.indexing).map(([row, column, layer]) => {
      const indices = [column, row, layer]
      // Grid is a layout, not a fit-to-frame operation: adding rows/columns
      // expands the occupied area while every copy retains the incoming size.
      // Linear offsets sum in world axes, outside the circular steps.
      const translation = new Vector3()
      for (let d = 0; d < 3; d++) {
        const dim = dimensions[d]
        if (!dim.circular) translation.addScaledVector(GRID_AXIS_VECTORS[dim.offsetAxis], dim.offset(indices[d]))
      }
      const cell = new Matrix4().makeTranslation(translation.x, translation.y, translation.z)
      for (let d = 0; d < 3; d++) {
        const dim = dimensions[d]
        if (!dim.circular) continue
        const arm = GRID_AXIS_VECTORS[dim.offsetAxis].clone().multiplyScalar(dim.radius)
        cell
          .multiply(new Matrix4().makeRotationAxis(GRID_AXIS_VECTORS[dim.rotationAxis], (indices[d] / dim.count) * Math.PI * 2))
          .multiply(new Matrix4().makeTranslation(arm.x, arm.y, arm.z))
      }
      return cell
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

/** Every production definition, in picker order. Seeded into the registry.
 *
 *  The six single-behavior motion movers (`burst`, `rotateBurst`,
 *  `orbitBurst`, `constantRotate`, `constantOrbit`, `translationOscillator`)
 *  were retired in 2026-08: the unified `mover` covers their whole
 *  (translate | rotate | orbit) x (burst | constant | oscillate) matrix, and
 *  persistence UPGRADES[12] rewrites old saves onto it, so their ids never
 *  reach the registry any more. Their definition objects remain exported for
 *  All Movers' banks and the parity tests. */
export const MOVER_OR_SPLITTER_DEFINITIONS: MoverOrSplitterDefinition<any>[] = [
  moverDefinition,
  consolidatedMover,
  motionMover,
  conveyorMover,
  radialMotionMover,
  meteorImpactMover,
  impactScatterMover,
  impactPulseMover,
  symmetricMotionMover,
  forceFieldPushMover,
  waveTerrainMover,
  visibilityMover,
  freezeMover,
  noteColorizer,
  gradientColorizer,
  radialSplitter,
  symmetrySplitter,
  gridSplitter,
  polyhedronSplitter,
  parametricPatternSplitter,
  tunnelSplitter,
  duplicateTrailSplitter,
  approachSplitter,
]
