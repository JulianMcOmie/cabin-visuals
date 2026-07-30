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

/** Mirrors the engine's own liveness rule for zero-length notes (VisualEngine). */
const MIN_NOTE_BEATS = 0.05

/**
 * The displacement field itself, as GLSL. Exported because two places need the
 * SAME field: the compositor's warp pass (`WARP_FRAGMENT` in
 * components/visual/VisualScene.tsx) and the settings panel's live preview.
 * Sharing the source is what makes the preview honest - the cubes in the panel
 * are shaken by the exact math that bends the stage, not by a lookalike.
 */
export const BASS_RIPPLE_FIELD_GLSL = `
float warpHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float warpNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(warpHash(i), warpHash(i + vec2(1.0, 0.0)), u.x),
    mix(warpHash(i + vec2(0.0, 1.0)), warpHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Three octaves is enough for the field to look organic rather than blobby,
// and cheap enough to run per pixel per scene.
float warpFbm(vec2 p) {
  return warpNoise(p) * 0.6 + warpNoise(p * 2.03) * 0.3 + warpNoise(p * 4.01) * 0.1;
}

// How far the pixel at \`uv\` moves. Aspect-corrected so the field stays round
// instead of stretching with the viewport, and centered on zero so the scene
// bends both ways rather than sliding.
vec2 bassRippleOffset(vec2 uv, float amount, float scale, float speed, float time, float aspect) {
  vec2 p = uv * vec2(aspect, 1.0) * scale;
  vec2 drift = vec2(time * speed, time * speed * 0.7);
  float nx = warpFbm(p + drift);
  float ny = warpFbm(p + drift + vec2(41.3, 19.7));
  // 0.12 is what full INTENSITY means - doubled from 0.06, with the param's
  // default halved to 0.5 so the default still bends the scene by the old amount.
  return (vec2(nx, ny) - 0.5) * 2.0 * amount * 0.12;
}
`

export interface ActiveBassRipple {
  /** 0..1, already folded with velocity, track opacity and the release tail. */
  amount: number
  /** Spatial frequency of the noise field. */
  scale: number
  /** How fast the field drifts, in field-widths per beat. */
  speed: number
  beat: number
}

const PARAMS: ParamDef[] = [
  // The knob stays a clean 0-100%; what doubled is what 100% MEANS (the warp
  // coefficient in bassRippleOffset). The default sits at half, so it bends the
  // scene exactly as the old default did and the whole upper half of the travel
  // is new headroom.
  { key: 'amount', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'scale', label: 'Wave', min: 0.5, max: 12, step: 0.1, default: 3 },
  { key: 'speed', label: 'Speed', min: 0, max: 4, step: 0.05, default: 0.6 },
  { key: 'release', label: 'Release', min: 0, max: 8, step: 0.05, default: 0.5 },
]

/**
 * Resolve one track's ripple. Mirrors Color Filters while a note is held: the
 * latest-started recognized note wins, and velocity plus track opacity both
 * scale Intensity - so how hard the note is struck is how far the scene bends.
 *
 * With nothing held, Release (in beats) keeps the most recently ENDED note's
 * warp alive and decays it to nothing. Without it a bent scene snaps straight
 * on note-off, which reads as a glitch rather than as a bass note dying away;
 * the tail is squared so it drops fast and then settles.
 *
 * Release is looked up in the full note stream rather than tracked across
 * frames: the tail stays a closed-form function of the beat, so scrubbing into
 * the middle of one shows exactly what playback shows.
 */
export function resolveActiveBassRipple(
  state: Pick<ObjectState, 'activeNotes' | 'notes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveBassRipple | null {
  if (!state || state.blackedOut) return null

  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (note.pitch !== BASS_RIPPLE_PITCH) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }

  let tail = 1
  if (!selected) {
    const release = Math.max(0, state.params.release ?? 0.5)
    if (release <= 0) return null
    let endBeat = -Infinity
    for (const note of state.notes) {
      if (note.pitch !== BASS_RIPPLE_PITCH) continue
      const end = note.beat + (note.durationBeats || MIN_NOTE_BEATS)
      if (end > state.beat || end <= endBeat) continue
      endBeat = end
      selected = note
    }
    if (!selected) return null
    const age = (state.beat - endBeat) / release
    if (age >= 1) return null
    tail = (1 - age) * (1 - age)
  }

  const velocity = selected.velocity <= 1 ? selected.velocity : selected.velocity / 127
  const amount = Math.max(0, Math.min(1, (state.params.amount ?? 0.5) * state.opacity * velocity)) * tail
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
  identityColor: '#5865f2',
  params: PARAMS,
  userInterfaceRenderer: 'bassRipple',
  midiRows: BASS_RIPPLE_ROWS,
  component: BassRippleVisual,
}
