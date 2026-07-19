import { Matrix4 } from 'three'
import type { ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import {
  BASIS_PARAMS,
  RETURN_PITCH,
  SIGNED_BASIS_DIRECTIONS,
  SIGNED_BASIS_ROWS,
  basisRotation,
  normalizedVelocity,
  pivotedRotation,
  resolveBasis,
  type BasisSettings,
} from './motionBasis'
import type { VisualCopy } from './types'

const DEG_TO_RAD = Math.PI / 180

export const ROTATION_EASINGS: { label: string; ease: (t: number) => number }[] = [
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

export interface RotationBurstSettings extends BasisSettings {
  burstBeats: number
  easing: number
  sharpness: number
  angleX: number
  angleY: number
  angleZ: number
  angle: number
  pivotX: number
  pivotY: number
  pivotZ: number
}

const ROTATION_BURST_PARAMS: ParamDef[] = [
  { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  {
    key: 'easing',
    label: 'Easing',
    type: 'select',
    options: ROTATION_EASINGS.map((easing, value) => ({ value, label: easing.label })),
    default: 0,
  },
  { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
  { key: 'angleX', label: 'Angle X (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleY', label: 'Angle Y (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angleZ', label: 'Angle Z (°)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'angle', label: 'Angle ×', min: 0, max: 10, step: 0.1, default: 1 },
  ...BASIS_PARAMS,
]

const PIVOT_PARAMS: ParamDef[] = [
  { key: 'pivotX', label: 'Pivot X', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotY', label: 'Pivot Y', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'pivotZ', label: 'Pivot Z', min: -20, max: 20, step: 0.1, default: 0 },
]

export function evaluateRotationBurstAngles(
  notes: readonly ResolvedNote[],
  settings: RotationBurstSettings,
  beat: number,
): [number, number, number] {
  const angles: [number, number, number] = [0, 0, 0]
  const burstBeats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const easing = ROTATION_EASINGS[settings.easing] ?? ROTATION_EASINGS[0]
  const axisAngles = [settings.angleX, settings.angleY, settings.angleZ]
  for (const note of notes) {
    if (note.beat > beat) continue
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction) continue
    const progress = Math.min(1, (beat - note.beat) / burstBeats)
    const eased = easing.ease(Math.pow(progress, 1 / sharpness))
    angles[direction.axis] += direction.sign * axisAngles[direction.axis] * settings.angle
      * normalizedVelocity(note.velocity) * eased * DEG_TO_RAD
  }
  return angles
}

function nextCopy(visualCopy: VisualCopy, transform: Matrix4): VisualCopy {
  return {
    transform,
    opacity: visualCopy.opacity,
    colorShift: { ...visualCopy.colorShift },
  }
}

export const rotateBurstMover: MoverOrSplitterDefinition<RotationBurstSettings> = {
  id: 'rotateBurst',
  label: 'Rotate Burst',
  kind: 'mover',
  params: ROTATION_BURST_PARAMS,
  midiRows: () => SIGNED_BASIS_ROWS,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)
    return {
      apply(visualCopy, { beat }) {
        const rotation = basisRotation(basis, evaluateRotationBurstAngles(notes, settings, beat))
        return [nextCopy(visualCopy, visualCopy.transform.clone().multiply(rotation))]
      },
    }
  },
}

export const orbitBurstMover: MoverOrSplitterDefinition<RotationBurstSettings> = {
  id: 'orbitBurst',
  label: 'Orbit Burst',
  kind: 'mover',
  params: [...ROTATION_BURST_PARAMS, ...PIVOT_PARAMS],
  midiRows: () => SIGNED_BASIS_ROWS,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)
    const pivot: [number, number, number] = [settings.pivotX ?? 0, settings.pivotY ?? 0, settings.pivotZ ?? 0]
    return {
      apply(visualCopy, { beat }) {
        const rotation = basisRotation(basis, evaluateRotationBurstAngles(notes, settings, beat))
        const orbit = pivotedRotation(rotation, pivot)
        return [nextCopy(visualCopy, orbit.multiply(visualCopy.transform.clone()))]
      },
    }
  },
}

export interface ConstantRotationSettings extends BasisSettings {
  speedX: number
  speedY: number
  speedZ: number
  speed: number
  returnBeats: number
  pivotX: number
  pivotY: number
  pivotZ: number
}

const CONSTANT_ROTATION_PARAMS: ParamDef[] = [
  { key: 'speedX', label: 'Speed X (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'speedY', label: 'Speed Y (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'speedZ', label: 'Speed Z (°/beat)', min: 0, max: 720, step: 1, default: 90 },
  { key: 'speed', label: 'Speed ×', min: 0, max: 10, step: 0.1, default: 1 },
  { key: 'returnBeats', label: 'Return beats', min: 0.05, max: 16, step: 0.05, default: 1 },
  ...BASIS_PARAMS,
]

const ROTATION_WITH_RETURN_ROWS = [
  ...SIGNED_BASIS_ROWS,
  { pitch: RETURN_PITCH, label: 'Return orientation' },
]

function rawConstantAngles(
  notes: readonly ResolvedNote[],
  settings: ConstantRotationSettings,
  beat: number,
): [number, number, number] {
  const angles: [number, number, number] = [0, 0, 0]
  const speeds = [settings.speedX, settings.speedY, settings.speedZ]
  for (const note of notes) {
    const direction = SIGNED_BASIS_DIRECTIONS[note.pitch]
    if (!direction || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    angles[direction.axis] += direction.sign * heldBeats * speeds[direction.axis] * settings.speed
      * normalizedVelocity(note.velocity) * DEG_TO_RAD
  }
  return angles
}

export function evaluateConstantRotationAngles(
  notes: readonly ResolvedNote[],
  settings: ConstantRotationSettings,
  beat: number,
): [number, number, number] {
  const returnBeats = Math.max(0.0001, settings.returnBeats)
  let erased: [number, number, number] = [0, 0, 0]
  const returns = notes
    .filter((note) => note.pitch === RETURN_PITCH && note.beat <= beat)
    .slice()
    .sort((a, b) => a.beat - b.beat)

  for (const note of returns) {
    const target = rawConstantAngles(notes, settings, note.beat)
    const elapsed = beat - note.beat
    const heldBeats = Math.max(0, note.durationBeats)
    const progress = Math.min(1, Math.min(elapsed, heldBeats) / returnBeats)
    erased = erased.map((value, axis) => {
      const current = target[axis] - value
      const shortest = Math.atan2(Math.sin(current), Math.cos(current))
      return target[axis] - shortest * (1 - progress)
    }) as [number, number, number]
  }

  const raw = rawConstantAngles(notes, settings, beat)
  return raw.map((value, axis) => value - erased[axis]) as [number, number, number]
}

export const constantRotateMover: MoverOrSplitterDefinition<ConstantRotationSettings> = {
  id: 'constantRotate',
  label: 'Constant Rotate',
  kind: 'mover',
  params: CONSTANT_ROTATION_PARAMS,
  midiRows: () => ROTATION_WITH_RETURN_ROWS,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)
    return {
      apply(visualCopy, { beat }) {
        const rotation = basisRotation(basis, evaluateConstantRotationAngles(notes, settings, beat))
        return [nextCopy(visualCopy, visualCopy.transform.clone().multiply(rotation))]
      },
    }
  },
}

export const constantOrbitMover: MoverOrSplitterDefinition<ConstantRotationSettings> = {
  id: 'constantOrbit',
  label: 'Constant Orbit',
  kind: 'mover',
  params: [...CONSTANT_ROTATION_PARAMS, ...PIVOT_PARAMS],
  midiRows: () => ROTATION_WITH_RETURN_ROWS,
  resolve({ settings, notes }) {
    const basis = resolveBasis(settings)
    const pivot: [number, number, number] = [settings.pivotX ?? 0, settings.pivotY ?? 0, settings.pivotZ ?? 0]
    return {
      apply(visualCopy, { beat }) {
        const rotation = basisRotation(basis, evaluateConstantRotationAngles(notes, settings, beat))
        const orbit = pivotedRotation(rotation, pivot)
        return [nextCopy(visualCopy, orbit.multiply(visualCopy.transform.clone()))]
      },
    }
  },
}
