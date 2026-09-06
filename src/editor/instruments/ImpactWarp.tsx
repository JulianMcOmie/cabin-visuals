import { midiVelocity } from '../utils/midiVelocity'
import type { ObjectState } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// Impact Warp: one MIDI note, and the screen takes a hit.
//
// Like Bass Ripple this draws nothing and displaces the pixels of the scene it
// sits in, so the whole world bends as one image (see that file for why a
// scene-wide post-process is an object instrument and not a director - it acts
// on ONE scene's render target before compositing, so a punched scene still
// slots into a Crop mask or a Cut partition normally).
//
// What makes it a different instrument rather than another Bass Ripple preset:
//
// IT IS TRIGGERED, NOT HELD. Bass Ripple reads `activeNotes` and warps for as
// long as a note lasts; this reads note ONSETS out of the full stream and
// ignores duration entirely. A note here is a strike, so its length is not a
// parameter - which is also what puts it in the library's Impulse shelf rather
// than Rumble.
//
// THE ATTACK IS A SINGLE FRAME. The envelope is 1.0 at the onset with no ramp
// whatsoever, then falls and swings once past zero before settling
// (impactEnvelope). Anything softer stops being a punch: the whole effect is
// that the frame is already displaced by the time you notice the note.
//
// STYLE IS A PANEL CHOICE, NOT A ROW. Strobe puts its rates on MIDI rows
// because a strobe's gesture is its acceleration. A punch has no such
// dimension - you hit it once - so its four flavours live on a segmented
// control and the piano roll keeps exactly one row.
//
// The knobs are therefore only: how hard it hits, how long it takes to recover,
// and how big the disturbance is.

export const IMPACT_WARP_PITCH = 60

export const IMPACT_WARP_ROWS: MidiRowDef[] = [
  { pitch: IMPACT_WARP_PITCH, label: 'Hit', emphasized: true },
]

// Style values are this instrument's own enum, stored in the document. The
// shader branches on the same numbers, so append new styles - never renumber,
// or every saved project changes look.
export const IMPACT_STYLE_PUNCH = 0
export const IMPACT_STYLE_SHOCKWAVE = 1
export const IMPACT_STYLE_SLAM = 2
export const IMPACT_STYLE_RUPTURE = 3

const PARAMS: ParamDef[] = [
  {
    key: 'style',
    label: 'Style',
    type: 'select',
    default: IMPACT_STYLE_PUNCH,
    options: [
      { value: IMPACT_STYLE_PUNCH, label: 'Punch' },
      { value: IMPACT_STYLE_SHOCKWAVE, label: 'Shockwave' },
      { value: IMPACT_STYLE_SLAM, label: 'Slam' },
      { value: IMPACT_STYLE_RUPTURE, label: 'Rupture' },
    ],
  },
  // The default sits high on purpose. This instrument's failure mode is being
  // too polite to notice, and a knob whose default is a shrug teaches the wrong
  // thing about what it does.
  { key: 'impact', label: 'Impact', min: 0, max: 1, step: 0.01, default: 0.7 },
  // In beats, and never 0: a hit that recovers instantly is a one-frame flicker
  // nobody can see. A third of a beat is about as short as still reads as a hit.
  { key: 'release', label: 'Release', min: 0.05, max: 3, step: 0.01, default: 0.35 },
  { key: 'size', label: 'Size', min: 0, max: 1, step: 0.01, default: 0.5 },
]

/** One place for the runtime fallbacks, read off the schema rather than
 *  repeated as literals - a track that predates a param must render at the
 *  value the panel is showing, and re-tuning a default must actually re-tune. */
const DEFAULTS: Record<string, number> = Object.fromEntries(
  PARAMS.map((param) => [param.key, param.default as number]),
)

/** Three quarters of a cosine cycle over the release: full displacement at the
 *  onset, through zero at a third of the way, a small overshoot the OTHER way
 *  around two thirds, back to nothing at the end. That rebound is most of what
 *  sells the hit - a warp that only decays reads as a fade, while one that
 *  crosses back through and settles reads as something absorbing a blow. */
const REBOUND_TURNS = 0.75

/** The strike envelope, in normalized age (0 at the onset, 1 at the end of
 *  release). Signed: the negative stretch is the rebound, and every style
 *  interprets a negative amount as "the same displacement, the other way". */
export function impactEnvelope(age: number): number {
  if (age < 0 || age >= 1) return 0
  const fall = (1 - age) * (1 - age)
  return fall * Math.cos(age * REBOUND_TURNS * Math.PI * 2)
}

/** The golden angle - consecutive hits shove 137.5° apart. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Which way the `index`-th hit shoves the frame, as a unit vector in screen
 * space (+y up).
 *
 * Deliberately a fixed sequence rather than a hash of the note: hashing gives
 * genuinely random angles, and random angles CLUSTER - two near-identical
 * shoves in a row read as the effect having failed to retrigger, which is the
 * one thing a percussive instrument cannot afford. The golden angle can never
 * repeat a direction, so every hit in a roll visibly comes from somewhere new.
 */
export function impactShoveDirection(index: number): { x: number; y: number } {
  const angle = index * GOLDEN_ANGLE
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/**
 * The displacement field, as GLSL. Exported because two places need the SAME
 * field and nothing may reimplement it: the compositor's impact pass
 * (`IMPACT_WARP_FRAGMENT` in components/visual/VisualScene.tsx) and the settings
 * panel's live preview. Sharing the source is what makes the preview honest -
 * the lattice in the panel is hit by the exact math that hits the stage.
 */
export const IMPACT_WARP_FIELD_GLSL = `
// A different constant set from Bass Ripple's warpHash, so two warps in one
// scene never rhyme.
float impactHash(vec2 p) {
  return fract(sin(dot(p, vec2(21.98, 78.233))) * 43758.5453123);
}

// Where a displaced pixel is SAMPLED from, given the frame it landed outside
// of. Sampling out of bounds is unavoidable here - a shove translates the whole
// image, and a rebound zooms out past the edge - so the frame mirrors rather
// than clamping. A clamped edge smears its last row of pixels into a bar of
// streaks that reads as a rendering fault; a mirrored one reads as more scene.
vec2 impactWarpWrap(vec2 uv) {
  vec2 m = mod(uv, 2.0);
  return mix(m, 2.0 - m, step(1.0, m));
}

// How far apart the red and blue channels are pulled, given the displacement
// that pixel is already under. A fixed FRACTION of the displacement, so the
// fringe is exactly as violent as the hit and vanishes with it - no knob of its
// own, nothing to clean up at rest.
//
// Capped hard, though, and the cap is the whole reason this is a function.
// Displacements here run to a fifth of the frame (Rupture's slabs, a full-Impact
// Punch at the corners), and even a small percentage of that is wider than a fine
// feature: the three channels land on three different objects, and a scene of
// small dots or thin text turns to rainbow confetti instead of getting a hot
// fringe. A couple of screen pixels is all it takes to read as violence.
vec2 impactWarpSplit(vec2 offset) {
  vec2 split = offset * 0.02;
  float reach = length(split);
  return reach > 0.0025 ? split * (0.0025 / reach) : split;
}

// Where the pixel at \`uv\` is fetched from. This is a SAMPLING offset, so it
// runs opposite to the motion you see: an offset pointing outward pulls distant
// content inward and the image contracts. Every branch below is signed so that
// a positive \`amount\` moves the picture the way the style's name says.
//   style   0 punch · 1 shockwave · 2 slam · 3 rupture
//   amount  signed strike strength for the styles driven by one scalar
//   dir     slam's shove, in frame-HEIGHT units, already signed and scaled
//   phase   0..1 age of the freshest hit - the shockwave ring's travel
//   size    0..1 spatial scale of the disturbance; each branch says what of
//   seed    changes the rupture's slab pattern from hit to hit
vec2 impactWarpOffset(
  vec2 uv, float style, float amount, vec2 dir, float phase, float size, float seed, float aspect
) {
  vec2 c = uv - 0.5;
  // An aspect-corrected copy, used ONLY for radial measurements so falloffs
  // stay round. The displacement itself is computed in uv, because a zoom of uv
  // about the center is a true zoom of the frame while a zoom of the corrected
  // vector would squash it.
  vec2 d = c * vec2(aspect, 1.0);
  float corner = length(vec2(aspect, 1.0)) * 0.5;
  float len = length(d) / corner;

  if (style < 0.5) {
    // PUNCH. The frame slams TOWARD you and springs back - it magnifies on the
    // strike, which is both the way a blow to the face reads and the direction
    // that samples strictly inside the frame, so the hardest moment of the
    // hardest style never touches an edge.
    //
    // SIZE moves the weight of the displacement outward: at 0 it is a flat zoom
    // of the whole image, at 1 the center is pinned and only the edges bulge,
    // which reads as the glass itself flexing rather than as a camera move.
    return -c * amount * 0.42 * mix(1.0, len, size);
  }

  if (style < 1.5) {
    // SHOCKWAVE. ONE ring of compression launched from the center, off the edge
    // of the frame by the time the envelope ends - percussive because it is a
    // single wavefront travelling, not a field oscillating. SIZE is the ring's
    // thickness: thin is a crack, wide is a swell. It overshoots the corner
    // (1.25) so the ring leaves rather than stalling at the edge.
    float ring = phase * 1.25;
    float width = mix(0.05, 0.32, size);
    // Squared by multiplication, not pow(): GLSL's pow is undefined for a
    // negative base, and (len - ring) is negative for every pixel inside the
    // ring - half the frame.
    float falloff = (len - ring) / width;
    float band = exp(-falloff * falloff);
    // Epsilon keeps normalize() defined at the exact center pixel.
    vec2 radial = normalize(d + vec2(1e-5));
    return -vec2(radial.x / aspect, radial.y) * amount * 0.15 * band;
  }

  if (style < 2.5) {
    // SLAM. The whole frame takes a hit from one side, like a camera being
    // shoved. \`dir\` already carries which way and how hard - a different way
    // per hit, from the note's index (impactShoveDirection).
    //
    // SIZE adds ROLL: the frame rotates INTO the shove the way a head snaps
    // with a punch. A pure translation is the weaker half of that gesture;
    // rolling with it is what makes the frame feel mounted on something.
    vec2 shove = vec2(dir.x / aspect, dir.y) * 0.13;
    float roll = -dir.x * size * 0.22;
    float sr = sin(roll);
    float cr = cos(roll);
    vec2 rotated = vec2(d.x * cr - d.y * sr, d.x * sr + d.y * cr);
    return -(shove + vec2((rotated.x - d.x) / aspect, rotated.y - d.y));
  }

  // RUPTURE. Horizontal slabs tear sideways and snap back. SIZE is the slab
  // HEIGHT - a few fat bands, or many thin ones. Only some slabs tear, and each
  // by its own amount: shifting every row by the same distance is a comb, and
  // shifting every row at all is a shear; a break needs intact pieces to break
  // away FROM.
  float slabs = mix(26.0, 5.0, size);
  float row = floor(uv.y * slabs);
  float shift = impactHash(vec2(row, seed)) - 0.5;
  float torn = step(0.32, impactHash(vec2(row, seed + 7.31)));
  return vec2(shift * 2.0 * amount * 0.2 * torn, 0.0);
}
`

export interface ActiveImpactWarp {
  /** Which branch of the field to take (IMPACT_STYLE_*). */
  style: number
  /** Signed strike strength, already folded with velocity, Impact and track
   *  opacity. Drives every style except Slam, which steers by `dirX/dirY`. */
  amount: number
  /** Slam's shove, in frame-height units, sign and magnitude included. */
  dirX: number
  dirY: number
  /** 0..1 age of the FRESHEST hit - the shockwave ring's position. */
  phase: number
  /** 0..1 spatial scale of the disturbance. */
  size: number
  /** The freshest hit's index in the note stream: re-seeds the rupture pattern
   *  so two hits never tear along the same lines. */
  seed: number
}

const clampSigned = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * Resolve one track's hit this frame.
 *
 * Every note ONSET within a release of `state.beat` contributes its own
 * envelope and they SUM, so a fast roll compounds into a harder hit than any
 * single strike - the same "played harder = hits harder" the velocity term
 * gives, but from the rhythm instead of the keyboard. The sum is clamped, so a
 * dense roll saturates rather than tearing the frame into nothing. (Shockwave is
 * the exception, for the reason given at the amplitude below.)
 *
 * `activeNotes` is deliberately unread: a strike has no duration. Everything
 * comes out of the full note stream as a closed-form function of `state.beat`,
 * so a paused frame is a frozen hit and scrubbing into the middle of a recovery
 * shows exactly what playback shows.
 */
export function resolveActiveImpactWarp(
  state: Pick<ObjectState, 'notes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveImpactWarp | null {
  if (!state || state.blackedOut) return null

  const release = Math.max(0.01, state.params.release ?? DEFAULTS.release)
  let drive = 0
  let shoveX = 0
  let shoveY = 0
  let freshestBeat = -Infinity
  let freshestIndex = 0
  let freshestVelocity = 1
  // Counts recognized notes in stream order, INCLUDING ones still in the
  // future, so a hit's shove direction is a property of the hit itself and does
  // not change as the playhead passes other notes.
  let index = 0

  for (const note of state.notes) {
    if (note.pitch !== IMPACT_WARP_PITCH) continue
    const hitIndex = index++
    if (note.beat > state.beat) continue
    const age = (state.beat - note.beat) / release
    if (age >= 1) continue
    const velocity = midiVelocity(note.velocity)
    const strike = impactEnvelope(age) * velocity
    drive += strike
    const direction = impactShoveDirection(hitIndex)
    shoveX += direction.x * strike
    shoveY += direction.y * strike
    if (note.beat >= freshestBeat) {
      freshestBeat = note.beat
      freshestIndex = hitIndex
      freshestVelocity = velocity
    }
  }
  if (freshestBeat === -Infinity) return null

  const style = Math.round(state.params.style ?? DEFAULTS.style)
  const gain = Math.max(0, Math.min(1, state.params.impact ?? DEFAULTS.impact)) * state.opacity
  const phase = Math.max(0, Math.min(1, (state.beat - freshestBeat) / release))
  // Shockwave gets a monotonic amplitude instead of the rebounding envelope, and
  // is the one style that does not compound across a roll. Both follow from what
  // it is: a wavefront PASSING THROUGH the frame, not the frame being deformed.
  // A wave weakens as it spreads (it does not spring back), and a second hit
  // launches a second wave - which, with one pass to draw it in, means the newest
  // ring simply takes over. Sharing the deformation envelope here made the ring
  // die at a third of its travel, so it was never seen crossing the frame at all.
  const amount = style === IMPACT_STYLE_SHOCKWAVE
    ? gain * freshestVelocity * (1 - phase)
    : clampSigned(drive) * gain
  // Opposing shoves in a roll partially cancel; the length is clamped rather
  // than normalized so that cancellation is visible instead of being renormalized
  // back up to a full-strength shove in whatever direction survived.
  const shoveLength = Math.hypot(shoveX, shoveY)
  const shoveScale = (shoveLength > 1 ? 1 / shoveLength : 1) * gain
  if (Math.abs(amount) < 1e-4 && shoveLength * shoveScale < 1e-4) return null

  return {
    style,
    amount,
    dirX: shoveX * shoveScale,
    dirY: shoveY * shoveScale,
    phase,
    size: Math.max(0, Math.min(1, state.params.size ?? DEFAULTS.size)),
    seed: freshestIndex,
  }
}

function ImpactWarpVisual() {
  // The scene compositor consumes this track's ObjectState and hits the scene
  // after it has rendered. No geometry belongs in the scene.
  return null
}

export const impactWarpInstrument: ObjectInstrumentDef = {
  id: 'impactWarp',
  name: 'Impact Warp',
  kind: 'object',
  // A hit is orange-hot. Distinct from Bass Ripple's violet in the timeline,
  // which matters because the two are the instruments most likely to sit on
  // adjacent tracks doing superficially similar things.
  identityColor: '#ff6a00',
  params: PARAMS,
  userInterfaceRenderer: 'impactWarp',
  midiRows: IMPACT_WARP_ROWS,
  component: ImpactWarpVisual,
}
