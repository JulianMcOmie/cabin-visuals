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
// The default displacement field is fractal value noise, sampled twice at
// decorrelated offsets to get x and y. Noise rather than a radial sine because
// a sine has a visible center and visible rings; noise has neither, so at low
// strength it reads as heat haze or a lens softening rather than as an effect.
//
// PATTERN chooses between that noise and four deliberately visible fields -
// where noise hides its structure, these wear theirs. The numbering is
// append-only (same discipline as COLOR_FILTER_FRAGMENT's modes): a track
// stores the value, so renumbering would silently repaint saved projects.

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
//
// Every pattern keeps the same contract: WAVE (scale) is its spatial
// frequency, SPEED is how fast it travels, and full INTENSITY lands in the
// same ~0.1-0.2 frame-fraction band as the noise field so switching patterns
// never jumps the violence of the warp.
vec2 bassRippleOffset(vec2 uv, float pattern, float amount, float scale, float speed, float time, float aspect) {
  float t = time * speed;

  if (pattern < 0.5) {
    // 0 · NOISE - the original fractal value-noise haze.
    vec2 p = uv * vec2(aspect, 1.0) * scale;
    vec2 drift = vec2(t, t * 0.7);
    float nx = warpFbm(p + drift);
    float ny = warpFbm(p + drift + vec2(41.3, 19.7));
    // 0.12 is what full INTENSITY means - doubled from 0.06, with the param's
    // default halved to 0.5 so the default still bends the scene by the old amount.
    return (vec2(nx, ny) - 0.5) * 2.0 * amount * 0.12;
  }

  // The patterned fields work in centered, aspect-true coordinates so their
  // symmetry sits at the middle of the frame and circles stay circles.
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);

  if (pattern < 1.5) {
    // 1 · TWIST - a polar swirl. Each pixel rotates about the center by an
    // angle that waves with radius, and shearing the wave by 3θ winds the
    // alternating rings into three spiral arms that churn as they travel.
    // The 1/(1+6r) falloff keeps the outer frame from tearing while the
    // middle wrings itself.
    float r = length(q);
    float theta = atan(q.y, q.x);
    float wave = sin(r * scale * 2.6 - theta * 3.0 - t * 2.0);
    float ang = wave * amount * 1.5 / (1.0 + 6.0 * r);
    float c = cos(ang);
    float s = sin(ang);
    return vec2(q.x * c - q.y * s, q.x * s + q.y * c) - q;
  }

  if (pattern < 2.5) {
    // 2 · WAVES - two big plane sines rolling through each other: horizontal
    // displacement rides the rows, vertical rides the columns, each with a
    // quieter second harmonic so the rollers have surf on them. Deliberately
    // the widest, most legible field of the set.
    float k = scale * 1.8;
    float wx = sin(q.y * k + t * 2.4) + 0.35 * sin(q.y * k * 2.3 - t * 1.3);
    float wy = sin(q.x * k * 0.83 - t * 2.0 + 1.7) + 0.35 * sin(q.x * k * 1.9 + t);
    return vec2(wx, wy) * amount * 0.12;
  }

  if (pattern < 3.5) {
    // 3 · WEAVE - two sine gratings crossed at ±36°, drifting opposite ways,
    // each pushing pixels along its own normal. Their frequencies nearly but
    // not quite match (1.12x), so the sum beats into a slow moiré: a plaid
    // that shimmers between flat cloth and deep lattice as the gratings slide.
    vec2 d1 = vec2(0.809, 0.588);
    vec2 d2 = vec2(0.809, -0.588);
    float k = scale * 3.0;
    float g1 = sin(dot(q, d1) * k - t * 1.6);
    float g2 = sin(dot(q, d2) * k * 1.12 + t * 1.3);
    float cell = g1 * g2;
    return (d1 * g1 + d2 * g2) * (0.55 + 0.45 * cell) * amount * 0.085;
  }

  // 4 · BLOOM - a six-petal mandala. Concentric rings breathe outward, a
  // cosine rose scallops them into petals that sway slowly, and a quiet
  // tangential counter-swirl keeps the flower turning instead of just
  // pulsing. The smoothstep pins the very center still - a mandala holds
  // its heart.
  float r = length(q) + 1e-4;
  float theta = atan(q.y, q.x);
  float rings = sin(r * scale * 3.2 - t * 1.8);
  float rose = cos(theta * 6.0 + sin(t * 0.7) * 1.2);
  float radial = rings * (0.55 + 0.45 * rose);
  float swirl = 0.35 * sin(theta * 6.0 - t * 0.9) * cos(r * scale * 1.6);
  vec2 outward = q / r;
  vec2 tangent = vec2(-outward.y, outward.x);
  return (outward * radial + tangent * swirl) * amount * 0.1 * smoothstep(0.0, 0.18, r);
}
`

export interface ActiveBassRipple {
  /** Which displacement field: an index into BASS_RIPPLE_PATTERNS. */
  pattern: number
  /** 0..1, already folded with velocity, track opacity and the release tail. */
  amount: number
  /** Spatial frequency of the field. */
  scale: number
  /** How fast the field drifts, in field-widths per beat. */
  speed: number
  beat: number
}

/** Shared by the param schema and the panel's segmented control. Values are
 *  stored on tracks - append here, never renumber (see the field's comment). */
export const BASS_RIPPLE_PATTERNS = [
  { value: 0, label: 'Noise' },
  { value: 1, label: 'Twist' },
  { value: 2, label: 'Waves' },
  { value: 3, label: 'Weave' },
  { value: 4, label: 'Bloom' },
]

const PARAMS: ParamDef[] = [
  // The panel's biggest decision comes first: which field bends the scene.
  { key: 'pattern', label: 'Pattern', type: 'select', options: BASS_RIPPLE_PATTERNS, default: 0 },
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
      pattern: Math.round(state.params.pattern ?? 0),
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
