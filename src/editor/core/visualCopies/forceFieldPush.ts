import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'

export const FORCE_FIELD_OUTWARD_PITCH = 60
export const FORCE_FIELD_INWARD_PITCH = 61
export const FORCE_FIELD_IN_OUT_PITCH = 62
export const FORCE_FIELD_OUT_IN_PITCH = 63
export const FORCE_FIELD_TWIST_PITCH = 64

export interface ForceFieldPushSettings {
  centerX: number
  centerY: number
  centerZ: number
  /** 0 = constant-distance push, 1 = scale the push by distance from center. */
  distanceMode: number
  /** Peak distance of one pulse before distance scaling and velocity. */
  strength: number
  /** Multiplier applied to the center distance in proportional mode. */
  distanceFactor: number
  /** Length of the strike and its fluid return to rest. */
  pulseBeats: number
  /** Look-ahead used by the two anticipation → strike rows. */
  anticipationBeats: number
  /** Opposite-direction peak after an anticipation reaches its extreme. */
  rebound: number
  /** Z rotation per unit of radius at the peak. May be negative. */
  twistDegrees: number
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/** A quick, smooth strike followed by a longer fluid return to rest. */
function pulseEnvelope(age: number, duration: number): number {
  if (age <= 0 || age >= duration) return 0
  const progress = age / duration
  const attackEnd = 0.2
  return progress < attackEnd
    ? smoothstep(progress / attackEnd)
    : 1 - smoothstep((progress - attackEnd) / (1 - attackEnd))
}

/**
 * Signed radial displacement from four discrete note-on gestures:
 *
 *  - outward / inward: a temporary pulse that returns home;
 *  - in→out / out→in: a pre-onset anticipation, then a smaller reverse strike
 *    and fluid return.
 *
 * Every note is evaluated independently and summed, so chords and rapid hits
 * stack without mutable playback state. Note length is intentionally ignored:
 * these are discrete strikes whose timing comes from the mover settings.
 */
export function evaluateForceFieldPulse(
  notes: readonly ResolvedNote[],
  settings: ForceFieldPushSettings,
  beat: number,
): number {
  const duration = Math.max(0.0001, settings.pulseBeats)
  const anticipation = Math.max(0, settings.anticipationBeats)
  const rebound = Math.max(0, settings.rebound)
  let displacement = 0

  for (const note of notes) {
    if (beat < note.blockStartBeat || beat >= note.blockEndBeat) continue
    const velocity = normalizedVelocity(note.velocity)

    if (note.pitch === FORCE_FIELD_OUTWARD_PITCH || note.pitch === FORCE_FIELD_INWARD_PITCH) {
      const direction = note.pitch === FORCE_FIELD_OUTWARD_PITCH ? 1 : -1
      displacement += direction * pulseEnvelope(beat - note.beat, duration) * velocity
      continue
    }

    const anticipationDirection = note.pitch === FORCE_FIELD_IN_OUT_PITCH
      ? -1
      : note.pitch === FORCE_FIELD_OUT_IN_PITCH
        ? 1
        : 0
    if (anticipationDirection === 0) continue

    if (beat < note.beat) {
      const anticipationStart = Math.max(note.blockStartBeat, note.beat - anticipation)
      const availableLead = note.beat - anticipationStart
      if (availableLead > 0 && beat >= anticipationStart) {
        displacement += anticipationDirection
          * smoothstep((beat - anticipationStart) / availableLead)
          * velocity
      }
      continue
    }

    const age = beat - note.beat
    if (age >= duration) continue
    const strikeEnd = duration * 0.2
    const reverseDirection = -anticipationDirection
    const response = age < strikeEnd
      ? anticipationDirection + (reverseDirection * rebound - anticipationDirection)
        * smoothstep(age / strikeEnd)
      : reverseDirection * rebound
        * (1 - smoothstep((age - strikeEnd) / (duration - strikeEnd)))
    displacement += response * velocity
  }
  return displacement
}

/** Temporary twist angle per unit of field radius. Hits stack by note onset. */
export function evaluateForceFieldTwist(
  notes: readonly ResolvedNote[],
  settings: ForceFieldPushSettings,
  beat: number,
): number {
  const duration = Math.max(0.0001, settings.pulseBeats)
  let degrees = 0
  for (const note of notes) {
    if (
      note.pitch !== FORCE_FIELD_TWIST_PITCH
      || beat < note.blockStartBeat
      || beat >= note.blockEndBeat
    ) continue
    degrees += settings.twistDegrees
      * pulseEnvelope(beat - note.beat, duration)
      * normalizedVelocity(note.velocity)
  }
  return degrees
}

export const forceFieldPushMover: MoverOrSplitterDefinition<ForceFieldPushSettings> = {
  id: 'forceFieldPush',
  label: 'Force Field Pulse',
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
    { key: 'strength', label: 'Pulse distance', min: 0, max: 10, step: 0.05, default: 1 },
    { key: 'distanceFactor', label: 'Distance factor', min: 0, max: 10, step: 0.05, default: 1 },
    { key: 'pulseBeats', label: 'Pulse length (beats)', min: 0.05, max: 8, step: 0.05, default: 1 },
    { key: 'anticipationBeats', label: 'Anticipation (beats)', min: 0, max: 8, step: 0.05, default: 0.5 },
    { key: 'rebound', label: 'Reverse strike', min: 0, max: 2, step: 0.05, default: 0.65 },
    { key: 'twistDegrees', label: 'Twist (° / distance)', min: -720, max: 720, step: 1, default: 90 },
  ],
  midiRows: () => [
    { pitch: FORCE_FIELD_OUTWARD_PITCH, label: 'Pulse outward' },
    { pitch: FORCE_FIELD_INWARD_PITCH, label: 'Pulse inward' },
    { pitch: FORCE_FIELD_IN_OUT_PITCH, label: 'Anticipate inward → strike outward' },
    { pitch: FORCE_FIELD_OUT_IN_PITCH, label: 'Anticipate outward → strike inward' },
    { pitch: FORCE_FIELD_TWIST_PITCH, label: 'Spiral twist pulse' },
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
        const signedPush = evaluateForceFieldPulse(notes, settings, beat)
        const twistPerDistance = evaluateForceFieldTwist(notes, settings, beat)

        const offset = new Vector3()
        if (distance > 1e-10 && Math.abs(signedPush) > 1e-10) {
          const distanceScale = settings.distanceMode === 0 ? 1 : distance * settings.distanceFactor
          offset.copy(radial).normalize().multiplyScalar(signedPush * settings.strength * distanceScale)
        }

        // Polar spiral mapping: theta' = theta + pulse × radius. The radial
        // displacement is included in radius, so a simultaneous push curls
        // farther while a pull tightens toward the quiet center.
        const displacedRadius = radial.clone().add(offset).length()
        const twistRadians = twistPerDistance * displacedRadius * Math.PI / 180
        if (offset.lengthSq() <= 1e-20 && Math.abs(twistRadians) <= 1e-10) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        // WORLD composition: twist the radially displaced copy around the field
        // center. A chord containing radial and twist notes therefore spirals.
        const translation = new Matrix4().makeTranslation(offset.x, offset.y, offset.z)
        const twist = new Matrix4().makeTranslation(center.x, center.y, center.z)
          .multiply(new Matrix4().makeRotationZ(twistRadians))
          .multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z))
        const worldDelta = twist.multiply(translation)

        // Conjugating by placement turns that world-space delta back into the
        // VisualCopy space expected by the renderer. With no placement this is
        // simply chain-root composition (worldDelta * copy).
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(worldDelta)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : worldDelta.multiply(visualCopy.transform.clone())
        return [{
          transform,
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}
