import type { ObjectInstrumentDef } from './types'
import type { ObjectState } from '../core/visual/types'
import {
  BLUR_MAX_DISTANCE, CROP_PARAMS, cropAngle, cropBlur, cropDivisions, cropFlash,
  cropFlashBeats, cropMidiRows, cropRadial, MAX_DIVISIONS,
} from '../core/directors/crop'
import { resolveCropSliceStates } from './cropMaskCore'

// Crop as an IN-SCENE instrument: a note-gated mask over the scene it lives in.
//
// The Main-scene composition surface (core/directors/crop.ts) masks one scene
// at the final compositor; this one is an ordinary scene track whose held notes
// gate slices of its OWN scene's rendered output - so the masked scene still
// slots into Cut bands and Switcher layers like any other. Params, pitches and
// the flash envelope are shared with the composition surface, so the two crops
// are the same device applied at different depths.
//
// Like the other scene post-process instruments (ColorFilters, Strobe,
// BassRipple, ImpactWarp) it renders nothing; VisualScene runs a compositor
// pass from `resolveActiveCropMask` + `CROP_MASK_FRAGMENT`. The mask pass runs
// LAST of the scene's own passes - it is a matte over the finished look, not
// one more color in the grade.

export interface ActiveCropMask {
  /** Per-slice state, MAX_DIVISIONS long: 0 = masked, 1 + envelope = visible
   *  (envelope in [0,1] drives the onset flash and blur). */
  sliceState: Float32Array
  count: number
  /** Radians (the shader's unit; the param is degrees). */
  angle: number
  wedge: boolean
  flash: number
  /** Smear length at full envelope, already scaled to frame widths. */
  blur: number
  /** Wet/dry from track opacity - the tf-opacity fader fades the MASK, not the
   *  scene, so ducking the track reveals the unmasked frame. */
  wet: number
}

/**
 * Resolve one crop track's mask this frame, or null for "run no pass at all":
 * no state (scene not composed), blacked out (muted), a track with no notes yet
 * (see cropMaskCore for why an empty lane must not blank the scene), or a fully
 * dry mask. Closed-form in `state.beat`, so paused/scrub/export agree.
 */
export function resolveActiveCropMask(
  state: Pick<ObjectState, 'notes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveCropMask | null {
  if (!state || state.blackedOut) return null
  const wet = Math.max(0, Math.min(1, state.opacity))
  if (wet <= 0) return null
  const sliceState = resolveCropSliceStates(
    state.notes, state.beat, cropDivisions(state), cropFlashBeats(state),
  )
  if (!sliceState) return null
  return {
    sliceState,
    count: cropDivisions(state),
    angle: (cropAngle(state) * Math.PI) / 180,
    wedge: cropRadial(state),
    flash: cropFlash(state),
    blur: cropBlur(state) * BLUR_MAX_DISTANCE,
    wet,
  }
}

// The band math is the compositor partition's (VisualScene's onBeforeCompile
// patch), restated as a standalone fullscreen pass: linear bands are even in
// width PERPENDICULAR to the cut and span the frame's extent along the cut
// normal (outer bands always reach the corners); wedges are even in angle about
// the aspect-corrected center. The uniform array is read via a constant-index
// loop, not `sliceState[band]` - dynamic uniform-array indexing is illegal in
// the GLSL ES 1.00 fragment shaders three compiles by default.
export const CROP_MASK_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float sliceState[${MAX_DIVISIONS}];
uniform float count;
uniform float angle;
uniform float wedge;
uniform float flash;
uniform float blur;
uniform float wet;
uniform float aspect;
varying vec2 vUv;

void main() {
  vec2 p = vUv - vec2(0.5);
  p.x *= aspect;
  float t;
  if (wedge > 0.5) {
    t = fract((atan(p.y, p.x) - angle) / 6.2831853);
  } else {
    vec2 n = vec2(cos(angle), sin(angle));
    float halfSpan = 0.5 * (aspect * abs(n.x) + abs(n.y));
    t = (dot(p, n) + halfSpan) / (2.0 * halfSpan);
  }
  float band = floor(clamp(t, 0.0, 0.999999) * count);
  float state = 0.0;
  for (int i = 0; i < ${MAX_DIVISIONS}; i++) {
    if (abs(float(i) - band) < 0.5) state = sliceState[i];
  }
  vec4 source = texture2D(tDiffuse, vUv);
  if (state < 0.5) {
    // Masked: transparent, NOT black - the compositor blends this layer
    // normally, so a punched hole shows whatever is composited beneath it
    // (Main's backdrop for a lone full-frame layer), exactly like the
    // Main-crop's compositor discard.
    gl_FragColor = mix(source, vec4(0.0), wet);
    return;
  }
  float env = max(0.0, state - 1.0);
  float smear = pow(env, 3.0) * blur;
  vec4 masked;
  if (smear > 0.0) {
    vec2 dir = wedge > 0.5 ? normalize(p + vec2(1e-6)) : vec2(cos(angle), sin(angle));
    vec2 blurStep = vec2(dir.x / aspect, dir.y) * smear;
    masked = vec4(0.0);
    for (int i = 0; i < 9; i++) {
      masked += texture2D(tDiffuse, vUv + blurStep * (float(i) / 8.0 - 0.5));
    }
    masked /= 9.0;
  } else {
    masked = source;
  }
  masked.rgb = mix(masked.rgb, vec3(1.15), env * flash);
  gl_FragColor = mix(source, masked, wet);
}`

function CropVisual() {
  // The scene compositor consumes this track's ObjectState and masks the scene
  // after it has rendered. No geometry belongs in the scene.
  return null
}

export const cropMaskInstrument: ObjectInstrumentDef = {
  id: 'crop',
  name: 'Crop',
  kind: 'object',
  params: CROP_PARAMS,
  userInterfaceRenderer: 'parameters',
  midiRowsFor: cropMidiRows,
  component: CropVisual,
}
