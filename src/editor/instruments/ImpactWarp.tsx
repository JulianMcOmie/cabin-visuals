import { midiVelocity } from '../utils/midiVelocity'
import type { ObjectState } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// A MIDI strike moves the entire rendered scene about its center. The pass
// lives after Bass Ripple and before grading, preserving scene composition.
export const IMPACT_WARP_PITCH = 60
export const IMPACT_WARP_ROWS: MidiRowDef[] = [
  { pitch: IMPACT_WARP_PITCH, label: 'Hit', emphasized: true },
]

const PARAMS: ParamDef[] = [
  { key: 'impact', label: 'Impact', min: 0, max: 1, step: 0.01, default: 0.7 },
]
export const IMPACT_WARP_DEFAULT = PARAMS[0].default as number
export const IMPACT_WARP_SECONDS = 0.78
export const IMPACT_WARP_REACH = 0.28

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Normalized strike age. A ~100ms load into the blow, a broad recovery and
 *  one 6% rebound. Position, velocity AND acceleration meet continuously at
 *  every join: no first-frame jump, no snapping when the effect retires.
 *  Duration is internal and measured in seconds, keeping its weight at any BPM. */
export function impactEnvelope(age: number): number {
  if (age <= 0 || age >= 1) return 0
  if (age < 0.13) return smootherstep(age / 0.13)
  if (age < 0.66) return 1 - 1.06 * smootherstep((age - 0.13) / 0.53)
  return -0.06 * (1 - smootherstep((age - 0.66) / 0.34))
}

/** Soft limiting compounds rolls without a hard clamp's sudden velocity
 *  changes. Kept separate from gain so the knob and MIDI velocity remain useful. */
export function impactDrive(drive: number): number {
  // A roll may stack dozens of small rebounds. Limit that side separately so
  // the recovery can never become a second full-strength impact.
  const knee = drive < 0 ? 0.1 : 1
  return drive / Math.sqrt(1 + (drive / knee) ** 2)
}

/** One isotropic sampling field for the stage and inspector. Positive amount
 *  magnifies the image toward the viewer. Every pixel shares the same center
 *  and scale; horizontal, vertical and diagonal symmetries survive any aspect
 *  ratio. The small rebound mirrors the exposed border without edge smearing. */
export const IMPACT_WARP_FIELD_GLSL = `
vec2 impactWarpWrap(vec2 uv) {
  vec2 m = mod(uv, 2.0);
  return mix(m, 2.0 - m, step(1.0, m));
}
vec2 impactWarpOffset(vec2 uv, float amount) {
  return -(uv - 0.5) * amount * ${IMPACT_WARP_REACH};
}
`

export interface ActiveImpactWarp {
  amount: number
}

/** Note lengths never gate recovery. Sum closed-form onset responses instead
 *  of resetting on retrigger or accumulating frame deltas, so dense rolls,
 *  pause, backward seeks, worker preview and export all follow the same path.
 *  Old style/release/size values may remain in saved tracks; this redesign
 *  deliberately ignores them, retaining the existing impact automation key. */
export function resolveActiveImpactWarp(
  state: Pick<ObjectState, 'notes' | 'params' | 'opacity' | 'blackedOut' | 'beat' | 'secPerBeat'> | undefined,
): ActiveImpactWarp | null {
  if (!state || state.blackedOut) return null
  const gain = Math.max(0, Math.min(1, state.params.impact ?? IMPACT_WARP_DEFAULT))
    * Math.max(0, Math.min(1, state.opacity))
  if (gain === 0) return null

  let drive = 0
  for (const note of state.notes) {
    if (note.pitch !== IMPACT_WARP_PITCH) continue
    const age = (state.beat - note.beat) * state.secPerBeat / IMPACT_WARP_SECONDS
    if (age <= 0 || age >= 1) continue
    drive += impactEnvelope(age) * midiVelocity(note.velocity)
  }
  const amount = impactDrive(drive) * gain
  return amount === 0 ? null : { amount }
}

export const impactWarpInstrument: ObjectInstrumentDef = {
  id: 'impactWarp',
  name: 'Impact Warp',
  kind: 'object',
  identityColor: '#ff6a00',
  params: PARAMS,
  userInterfaceRenderer: 'impactWarp',
  midiRows: IMPACT_WARP_ROWS,
  // Geometry is unnecessary: the compositor applies this track to the scene.
  component: () => null,
}
