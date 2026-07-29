import type { ObjectState, ResolvedNote } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// Bass Ripple: a scene-wide positional warp.
//
// Every other visual here draws something. This one draws nothing and instead
// displaces the pixels of the scene it sits in, so the whole world - objects,
// text, background, other instruments' output - bends together as one image
// rather than each element wobbling on its own.
//
// It is an object instrument, not a director, for the same reason Color
// Filters is: it belongs to ONE scene and post-processes that scene's own
// render target before compositing. Directors decide which scene goes where in
// Main, which is a different question. Sitting below compositing also means a
// warped scene still slots into a Crop mask or a Cut partition normally.
//
// The displacement field is fractal value noise, sampled twice at decorrelated
// offsets to get x and y. Noise rather than a radial sine because a sine has a
// visible center and visible rings; noise has neither, so at low strength it
// reads as heat haze or a lens softening rather than as an effect.

export const BASS_RIPPLE_PITCH = 60

export const BASS_RIPPLE_ROWS: MidiRowDef[] = [
  { pitch: BASS_RIPPLE_PITCH, label: 'Ripple', emphasized: true },
]

export interface ActiveBassRipple {
  /** 0..1, already folded with velocity and track opacity. */
  amount: number
  /** Spatial frequency of the noise field. */
  scale: number
  /** How fast the field drifts, in field-widths per beat. */
  speed: number
  beat: number
}

const PARAMS: ParamDef[] = [
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  { key: 'scale', label: 'Scale', min: 0.5, max: 12, step: 0.1, default: 3 },
  { key: 'speed', label: 'Speed', min: 0, max: 4, step: 0.05, default: 0.6 },
]

/**
 * Resolve one track's held ripple. Mirrors Color Filters: the latest-started
 * recognized note wins, and velocity plus track opacity both scale Amount - so
 * how hard the note is struck is how far the scene bends.
 */
export function resolveActiveBassRipple(
  state: Pick<ObjectState, 'activeNotes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveBassRipple | null {
  if (!state || state.blackedOut) return null
  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (note.pitch !== BASS_RIPPLE_PITCH) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }
  if (!selected) return null
  const velocity = selected.velocity <= 1 ? selected.velocity : selected.velocity / 127
  const amount = Math.max(0, Math.min(1, (state.params.amount ?? 1) * state.opacity * velocity))
  return amount > 0
    ? {
      amount,
      scale: Math.max(0.1, state.params.scale ?? 3),
      speed: Math.max(0, state.params.speed ?? 0.6),
      beat: state.beat,
    }
    : null
}

function BassRippleVisual() {
  // The scene compositor consumes this track's ObjectState and warps the scene
  // after it has rendered. No geometry belongs in the scene.
  return null
}

export const bassRippleInstrument: ObjectInstrumentDef = {
  id: 'bassRipple',
  name: 'Bass Ripple',
  kind: 'object',
  params: PARAMS,
  // Three plain sliders and one row - the generic parameter list covers it.
  userInterfaceRenderer: 'parameters',
  midiRows: BASS_RIPPLE_ROWS,
  component: BassRippleVisual,
}
