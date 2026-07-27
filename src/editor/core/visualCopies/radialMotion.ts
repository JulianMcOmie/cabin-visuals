import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'

export interface RadialMotionSettings {
  /** Independent source layers. Each gets both radial stages and its own hue. */
  layers: number
  outerCopies: number
  innerCopies: number
  outerRadius0: number
  outerRadius1: number
  outerRadius2: number
  outerRadius3: number
  innerRadius0: number
  innerRadius1: number
  innerRadius2: number
  innerRadius3: number
  transitionBeats: number
  curve: number
  spinDegreesPerBeat: number
  layer1Hue: number
  layer2Hue: number
  layer3Hue: number
  layer1Phase: number
  layer2Phase: number
  layer3Phase: number
  /** 0 = XY (about Z), 1 = XZ (about Y), 2 = YZ (about X). */
  plane: number
}

const MAX_LAYERS = 3
const MAX_COPIES_PER_STAGE = 8
const RADIUS_BASE_PITCH = 36
const SPIN_BASE_PITCH = 60
const RADIUS_CHOICES = 4
const RADIAL_STAGES = 2
const SPIN_TARGETS = 3
const SPIN_CHOICES = 5
const SPIN_MULTIPLIERS = [-1, -0.5, 0, 0.5, 1] as const
// Prevent coplanar color layers from z-fighting without visibly separating
// them. Layer 1 is nearest the default +Z camera and the offsets stay centered.
const LAYER_Z_SPACING = 0.001
const RADIAL_AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]
const RADIAL_DIRECTIONS: [number, number, number][] = [[1, 0, 0], [1, 0, 0], [0, 1, 0]]

/** Pitch for one of four radius choices on one layer and radial stage. */
export function radialMotionRadiusPitch(layer: number, stage: number, choice: number): number {
  return RADIUS_BASE_PITCH + layer * RADIAL_STAGES * RADIUS_CHOICES + stage * RADIUS_CHOICES + choice
}

/** Pitch for signed spin of the source shape, outer stage, or inner stage. */
export function radialMotionSpinPitch(layer: number, target: number, choice: number): number {
  return SPIN_BASE_PITCH + layer * SPIN_TARGETS * SPIN_CHOICES + target * SPIN_CHOICES + choice
}

function orderedNotes(notes: readonly ResolvedNote[]): ResolvedNote[] {
  // Chords are deterministic: the higher option wins when choices start
  // together. Stable sorting retains project order for duplicate pitches.
  return [...notes].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
}

function exponentialEase(t: number, curve: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const k = Math.max(0, curve)
  if (k < 0.0001) return t
  const tail = Math.exp(-k)
  return 1 - (Math.exp(-k * t) - tail) / (1 - tail)
}

function radiusValues(settings: RadialMotionSettings, stage: number): number[] {
  return stage === 0
    ? [settings.outerRadius0, settings.outerRadius1, settings.outerRadius2, settings.outerRadius3]
    : [settings.innerRadius0, settings.innerRadius1, settings.innerRadius2, settings.innerRadius3]
}

/**
 * Latches a layer/stage radius option at note-on. Every onset begins a fresh,
 * continuous exponential move from the value reached at that exact beat.
 */
export function evaluateRadialMotionRadius(
  notes: readonly ResolvedNote[],
  settings: RadialMotionSettings,
  beat: number,
  layer = 0,
  stage = 0,
): number {
  const values = radiusValues(settings, stage)
  const pitches = Array.from(
    { length: RADIUS_CHOICES },
    (_, choice) => radialMotionRadiusPitch(layer, stage, choice),
  )
  const transitionBeats = Math.max(0, settings.transitionBeats)
  let startBeat = 0
  let startValue = values[0]
  let targetValue = values[0]

  const valueAt = (sampleBeat: number): number => {
    if (transitionBeats === 0) return targetValue
    const progress = (sampleBeat - startBeat) / transitionBeats
    return startValue + (targetValue - startValue) * exponentialEase(progress, settings.curve)
  }

  for (const note of orderedNotes(notes)) {
    if (note.beat > beat) break
    const choice = pitches.indexOf(note.pitch)
    if (choice < 0) continue
    const currentValue = valueAt(note.beat)
    startBeat = note.beat
    startValue = currentValue
    targetValue = values[choice]
  }
  return valueAt(beat)
}

/**
 * Integrates one layer/target's latched signed spin rate. Direction or speed
 * changes preserve phase, so the pattern never jumps at a spin note-on.
 */
export function evaluateRadialMotionDegrees(
  notes: readonly ResolvedNote[],
  settings: RadialMotionSettings,
  beat: number,
  layer = 0,
  target = 0,
): number {
  const pitches = Array.from(
    { length: SPIN_CHOICES },
    (_, choice) => radialMotionSpinPitch(layer, target, choice),
  )
  let cursorBeat = 0
  let rate = 0
  let degrees = 0

  for (const note of orderedNotes(notes)) {
    if (note.beat > beat) break
    const choice = pitches.indexOf(note.pitch)
    if (choice < 0) continue
    degrees += Math.max(0, note.beat - cursorBeat) * rate * settings.spinDegreesPerBeat
    cursorBeat = Math.max(cursorBeat, note.beat)
    rate = SPIN_MULTIPLIERS[choice]
  }
  degrees += Math.max(0, beat - cursorBeat) * rate * settings.spinDegreesPerBeat
  return degrees
}

function radialMotionMidiRows(settings: RadialMotionSettings): MidiRowDef[] {
  const layers = Math.max(1, Math.min(MAX_LAYERS, Math.round(settings.layers)))
  const rows: MidiRowDef[] = []
  const radiusLabels = ['zero', 'near', 'middle', 'far']
  const targetLabels = ['shape', 'outer stage', 'inner stage']
  const spinLabels = ['reverse full', 'reverse half', 'hold', 'forward half', 'forward full']

  for (let layer = 0; layer < layers; layer++) {
    for (let stage = 0; stage < RADIAL_STAGES; stage++) {
      for (let choice = RADIUS_CHOICES - 1; choice >= 0; choice--) {
        rows.push({
          pitch: radialMotionRadiusPitch(layer, stage, choice),
          label: `Layer ${layer + 1} · ${stage === 0 ? 'outer' : 'inner'} radius · ${radiusLabels[choice]}`,
          emphasized: choice === 0,
        })
      }
    }
    for (let target = 0; target < SPIN_TARGETS; target++) {
      for (let choice = SPIN_CHOICES - 1; choice >= 0; choice--) {
        rows.push({
          pitch: radialMotionSpinPitch(layer, target, choice),
          label: `Layer ${layer + 1} · ${targetLabels[target]} spin · ${spinLabels[choice]}`,
          emphasized: choice === 2,
        })
      }
    }
  }
  return rows
}

function rotation(axis: Vector3, degrees: number): Matrix4 {
  return new Matrix4().makeRotationAxis(axis, degrees * Math.PI / 180)
}

function translation(direction: [number, number, number], radius: number): Matrix4 {
  return new Matrix4().makeTranslation(
    direction[0] * radius,
    direction[1] * radius,
    direction[2] * radius,
  )
}

/**
 * One self-contained, shape-agnostic mover that emits up to three independently
 * colored source layers, each with two nested radial stages. MIDI owns all six
 * radii (four latched choices apiece) plus source/outer/inner spin per layer.
 *
 * Structural copy count comes only from settings, never MIDI. This definition
 * is intentionally classified as a mover: a user attaches one item to any
 * shape and gets the whole choreography without building splitter subchains.
 */
export const radialMotionMover: MoverOrSplitterDefinition<RadialMotionSettings> = {
  id: 'radialMotion',
  label: 'Radial Motion',
  kind: 'mover',
  params: [
    {
      key: 'layers',
      label: 'Color layers',
      type: 'select',
      options: [
        { value: 1, label: '1 layer' },
        { value: 2, label: '2 layers' },
        { value: 3, label: '3 layers' },
      ],
      default: 3,
    },
    { key: 'outerCopies', label: 'Outer copies', min: 1, max: MAX_COPIES_PER_STAGE, step: 1, default: 5 },
    { key: 'innerCopies', label: 'Inner copies', min: 1, max: MAX_COPIES_PER_STAGE, step: 1, default: 3 },
    { key: 'outerRadius0', label: 'Outer radius · zero', min: 0, max: 20, step: 0.1, default: 0 },
    { key: 'outerRadius1', label: 'Outer radius · near', min: 0, max: 20, step: 0.1, default: 1.6 },
    { key: 'outerRadius2', label: 'Outer radius · middle', min: 0, max: 20, step: 0.1, default: 3.1 },
    { key: 'outerRadius3', label: 'Outer radius · far', min: 0, max: 20, step: 0.1, default: 4.8 },
    { key: 'innerRadius0', label: 'Inner radius · zero', min: 0, max: 20, step: 0.1, default: 0 },
    { key: 'innerRadius1', label: 'Inner radius · near', min: 0, max: 20, step: 0.1, default: 0.8 },
    { key: 'innerRadius2', label: 'Inner radius · middle', min: 0, max: 20, step: 0.1, default: 1.7 },
    { key: 'innerRadius3', label: 'Inner radius · far', min: 0, max: 20, step: 0.1, default: 2.7 },
    { key: 'transitionBeats', label: 'Radius glide (beats)', min: 0, max: 8, step: 0.05, default: 0.75 },
    { key: 'curve', label: 'Exponential curve', min: 0, max: 16, step: 0.25, default: 6 },
    { key: 'spinDegreesPerBeat', label: 'Full spin (°/beat)', min: 0, max: 360, step: 1, default: 45 },
    { key: 'layer1Hue', label: 'Layer 1 hue offset', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'layer2Hue', label: 'Layer 2 hue offset', min: -1, max: 1, step: 0.01, default: 0.33 },
    { key: 'layer3Hue', label: 'Layer 3 hue offset', min: -1, max: 1, step: 0.01, default: 0.67 },
    { key: 'layer1Phase', label: 'Layer 1 phase', min: -180, max: 180, step: 1, default: 0 },
    { key: 'layer2Phase', label: 'Layer 2 phase', min: -180, max: 180, step: 1, default: 24 },
    { key: 'layer3Phase', label: 'Layer 3 phase', min: -180, max: 180, step: 1, default: 48 },
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
  midiRows: radialMotionMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const layerCount = Math.max(1, Math.min(MAX_LAYERS, Math.round(settings.layers)))
    const outerCount = Math.max(1, Math.min(MAX_COPIES_PER_STAGE, Math.round(settings.outerCopies)))
    const innerCount = Math.max(1, Math.min(MAX_COPIES_PER_STAGE, Math.round(settings.innerCopies)))
    const plane = settings.plane === 1 || settings.plane === 2 ? settings.plane : 0
    const axis = RADIAL_AXES[plane]
    const direction = RADIAL_DIRECTIONS[plane]
    const hues = [settings.layer1Hue, settings.layer2Hue, settings.layer3Hue]
    const phases = [settings.layer1Phase, settings.layer2Phase, settings.layer3Phase]

    return {
      apply(visualCopy, { beat }) {
        const copies: VisualCopy[] = []
        for (let layer = 0; layer < layerCount; layer++) {
          const layerZ = ((layerCount - 1) / 2 - layer) * LAYER_Z_SPACING
          const outerRadius = evaluateRadialMotionRadius(notes, settings, beat, layer, 0)
          const innerRadius = evaluateRadialMotionRadius(notes, settings, beat, layer, 1)
          const shapeSpin = evaluateRadialMotionDegrees(notes, settings, beat, layer, 0)
          const outerSpin = evaluateRadialMotionDegrees(notes, settings, beat, layer, 1)
          const innerSpin = evaluateRadialMotionDegrees(notes, settings, beat, layer, 2)

          for (let outer = 0; outer < outerCount; outer++) {
            const outerAngle = phases[layer] + outerSpin + (outer / outerCount) * 360
            for (let inner = 0; inner < innerCount; inner++) {
              const innerAngle = innerSpin + (inner / innerCount) * 360
              const transform = new Matrix4().makeTranslation(0, 0, layerZ)
                .multiply(rotation(axis, outerAngle))
                .multiply(translation(direction, outerRadius))
                .multiply(rotation(axis, innerAngle))
                .multiply(translation(direction, innerRadius))
                // Rightmost: rotates the source geometry around its own center
                // without moving either radial stage's copy positions.
                .multiply(rotation(axis, shapeSpin))
              copies.push({
                transform: visualCopy.transform.clone().multiply(transform),
                opacity: visualCopy.opacity,
                colorShift: {
                  ...visualCopy.colorShift,
                  hue: visualCopy.colorShift.hue + hues[layer],
                },
              })
            }
          }
        }
        return copies
      },
    }
  },
}
