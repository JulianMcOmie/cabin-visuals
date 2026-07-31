import { Matrix4 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { RADIAL_MOTION_COLOR } from './identityColors'

export interface RadialMotionSettings {
  /** Copies per nesting depth, outermost first. Powers of two nest cleanly. */
  copies0: number
  copies1: number
  copies2: number
  /** Resting ring radius per depth. MIDI scales these, it does not replace them. */
  radius0: number
  radius1: number
  radius2: number
  /** Passive rotation rate per depth, in degrees per beat, one per axis. */
  spinZ0: number
  spinZ1: number
  spinZ2: number
  spinX0: number
  spinX1: number
  spinX2: number
  spinY0: number
  spinY1: number
  spinY2: number
  transitionBeats: number
  curve: number
}

/** Nesting depths: a ring of rings of rings. */
export const RADIAL_MOTION_DEPTHS = 3
/** Panel and MIDI-row wording for each depth, outermost first. */
export const RADIAL_MOTION_DEPTH_LABELS = ['outer', 'middle', 'inner'] as const

const MAX_COPIES_PER_DEPTH = 8
const RADIUS_BASE_PITCH = 36
const SPIN_BASE_PITCH = 60

/**
 * MIDI is a MULTIPLIER on the knobs, never a replacement for them: the panel
 * says what the piece looks like at rest, and a note bends that. With no notes
 * at all the arrangement still sits at its set radii and still turns, which is
 * the whole point of the mover - the choreography is passive, MIDI accents it.
 */
export const RADIAL_MOTION_RADIUS_MULTIPLIERS = [0, 0.5, 1, 2] as const
export const RADIAL_MOTION_SPIN_MULTIPLIERS = [-1, 0, 0.5, 1, 2] as const
/** The multiplier in force before any note, and the row a player returns to. */
const RADIUS_HOME_CHOICE = 2
const SPIN_HOME_CHOICE = 3

/**
 * The spin knobs are STEPPED, like a tempo-synced rate switch on an audio
 * plugin: each detent is one full turn per a power-of-two number of beats, so
 * every rate is a musical division of the tempo rather than an arbitrary
 * degrees figure. The STORED unit stays °/beat — old saves, automation lanes
 * and the MIDI ×0.5/×2/×−1 multipliers all keep working, and halving or
 * doubling a power-of-two division is still a power-of-two division.
 */
export const RADIAL_MOTION_SPIN_BEATS_PER_TURN = [32, 16, 8, 4, 2] as const

/** Every knob position, ascending, zero dead centre: −(fast…slow), 0, slow…fast. */
export const RADIAL_MOTION_SPIN_DETENTS: readonly number[] = (() => {
  const rates = RADIAL_MOTION_SPIN_BEATS_PER_TURN.map((beats) => 360 / beats)
  return [...[...rates].reverse().map((rate) => -rate), 0, ...rates]
})()

/** Nearest detent for a stored rate — how the stepped knob reads a value that
 *  predates quantization (e.g. the old 18°/beat default). */
export function radialMotionSpinDetentIndex(rate: number): number {
  let best = 0
  for (let index = 1; index < RADIAL_MOTION_SPIN_DETENTS.length; index++) {
    if (Math.abs(RADIAL_MOTION_SPIN_DETENTS[index] - rate) < Math.abs(RADIAL_MOTION_SPIN_DETENTS[best] - rate)) {
      best = index
    }
  }
  return best
}

/** A detent's readout: beats per full turn, signed — "16b" is one rotation
 *  every 16 beats, "−8b" the same the other way. Zero is simply "0". */
export function radialMotionSpinDetentLabel(rate: number): string {
  if (rate === 0) return '0'
  return `${rate < 0 ? '−' : ''}${360 / Math.abs(rate)}b`
}

/** Pitch for one of four radius multipliers on one depth. 36-47. */
export function radialMotionRadiusPitch(depth: number, choice: number): number {
  return RADIUS_BASE_PITCH + depth * RADIAL_MOTION_RADIUS_MULTIPLIERS.length + choice
}

/** Pitch for one of five spin multipliers on one depth. 60-74. */
export function radialMotionSpinPitch(depth: number, choice: number): number {
  return SPIN_BASE_PITCH + depth * RADIAL_MOTION_SPIN_MULTIPLIERS.length + choice
}

function clampDepth(depth: number): number {
  return Math.max(0, Math.min(RADIAL_MOTION_DEPTHS - 1, Math.round(depth)))
}

/** Per-depth settings live as flat numbered keys so automation and the generic
 *  param list keep working; these read them back as a depth-indexed value. */
export function radialMotionCopies(settings: RadialMotionSettings, depth: number): number {
  const raw = [settings.copies0, settings.copies1, settings.copies2][clampDepth(depth)]
  return Math.max(1, Math.min(MAX_COPIES_PER_DEPTH, Math.round(raw)))
}

export function radialMotionRadius(settings: RadialMotionSettings, depth: number): number {
  return [settings.radius0, settings.radius1, settings.radius2][clampDepth(depth)]
}

export function radialMotionSpinRates(
  settings: RadialMotionSettings,
  depth: number,
): { x: number; y: number; z: number } {
  const index = clampDepth(depth)
  return {
    x: [settings.spinX0, settings.spinX1, settings.spinX2][index],
    y: [settings.spinY0, settings.spinY1, settings.spinY2][index],
    z: [settings.spinZ0, settings.spinZ1, settings.spinZ2][index],
  }
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

/**
 * Latches one depth's radius MULTIPLIER at note-on. Every onset begins a fresh,
 * continuous exponential move from the value reached at that exact beat, so a
 * retrigger mid-glide never jumps. Before any note the multiplier is 1 - the
 * ring sits exactly where the panel's RADIUS knob put it.
 */
export function evaluateRadialMotionRadiusScale(
  notes: readonly ResolvedNote[],
  settings: RadialMotionSettings,
  beat: number,
  depth = 0,
): number {
  const values = RADIAL_MOTION_RADIUS_MULTIPLIERS
  const pitches = Array.from(
    { length: values.length },
    (_, choice) => radialMotionRadiusPitch(depth, choice),
  )
  const transitionBeats = Math.max(0, settings.transitionBeats)
  let startBeat = 0
  let startValue: number = values[RADIUS_HOME_CHOICE]
  let targetValue: number = values[RADIUS_HOME_CHOICE]

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
 * Integrates one depth's latched spin MULTIPLIER into elapsed "spin beats" -
 * the phase all three axis rates are multiplied by. Integrating the shared
 * multiplier rather than each axis separately is what keeps a tumbling ring
 * coherent: freeze it and every axis freezes together, at the pose it was in.
 *
 * The resting multiplier is 1, so with no notes this returns the beat itself
 * and the whole arrangement turns on its own.
 */
export function evaluateRadialMotionSpinBeats(
  notes: readonly ResolvedNote[],
  beat: number,
  depth = 0,
): number {
  const pitches = Array.from(
    { length: RADIAL_MOTION_SPIN_MULTIPLIERS.length },
    (_, choice) => radialMotionSpinPitch(depth, choice),
  )
  let cursorBeat = 0
  let rate: number = RADIAL_MOTION_SPIN_MULTIPLIERS[SPIN_HOME_CHOICE]
  let spinBeats = 0

  for (const note of orderedNotes(notes)) {
    if (note.beat > beat) break
    const choice = pitches.indexOf(note.pitch)
    if (choice < 0) continue
    spinBeats += Math.max(0, note.beat - cursorBeat) * rate
    cursorBeat = Math.max(cursorBeat, note.beat)
    rate = RADIAL_MOTION_SPIN_MULTIPLIERS[choice]
  }
  spinBeats += Math.max(0, beat - cursorBeat) * rate
  return spinBeats
}

function radialMotionMidiRows(): MidiRowDef[] {
  const rows: MidiRowDef[] = []
  const radiusLabels = ['collapse', 'half', 'home', 'double']
  const spinLabels = ['reverse', 'freeze', 'half', 'home', 'double']

  for (let depth = 0; depth < RADIAL_MOTION_DEPTHS; depth++) {
    const where = RADIAL_MOTION_DEPTH_LABELS[depth]
    for (let choice = RADIAL_MOTION_RADIUS_MULTIPLIERS.length - 1; choice >= 0; choice--) {
      rows.push({
        pitch: radialMotionRadiusPitch(depth, choice),
        label: `${where} radius · ${radiusLabels[choice]}`,
        emphasized: choice === RADIUS_HOME_CHOICE,
      })
    }
  }
  for (let depth = 0; depth < RADIAL_MOTION_DEPTHS; depth++) {
    const where = RADIAL_MOTION_DEPTH_LABELS[depth]
    for (let choice = RADIAL_MOTION_SPIN_MULTIPLIERS.length - 1; choice >= 0; choice--) {
      rows.push({
        pitch: radialMotionSpinPitch(depth, choice),
        label: `${where} spin · ${spinLabels[choice]}`,
        emphasized: choice === SPIN_HOME_CHOICE,
      })
    }
  }
  return rows
}

const RADIANS = Math.PI / 180

/** Z·Y·X, written out rather than left to an Euler order string, because the
 *  order is load-bearing: Z is the ring's own plane and X/Y tip that plane. */
function spinMatrix(degreesX: number, degreesY: number, degreesZ: number): Matrix4 {
  return new Matrix4().makeRotationZ(degreesZ * RADIANS)
    .multiply(new Matrix4().makeRotationY(degreesY * RADIANS))
    .multiply(new Matrix4().makeRotationX(degreesX * RADIANS))
}

/**
 * One nesting depth, resolved for a beat: the matrix for each of its copies,
 * already carrying the depth's live rotation. Each entry is
 * `spin · Rz(seat) · Tx(radius)` - the spin turns the WHOLE ring (and so
 * everything nested below it), the seat angle spaces the copies around it, and
 * the translation pushes each one out to the radius.
 */
function depthMatrices(
  settings: RadialMotionSettings,
  notes: readonly ResolvedNote[],
  beat: number,
  depth: number,
): Matrix4[] {
  const count = radialMotionCopies(settings, depth)
  const radius = radialMotionRadius(settings, depth)
    * evaluateRadialMotionRadiusScale(notes, settings, beat, depth)
  const spinBeats = evaluateRadialMotionSpinBeats(notes, beat, depth)
  const rates = radialMotionSpinRates(settings, depth)
  const spin = spinMatrix(rates.x * spinBeats, rates.y * spinBeats, rates.z * spinBeats)

  return Array.from({ length: count }, (_, index) => spin.clone()
    .multiply(new Matrix4().makeRotationZ((index / count) * 2 * Math.PI))
    .multiply(new Matrix4().makeTranslation(radius, 0, 0)))
}

/**
 * A ring of rings of rings on any shape: three nested radial depths that all
 * turn on their own, with MIDI as an accent rather than as the motor.
 *
 * Composition is LOCAL (`previous * delta`), and so is the nesting itself: each
 * depth's matrix re-frames the depth below it, which is exactly what makes an
 * inner ring orbit its own parent seat rather than the world origin.
 *
 * Structural copy count comes only from settings, never MIDI. This definition
 * is intentionally classified as a mover: a user attaches one item to any shape
 * and gets the whole choreography without building splitter subchains.
 */
export const radialMotionMover: MoverOrSplitterDefinition<RadialMotionSettings> = {
  id: 'radialMotion',
  label: 'Radial Motion',
  kind: 'mover',
  identityColor: RADIAL_MOTION_COLOR,
  params: [
    // Powers of two by default: a ring whose seat count divides its parent's
    // lines the copies up into readable arms instead of a uniform haze.
    { key: 'copies0', label: 'Outer copies', min: 1, max: MAX_COPIES_PER_DEPTH, step: 1, default: 8 },
    { key: 'copies1', label: 'Middle copies', min: 1, max: MAX_COPIES_PER_DEPTH, step: 1, default: 4 },
    { key: 'copies2', label: 'Inner copies', min: 1, max: MAX_COPIES_PER_DEPTH, step: 1, default: 2 },
    { key: 'radius0', label: 'Outer radius', min: 0, max: 12, step: 0.05, default: 3.2 },
    { key: 'radius1', label: 'Middle radius', min: 0, max: 12, step: 0.05, default: 1.5 },
    { key: 'radius2', label: 'Inner radius', min: 0, max: 12, step: 0.05, default: 0.65 },
    // Different rates AND different signs per depth: equal rates would make the
    // whole thing read as one rigid object turning, which is the one thing a
    // three-deep nest should never look like. Defaults sit ON spin detents
    // (turns per 16 / 8 / 4 beats), and the step is the detent lattice's own
    // pitch so even the generic fallback slider walks the division grid.
    { key: 'spinZ0', label: 'Outer spin Z (°/beat)', min: -180, max: 180, step: 11.25, default: 22.5 },
    { key: 'spinZ1', label: 'Middle spin Z (°/beat)', min: -180, max: 180, step: 11.25, default: -45 },
    { key: 'spinZ2', label: 'Inner spin Z (°/beat)', min: -180, max: 180, step: 11.25, default: 90 },
    { key: 'spinX0', label: 'Outer spin X (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'spinX1', label: 'Middle spin X (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'spinX2', label: 'Inner spin X (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'spinY0', label: 'Outer spin Y (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'spinY1', label: 'Middle spin Y (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'spinY2', label: 'Inner spin Y (°/beat)', min: -180, max: 180, step: 11.25, default: 0 },
    { key: 'transitionBeats', label: 'Radius glide (beats)', min: 0, max: 8, step: 0.05, default: 0.75 },
    { key: 'curve', label: 'Exponential curve', min: 0, max: 16, step: 0.25, default: 6 },
  ],
  midiRows: radialMotionMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        // Resolved once per frame, not once per copy: the 64 copies at the
        // default counts all read the same 14 depth matrices.
        const depths = Array.from(
          { length: RADIAL_MOTION_DEPTHS },
          (_, depth) => depthMatrices(settings, notes, beat, depth),
        )
        const copies: VisualCopy[] = []
        for (const outer of depths[0]) {
          for (const middle of depths[1]) {
            for (const inner of depths[2]) {
              copies.push({
                transform: visualCopy.transform.clone()
                  .multiply(outer).multiply(middle).multiply(inner),
                opacity: visualCopy.opacity,
                colorShift: { ...visualCopy.colorShift },
              })
            }
          }
        }
        return copies
      },
    }
  },
}
