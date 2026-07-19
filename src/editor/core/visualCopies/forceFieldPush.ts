import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'

export const FORCE_FIELD_OUTWARD_PITCH = 60
export const FORCE_FIELD_INWARD_PITCH = 61

export interface ForceFieldPushSettings {
  centerX: number
  centerY: number
  centerZ: number
  /** 0 = constant-distance push, 1 = scale the push by distance from center. */
  distanceMode: number
  /** Base push accumulated for each beat a direction note is held. */
  strength: number
  /** Multiplier applied to the center distance in proportional mode. */
  distanceFactor: number
}

/**
 * Signed push accumulated by the two direction rows. Notes integrate only for
 * the portion of their duration reached by `beat`, then retain their completed
 * push. That makes the result deterministic for pause, scrub, and export while
 * still making longer notes push farther. Overlapping directions cancel.
 */
export function evaluateForceFieldPush(
  notes: readonly ResolvedNote[],
  beat: number,
): number {
  let push = 0
  for (const note of notes) {
    const direction = note.pitch === FORCE_FIELD_OUTWARD_PITCH
      ? 1
      : note.pitch === FORCE_FIELD_INWARD_PITCH
        ? -1
        : 0
    if (direction === 0 || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    push += direction * heldBeats * normalizedVelocity(note.velocity)
  }
  return push
}

export const forceFieldPushMover: MoverOrSplitterDefinition<ForceFieldPushSettings> = {
  id: 'forceFieldPush',
  label: 'Force Field Push',
  kind: 'mover',
  params: [
    { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerZ', label: 'Center Z', min: -20, max: 20, step: 0.1, default: 0 },
    {
      key: 'distanceMode',
      label: 'Distance scaling',
      type: 'select',
      options: [
        { value: 1, label: 'Proportional' },
        { value: 0, label: 'Constant' },
      ],
      default: 1,
    },
    { key: 'strength', label: 'Push / beat', min: 0, max: 10, step: 0.05, default: 1 },
    { key: 'distanceFactor', label: 'Distance factor', min: 0, max: 10, step: 0.05, default: 1 },
  ],
  midiRows: () => [
    { pitch: FORCE_FIELD_OUTWARD_PITCH, label: 'Push outward' },
    { pitch: FORCE_FIELD_INWARD_PITCH, label: 'Push inward' },
  ],
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const center = new Vector3(settings.centerX, settings.centerY, settings.centerZ)
    return {
      apply(visualCopy, { beat, placementTransform }) {
        const placedTransform = placementTransform
          ? placementTransform.clone().multiply(visualCopy.transform)
          : visualCopy.transform
        const position = new Vector3().setFromMatrixPosition(placedTransform)
        const radial = position.sub(center)
        const distance = radial.length()
        const signedPush = evaluateForceFieldPush(notes, beat)

        // A copy exactly at the center has no radial direction, and a zero push
        // should preserve its transform bit-for-bit.
        if (distance <= 1e-10 || Math.abs(signedPush) <= 1e-10) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        const distanceScale = settings.distanceMode === 0 ? 1 : distance * settings.distanceFactor
        const offset = radial.normalize().multiplyScalar(signedPush * settings.strength * distanceScale)

        // WORLD composition: desiredPlaced = translation * placement * copy.
        // Conjugating by placement turns that world-space delta back into the
        // VisualCopy space expected by the renderer. With no placement this is
        // simply chain-root composition (translation * copy).
        const translation = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(translation)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : translation.multiply(visualCopy.transform.clone())
        return [{
          transform,
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
