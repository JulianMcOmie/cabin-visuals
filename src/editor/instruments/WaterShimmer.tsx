import { midiVelocity } from '../utils/midiVelocity'
import type { ObjectState, ResolvedNote } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// Water Shimmer: Bass Ripple's colour-only sibling.
//
// Bass Ripple moves pixels; this one never does. It reads the picture that is
// already there and re-exposes it through a drifting water-light field -
// brighter where the field crests, darker and cooler where it troughs - so a
// surface picks up the texture of light seen through water while every edge,
// silhouette and alpha value stays exactly where it was. Nothing is added
// where nothing was drawn: the pass scales the colour it finds, so black stays
// black and empty stays empty.
//
// Its REACH follows where its track sits (`scopesToParent`): at the root it
// re-lights the whole scene, like the other post-process instruments; nested
// under an instrument it re-lights only that instrument, and under a group
// every object in the group. The scene-wide form is a compositor pass in
// VisualScene; the nested form is the same fragment run inside each target's
// ShaderWrapper chain (core/visual/resolve.ts routes the ids).
//
// The field is anchored to the FRAME, not to the mesh, on purpose. That is
// what lets it work on every instrument - a surface-locked pattern needs a
// patchable lit material, which the raw-shader instruments don't have - and it
// is also what water light does: an object travelling through it passes
// through the pattern rather than carrying it along.

export const WATER_SHIMMER_ID = 'waterShimmer'

export const WATER_SHIMMER_PITCH = 60

export const WATER_SHIMMER_ROWS: MidiRowDef[] = [
  { pitch: WATER_SHIMMER_PITCH, label: 'Shimmer', emphasized: true },
]

/** Mirrors the engine's own liveness rule for zero-length notes (VisualEngine). */
const MIN_NOTE_BEATS = 0.05

/**
 * The water-light field and the colour law that applies it, as GLSL. Exported
 * because three places must run the SAME math: the compositor's scene-wide
 * pass, the per-object pass in ShaderWrapper (both through
 * WATER_SHIMMER_FRAGMENT below) and the settings panel's live preview.
 *
 * `waterShimmerField` returns (light, glint): `light` is signed and centred on
 * zero - crests positive, troughs negative - so holding a note re-distributes
 * a surface's brightness instead of lifting it, and `glint` is the small
 * positive sparkle that rides the sharpest crests.
 *
 * PATTERN numbering is append-only (the discipline Bass Ripple's patterns
 * follow): a track stores the value, so renumbering would silently repaint
 * saved projects.
 */
export const WATER_SHIMMER_FIELD_GLSL = `
vec2 shimmerHash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453123);
}

float shimmerNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(shimmerHash2(i).x, shimmerHash2(i + vec2(1.0, 0.0)).x, u.x),
    mix(shimmerHash2(i + vec2(0.0, 1.0)).x, shimmerHash2(i + vec2(1.0, 1.0)).x, u.x),
    u.y
  );
}

// Distance to the nearest point of a jittered grid whose points each circle
// inside their own cell. Every point moves on sin(), never fract(), so the
// cells slide continuously and nothing teleports at a wrap.
float shimmerCells(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  float nearest = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = shimmerHash2(cell + g);
      vec2 d = g + 0.5 + 0.4 * sin(t + 6.2831853 * h) - f;
      nearest = min(nearest, dot(d, d));
    }
  }
  return sqrt(nearest);
}

// 0 · CAUSTICS - the bright wandering net on a pool floor. Light gathers along
// the walls BETWEEN cell points (where the nearest point is farthest away), so
// raising that distance to a power leaves thin filaments and dark pools. Two
// layers at unrelated scales and clocks share one web through min(): their
// walls never line up, which is what keeps the net from reading as a grid.
float shimmerCaustics(vec2 p, float t) {
  vec2 wander = vec2(
    shimmerNoise(p * 0.6 + vec2(0.0, t * 0.23)),
    shimmerNoise(p * 0.6 + vec2(17.3, -t * 0.19))
  ) - 0.5;
  vec2 q = p + wander * 0.8;
  float a = shimmerCells(q, t);
  float b = shimmerCells(q * 1.43 + vec2(31.7, 12.9), t * 1.27 + 2.0);
  float web = min(a, b * 0.82);
  return pow(clamp(web * 1.6, 0.0, 1.0), 3.6);
}

// 1 · SWELL - open water. A handful of sine trains at unrelated headings, each
// shorter and quicker than the last (speed follows sqrt(frequency), the
// deep-water rule, so short chop outruns the long rollers instead of marching
// in step). exp(sin - 1) peaks the crests and flattens the troughs. Returns
// (dh/dx, dh/dy, h): the slope is analytic, so lighting costs no extra taps.
vec3 shimmerSwell(vec2 p, float t) {
  // A slow wander bends the wave fronts, or five straight trains read as a
  // woven cloth instead of water.
  p += (vec2(
    shimmerNoise(p * 0.23 + vec2(0.0, t * 0.11)),
    shimmerNoise(p * 0.23 + vec2(9.2, -t * 0.09))
  ) - 0.5) * 3.4;
  vec3 surface = vec3(0.0);
  float frequency = 1.0;
  float height = 1.0;
  float heading = 0.6;
  for (int i = 0; i < 5; i++) {
    vec2 dir = vec2(cos(heading), sin(heading));
    float phase = dot(p, dir) * frequency + t * sqrt(frequency) * 1.6 + float(i) * 1.7;
    float crest = exp(sin(phase) - 1.0);
    surface += vec3(dir * (crest * cos(phase) * frequency * height), crest * height);
    frequency *= 1.72;
    height *= 0.52;
    heading += 2.4;
  }
  return surface;
}

// 2 · RINGS - rain on a pond. One emitter per grid cell sends out a steady
// ring train that fades to nothing a cell away (the 3x3 walk below reaches
// exactly that far, so no ring is ever cut off at a cell edge), and the trains
// interfere where they cross. Returns (dh/dx, dh/dy, h) like the swell.
vec3 shimmerRings(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  vec3 surface = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 h = shimmerHash2(cell + g);
      vec2 d = f - (g + 0.2 + 0.6 * h);
      float r = length(d) + 1e-4;
      float reach = max(0.0, 1.0 - r);
      float phase = r * 20.0 - t * 3.2 + h.x * 19.0;
      // Drops are not all the same size: each emitter gets its own strength.
      float strength = 0.35 + 0.65 * h.y;
      float wave = sin(phase);
      float slope = cos(phase) * 20.0 * reach * reach - wave * 2.0 * reach;
      surface += vec3(d / r * slope, wave * reach * reach) * strength;
    }
  }
  return surface;
}

// Light a height field from the upper left. Diffuse is measured against flat
// water, so a still surface contributes exactly nothing, and each side is
// normalised to its own headroom so crests brighten as far as troughs darken.
vec2 shimmerLit(vec3 surface, float steepness) {
  vec3 normal = normalize(vec3(-surface.xy * steepness, 1.0));
  vec3 toLight = vec3(-0.451, 0.551, 0.702);
  vec3 halfway = vec3(-0.244, 0.299, 0.922);
  float diffuse = dot(normal, toLight) - toLight.z;
  float light = diffuse > 0.0 ? diffuse / (1.0 - toLight.z) : diffuse / toLight.z;
  float glint = pow(max(dot(normal, halfway), 0.0), 48.0);
  return vec2(light, max(0.0, glint - 0.02));
}

// (light, glint) at \`uv\`. Aspect-corrected and centred, so features stay
// round and the pattern grows from the middle of the frame as WAVE changes.
// Every pattern keeps one contract: WAVE (scale) is its spatial frequency and
// SPEED how fast it flows. The per-pattern multipliers put the default WAVE
// at a few features across a single object - an object is a small part of the
// frame, and a field sized to the frame would land inside one soft blob.
vec2 waterShimmerField(vec2 uv, float pattern, float scale, float speed, float time, float aspect) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * scale;
  float t = time * speed;

  if (pattern < 0.5) {
    float web = shimmerCaustics(p * 3.2, t * 1.4);
    return vec2(web * 1.9 - 0.4, web * web * 0.6);
  }
  if (pattern < 1.5) {
    return shimmerLit(shimmerSwell(p * 7.0, t * 1.5), 0.42);
  }
  return shimmerLit(shimmerRings(p * 2.2, t), 0.065);
}

vec3 shimmerHue(vec3 color, float turns) {
  vec3 axis = vec3(0.57735027);
  float angle = turns * 6.28318530718;
  return color * cos(angle)
    + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1.0 - cos(angle));
}

// The colour law. EXPOSURE, not addition: the field is a gain in stops, which
// brightens and darkens symmetrically and scales with what is already there -
// that is the whole reason the instrument cannot change a shape. COLOR pulls
// the two sides apart in hue as well as brightness: water takes red out of
// light first, so troughs lose red and go cool while crests keep it and go
// warm, and a small hue turn in opposite directions does the same job on a
// saturated colour that has no red to lose. Glints lift a pixel toward its
// OWN brightest channel, so they are white on white and still nothing on black.
vec4 waterShimmerApply(vec4 source, vec2 field, float amount, float chroma) {
  float light = field.x * amount;
  vec3 stops = light * 1.5 * (vec3(1.0) + chroma * vec3(0.5, 0.05, -0.5));
  vec3 color = source.rgb * exp2(stops);
  color = max(shimmerHue(color, light * chroma * 0.06), vec3(0.0));
  float peak = max(color.r, max(color.g, color.b));
  color += mix(color, vec3(peak), 0.65) * field.y * amount * 1.4;
  return vec4(color, source.a);
}
`

/** The whole pass, shared by the scene compositor and ShaderWrapper so the
 *  scene-wide and per-object forms cannot drift. A pixel nothing was drawn
 *  into is passed straight through BEFORE the field is evaluated: on a
 *  per-object pass that is most of the frame, so the expensive part runs only
 *  under the object. */
export const WATER_SHIMMER_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float pattern;
uniform float amount;
uniform float scale;
uniform float speed;
uniform float chroma;
uniform float time;
uniform float aspect;
varying vec2 vUv;

${WATER_SHIMMER_FIELD_GLSL}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  if (source.a <= 0.0 && max(source.r, max(source.g, source.b)) <= 0.0) {
    gl_FragColor = source;
    return;
  }
  vec2 field = waterShimmerField(vUv, pattern, scale, speed, time, aspect);
  gl_FragColor = waterShimmerApply(source, field, amount, chroma);
}`

export interface ActiveWaterShimmer {
  /** Which field: an index into WATER_SHIMMER_PATTERNS. */
  pattern: number
  /** 0..1, already folded with the gate, velocity, track opacity and release. */
  amount: number
  /** Spatial frequency of the field. */
  scale: number
  /** How fast the field flows, per beat. */
  speed: number
  /** 0..1: how far crests and troughs are pulled apart in HUE (0 = brightness only). */
  chroma: number
  beat: number
}

/** Shared by the param schema and the panel's segmented control. Values are
 *  stored on tracks - append here, never renumber (see the field's comment). */
export const WATER_SHIMMER_PATTERNS = [
  { value: 0, label: 'Caustics' },
  { value: 1, label: 'Swell' },
  { value: 2, label: 'Rings' },
]

/** What a note MEANS. Stored on tracks, so append-only like the patterns. */
export const WATER_SHIMMER_GATE_HELD = 0
export const WATER_SHIMMER_GATE_ALWAYS = 1
export const WATER_SHIMMER_GATES = [
  { value: WATER_SHIMMER_GATE_HELD, label: 'While held' },
  { value: WATER_SHIMMER_GATE_ALWAYS, label: 'Always on' },
]

const PARAMS: ParamDef[] = [
  { key: 'pattern', label: 'Pattern', type: 'select', options: WATER_SHIMMER_PATTERNS, default: 0 },
  { key: 'amount', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'scale', label: 'Wave', min: 0.5, max: 12, step: 0.1, default: 3 },
  { key: 'speed', label: 'Speed', min: 0, max: 4, step: 0.05, default: 0.6 },
  { key: 'chroma', label: 'Color', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'release', label: 'Release', min: 0, max: 8, step: 0.05, default: 0.5 },
  // Last, and non-default on purpose: While held is the Rumble shelf's
  // convention. Always on flips the note into an off switch.
  { key: 'gate', label: 'Runs', type: 'select', options: WATER_SHIMMER_GATES, default: WATER_SHIMMER_GATE_HELD },
]

type ShimmerState = Pick<ObjectState, 'activeNotes' | 'notes' | 'params' | 'opacity' | 'blackedOut' | 'beat'>

/**
 * How "held" the lane is right now: 1 while a note sounds, then the squared
 * release tail of the most recently ENDED note, then nothing. The same shape
 * Bass Ripple gives its warp, for the same reason - looked up in the note
 * stream rather than tracked across frames, so it is a closed-form function of
 * the beat and scrubbing into a tail shows exactly what playback shows.
 */
function heldLevel(state: ShimmerState): { level: number; velocity: number } | null {
  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (note.pitch !== WATER_SHIMMER_PITCH) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }
  if (selected) return { level: 1, velocity: midiVelocity(selected.velocity) }

  const release = Math.max(0, state.params.release ?? 0.5)
  if (release <= 0) return null
  let endBeat = -Infinity
  for (const note of state.notes) {
    if (note.pitch !== WATER_SHIMMER_PITCH) continue
    const end = note.beat + (note.durationBeats || MIN_NOTE_BEATS)
    if (end > state.beat || end <= endBeat) continue
    endBeat = end
    selected = note
  }
  if (!selected) return null
  const age = (state.beat - endBeat) / release
  if (age >= 1) return null
  return { level: (1 - age) * (1 - age), velocity: midiVelocity(selected.velocity) }
}

/**
 * Resolve one track's shimmer this frame, or null for "run no pass at all".
 *
 * WHILE HELD (the default): the water flows for as long as a note lasts.
 * Velocity and track opacity both scale Intensity, and Release lets it drain
 * away instead of snapping flat on note-off.
 *
 * ALWAYS ON: the water flows with no notes at all, and a note is an OFF
 * switch - held, it stills the surface; released, the water comes back over
 * Release. Velocity is deliberately ignored here: a note drawn at the default
 * velocity is 100/127, and "off" that left a fifth of the shimmer running
 * would not be off.
 */
export function resolveActiveWaterShimmer(state: ShimmerState | undefined): ActiveWaterShimmer | null {
  if (!state || state.blackedOut) return null

  const held = heldLevel(state)
  const alwaysOn = Math.round(state.params.gate ?? WATER_SHIMMER_GATE_HELD) === WATER_SHIMMER_GATE_ALWAYS
  const flow = alwaysOn
    ? 1 - (held?.level ?? 0)
    : (held ? held.level * held.velocity : 0)

  const amount = Math.max(0, Math.min(1, (state.params.amount ?? 0.6) * state.opacity * flow))
  return amount > 0
    ? {
      pattern: Math.round(state.params.pattern ?? 0),
      amount,
      scale: Math.max(0.1, state.params.scale ?? 3),
      speed: Math.max(0, state.params.speed ?? 0.6),
      chroma: Math.max(0, Math.min(1, state.params.chroma ?? 0.5)),
      beat: state.beat,
    }
    : null
}

function WaterShimmerVisual() {
  // The scene compositor (or the parent's ShaderWrapper, when nested) consumes
  // this track's ObjectState and re-lights pixels that are already rendered.
  // No geometry belongs in the scene.
  return null
}

export const waterShimmerInstrument: ObjectInstrumentDef = {
  id: WATER_SHIMMER_ID,
  name: 'Water Shimmer',
  kind: 'object',
  identityColor: '#22d3ee',
  params: PARAMS,
  userInterfaceRenderer: 'waterShimmer',
  midiRows: WATER_SHIMMER_ROWS,
  // The one row changes meaning with the gate, so its label does too.
  midiRowsFor: (track) => [{
    pitch: WATER_SHIMMER_PITCH,
    label: Math.round(track.params?.gate ?? WATER_SHIMMER_GATE_HELD) === WATER_SHIMMER_GATE_ALWAYS ? 'Still' : 'Shimmer',
    emphasized: true,
  }],
  scopesToParent: true,
  component: WaterShimmerVisual,
}
