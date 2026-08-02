// Mover: THE motion mover - one definition covering the whole 3x3 matrix of
// (translate | rotate | orbit) x (burst | constant | oscillate), chosen by two
// select params instead of six sibling definitions. It replaces `burst`,
// `rotateBurst`, `orbitBurst`, `constantRotate`, `constantOrbit` and
// `translationOscillator`, whose ids were retired from the registry by
// persistence UPGRADES[12] (their definition objects survive as All Movers
// bank modules). Three cells are NEW here: translate-constant (Motion's Drift
// semantics), rotate-oscillate and orbit-oscillate.
//
// Why one definition: every one of the six spoke the SAME seven-pitch
// vocabulary (60-65 signed axes + 66 Return), so a track never needs more than
// those rows - the mode picks what they mean, and switching modes keeps every
// written note meaningful. The maths is deliberately delegated to the shipped
// evaluators (burstOffset, motion's drift/snap, rotationMovers' constant spin)
// so each cell behaves EXACTLY like the mover it replaces, not merely
// similarly - mover.test.ts pins that parity cell by cell.
//
// MIDI grammar, shared by every cell (all velocity-scaled):
//   burst      - each note fires an eased excursion of the per-axis amount;
//                step-family easings land and STAY (position/orientation is
//                choreographed by the note history), return-family easings
//                come home like an ADSR. Note duration is ignored.
//   constant   - held notes move at the per-axis amount PER BEAT for as long
//                as they last, and the travel is kept on release. Rotate and
//                orbit ALSO run an always-on baseline spin with an empty lane
//                (exactly Constant Rotate/Orbit's claim); translate does not -
//                a positional baseline diverges (there is no period to come
//                back through), so translate-constant is note-gated only, the
//                same call Motion's Drift block made. Return (66) eases the
//                note-driven travel home over Return beats while held.
//   oscillate  - held notes swing 0 -> amount -> 0 at Cycles/beat for as long
//                as they last (one-sided on purpose: + and - rows stay
//                distinct). Return damps every active axis home.
//
// COMPOSITION: translate and rotate are LOCAL (previous * delta) - a splitter
// above re-frames each copy's axes, so one +X note blooms a radial formation
// outward. Orbit PRE-multiplies (delta * previous): the pivot is a fixed point
// in the frame the chain hands this mover, so copies genuinely circle it
// instead of turning in place. Same conventions as the six it replaces.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { BURST_EASINGS } from './burstEasings'
import { evaluateBurstOffset } from './burstOffset'
import { evaluateDriftOffset, evaluateSnapAngles } from './motion'
import { evaluateConstantRotationAngles } from './rotationMovers'
import {
  BASIS_PARAMS,
  RETURN_PITCH,
  SIGNED_BASIS_DIRECTIONS,
  basisRotation,
  normalizedVelocity,
  pivotedRotation,
  resolveBasis,
  type BasisSettings,
} from './motionBasis'
import { MOVER_COLOR } from './identityColors'

const DEG_TO_RAD = Math.PI / 180

// The two segmented choices. Values are persisted in saved projects: append
// only, never reorder.
export const MOVER_MOTION_TRANSLATE = 0
export const MOVER_MOTION_ROTATE = 1
export const MOVER_MOTION_ORBIT = 2
export const MOVER_MODE_BURST = 0
export const MOVER_MODE_CONSTANT = 1
export const MOVER_MODE_OSCILLATE = 2

export const MOVER_MOTION_LABELS = ['Translate', 'Rotate', 'Orbit'] as const
export const MOVER_MODE_LABELS = ['Burst', 'Constant', 'Oscillate'] as const

export interface MoverSettings extends BasisSettings {
  motion: number
  mode: number
  // Per-axis translate amounts: units per hit (burst), per beat (constant),
  // or of swing (oscillate). `distance` is the overall multiplier.
  distanceX: number
  distanceY: number
  distanceZ: number
  distance: number
  // Per-axis rotate/orbit amounts, in degrees, same per-mode reading.
  angleX: number
  angleY: number
  angleZ: number
  angle: number
  // Burst feel.
  burstBeats: number
  easing: number
  sharpness: number
  // Oscillation rate.
  cyclesPerBeat: number
  // Constant + oscillate: how long the Return row takes to come home.
  returnBeats: number
  // Orbit's fixed point, in the frame above this mover.
  pivotX: number
  pivotY: number
  pivotZ: number
}

const MOVER_PARAMS: ParamDef[] = [
  {
    key: 'motion',
    label: 'Motion',
    type: 'select',
    options: MOVER_MOTION_LABELS.map((label, value) => ({ value, label })),
    default: MOVER_MOTION_TRANSLATE,
  },
  {
    key: 'mode',
    label: 'MIDI mode',
    type: 'select',
    options: MOVER_MODE_LABELS.map((label, value) => ({ value, label })),
    default: MOVER_MODE_BURST,
  },
  { key: 'distanceX', label: 'Distance X', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distanceY', label: 'Distance Y', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distanceZ', label: 'Distance Z', min: 0, max: 20, step: 0.1, default: 1 },
  { key: 'distance', label: 'Distance ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'angleX', label: 'Angle X (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleY', label: 'Angle Y (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleZ', label: 'Angle Z (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angle', label: 'Angle ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  {
    key: 'easing',
    label: 'Easing',
    type: 'select',
    options: BURST_EASINGS.map((easing, value) => ({ value, label: easing.label })),
    default: 0,
  },
  { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
  { key: 'cyclesPerBeat', label: 'Cycles / beat', min: 0.05, max: 16, step: 0.05, default: 1 },
  { key: 'returnBeats', label: 'Return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  { key: 'pivotX', label: 'Pivot X', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotY', label: 'Pivot Y', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotZ', label: 'Pivot Z', min: -20, max: 20, step: 0.1, default: 0 },
  ...BASIS_PARAMS,
]

// One concise row set per motion, on the family's frozen pitches. Translate
// speaks directions, rotate/orbit speak the turn's axis; the Return row only
// exists in the modes that read it (burst's way home is a return-family
// easing, not a note).
const TRANSLATE_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up' },
  { pitch: 63, label: 'Down' },
  { pitch: 60, label: 'Right' },
  { pitch: 61, label: 'Left' },
  { pitch: 64, label: 'Forward' },
  { pitch: 65, label: 'Back' },
]

const ROTATE_ROWS: MidiRowDef[] = [
  { pitch: 62, label: '+Y' },
  { pitch: 63, label: '−Y' },
  { pitch: 60, label: '+X' },
  { pitch: 61, label: '−X' },
  { pitch: 64, label: '+Z' },
  { pitch: 65, label: '−Z' },
]

const RETURN_ROW: MidiRowDef = { pitch: RETURN_PITCH, label: 'Return' }

export function moverMidiRows(settings: MoverSettings): MidiRowDef[] {
  const rows = settings.motion === MOVER_MOTION_TRANSLATE ? TRANSLATE_ROWS : ROTATE_ROWS
  return settings.mode === MOVER_MODE_BURST ? rows : [...rows, RETURN_ROW]
}

/**
 * The oscillate cell's per-axis amounts, shared by translate (units) and
 * rotate/orbit (degrees). Exactly Translation Oscillator's maths: each held
 * signed note swings from 0 to its signed extent and back ((1 − cos)/2, so +
 * and − rows stay distinct instead of both crossing the origin), contributes
 * only while held, and a held Return damps the whole excursion toward home.
 */
export function evaluateOscillationAmounts(
  notes: readonly ResolvedNote[],
  perAxis: readonly [number, number, number],
  multiplier: number,
  cyclesPerBeat: number,
  returnBeats: number,
  beat: number,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (const note of notes) {
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction) continue
    const age = beat - note.beat
    if (age < 0 || age >= Math.max(0, note.durationBeats)) continue
    const phase = age * Math.max(0, cyclesPerBeat) * Math.PI * 2
    const wave = (1 - Math.cos(phase)) / 2
    out[direction.axis] += direction.sign * perAxis[direction.axis] * multiplier
      * normalizedVelocity(note.velocity) * wave
  }

  const beats = Math.max(0.0001, returnBeats)
  let returnProgress = 0
  for (const note of notes) {
    if (note.pitch !== RETURN_PITCH) continue
    const age = beat - note.beat
    if (age < 0 || age >= Math.max(0, note.durationBeats)) continue
    returnProgress = Math.max(returnProgress, Math.min(1, age / beats))
  }
  const damp = 1 - returnProgress
  return [out[0] * damp, out[1] * damp, out[2] * damp]
}

/** Translate amounts along the basis axes at `beat`, per the active mode. */
export function evaluateMoverTranslation(
  notes: readonly ResolvedNote[],
  settings: MoverSettings,
  beat: number,
): [number, number, number] {
  if (settings.mode === MOVER_MODE_CONSTANT) {
    return evaluateDriftOffset(notes, {
      driftX: settings.distanceX,
      driftY: settings.distanceY,
      driftZ: settings.distanceZ,
      drift: settings.distance,
      driftReturnBeats: settings.returnBeats,
    }, beat)
  }
  if (settings.mode === MOVER_MODE_OSCILLATE) {
    return evaluateOscillationAmounts(
      notes,
      [settings.distanceX, settings.distanceY, settings.distanceZ],
      settings.distance,
      settings.cyclesPerBeat,
      settings.returnBeats,
      beat,
    )
  }
  return evaluateBurstOffset(notes, settings, beat)
}

/** Rotate/orbit angles (radians, about the basis axes) at `beat`, per mode. */
export function evaluateMoverAngles(
  notes: readonly ResolvedNote[],
  settings: MoverSettings,
  beat: number,
): [number, number, number] {
  if (settings.mode === MOVER_MODE_CONSTANT) {
    return evaluateConstantRotationAngles(notes, {
      speedX: settings.angleX,
      speedY: settings.angleY,
      speedZ: settings.angleZ,
      speed: settings.angle,
      returnBeats: settings.returnBeats,
    }, beat)
  }
  if (settings.mode === MOVER_MODE_OSCILLATE) {
    const degrees = evaluateOscillationAmounts(
      notes,
      [settings.angleX, settings.angleY, settings.angleZ],
      settings.angle,
      settings.cyclesPerBeat,
      settings.returnBeats,
      beat,
    )
    return [degrees[0] * DEG_TO_RAD, degrees[1] * DEG_TO_RAD, degrees[2] * DEG_TO_RAD]
  }
  return evaluateSnapAngles(notes, settings, beat)
}

function nextCopy(visualCopy: VisualCopy, transform: Matrix4): VisualCopy {
  return {
    transform,
    opacity: visualCopy.opacity,
    colorShift: { ...visualCopy.colorShift },
  }
}

export const moverDefinition: MoverOrSplitterDefinition<MoverSettings> = {
  id: 'mover',
  label: 'Mover',
  kind: 'mover',
  identityColor: MOVER_COLOR,
  params: MOVER_PARAMS,
  midiRows: moverMidiRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)

    if (settings.motion !== MOVER_MOTION_ROTATE && settings.motion !== MOVER_MOTION_ORBIT) {
      return {
        apply(visualCopy, { beat }) {
          const amounts = evaluateMoverTranslation(notes, settings, beat)
          const offset = new Vector3()
            .addScaledVector(basis[0], amounts[0])
            .addScaledVector(basis[1], amounts[1])
            .addScaledVector(basis[2], amounts[2])
          return [nextCopy(
            visualCopy,
            visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)),
          )]
        },
      }
    }

    const orbit = settings.motion === MOVER_MOTION_ORBIT
    const pivot: [number, number, number] = [settings.pivotX ?? 0, settings.pivotY ?? 0, settings.pivotZ ?? 0]
    return {
      apply(visualCopy, { beat }) {
        const rotation = basisRotation(basis, evaluateMoverAngles(notes, settings, beat))
        if (!orbit) {
          return [nextCopy(visualCopy, visualCopy.transform.clone().multiply(rotation))]
        }
        return [nextCopy(visualCopy, pivotedRotation(rotation, pivot).multiply(visualCopy.transform.clone()))]
      },
    }
  },
}
