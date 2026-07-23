import { useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3, type Mesh, type ShaderMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// SILENT FILM - the "degraded film stock" pair for the Silent Film lyric
// template (docs/lyric-template-silent-film.md). Two instruments share this
// file because the aesthetic needs both sides of the text:
//
//   Film Stock  - the projected-stock BACKGROUND: tinted charcoal base, faint
//                 graph grid, coarse grain, dust/hairs, a wandering scratch,
//                 luminance flicker, vignette and barrel warp.
//   Film Grain  - the degradation OVERLAY: the same wear on a transparent
//                 plane that composites OVER everything (defaultOnTop + a high
//                 renderOrder), so text and background degrade together - that
//                 shared wear is what welds the frame into one piece of film.
//
// BOTH ARE PURE GPU. Every mark is evaluated per-pixel in a fragment shader
// from a handful of scalar uniforms, so a frame costs no CPU rasterization and
// no texture upload at all - only uniform writes. That is what makes stacking
// them (plus Scribble and Film Card) affordable in playback and export alike;
// the canvas implementation they replaced was the template's bottleneck.
//
// The pause invariant survives the move to the GPU: the shaders are given a
// QUANTIZED beat-time frame index (24fps, film cadence) and derive every
// "random" value from hashes of that index plus screen position. Same beat in,
// same pixels out - scrub still equals playback, and export still matches
// preview.

// Film cadence. Grain re-rolls on this index, dust and flicker on divisions of
// it, so the wear steps like a projector instead of sliding like a screensaver.
const FILM_FPS = 24
/** Note-driven marks passed to the shader per frame (fixed-size GLSL arrays). */
const MAX_MARKS = 4

const FILM_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Shared GLSL. Everything works in "height units": y spans 0..1 and x spans
// 0..aspect, so a speck is the same size regardless of window shape, and all
// the sizes below read as fractions of frame height.
const FILM_COMMON = `
varying vec2 vUv;

uniform float uAspect;
uniform float uPxH;      // one framebuffer pixel, in height units (for AA)
uniform float uFrame;    // quantized 24fps beat-time index
uniform float uGrain;
uniform float uGrainSize;
uniform float uDust;
uniform float uFlicker;  // signed: <0 darkens the frame, >0 lightens it
uniform float uVignette;
uniform float uWarp;
uniform float uDustSalt; // decorrelates the two instruments' dust
// A raw ShaderMaterial ignores Material.opacity, so the value the opacity
// wrapper writes each frame is fed back in here and applied to the output -
// otherwise opacity movers and mute fades would silently do nothing.
uniform float uOpacity;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Barrel distortion about the frame centre: the lens bulge that makes the
// reference's frame edges bow outward. Content sampled through this appears
// magnified at the edges; where the result leaves the frame we paint the
// projector's black surround, which is what makes the bow VISIBLE on the
// composited image (the overlay's surround covers the words too). The 0.5
// keeps a full-strength slider around a 25%-at-the-corners bulge - the
// reference's own warp is only a couple of percent.
vec2 barrel(vec2 uv) {
  vec2 c = uv - 0.5;
  return 0.5 + c * (1.0 + uWarp * dot(c, c) * 0.5);
}

/** 1 inside the (bowed) frame, 0 in the surround, antialiased across one pixel
 *  so the bowed edge is a clean curve rather than a staircase. */
float frameMask(vec2 duv) {
  vec2 d = min(duv, 1.0 - duv);
  return smoothstep(-uPxH, uPxH, min(d.x, d.y));
}

/** Coarse film grain. Returns dark speck coverage in .x, bright in .y. */
vec2 grainMarks(vec2 hc) {
  if (uGrain <= 0.0) return vec2(0.0);
  float cell = max(0.0005, uGrainSize * 0.001);
  vec2 g = floor(hc / cell);
  float n = hash21(g + vec2(uFrame * 17.31, uFrame * 7.77));
  // Sparse and faint on purpose - dense noise reads as a snowstorm, not film.
  float dark = smoothstep(0.05, 0.0, n);
  float bright = smoothstep(0.975, 1.0, n);
  return vec2(dark * uGrain * 0.28, bright * uGrain * 0.22);
}

/** White dust specks + the occasional drifting hair, re-rolled at 12fps. */
float dustMarks(vec2 hc) {
  float dustFrame = floor(uFrame * 0.5);
  float total = 0.0;

  // Specks: one candidate per cell, most cells empty.
  float cells = 7.0;
  vec2 dc = floor(hc * cells);
  vec2 dl = fract(hc * cells);
  float present = hash21(dc + vec2(dustFrame * 31.7 + uDustSalt, dustFrame * 11.3));
  if (present > 1.0 - uDust * 0.7) {
    vec2 pos = hash22(dc + vec2(dustFrame * 3.1 + uDustSalt, 5.0));
    float radius = (0.0006 + hash21(dc + 7.7) * 0.0021) * cells;
    float d = distance(dl, pos);
    total += (1.0 - smoothstep(radius * 0.45, radius, d)) * (0.12 + hash21(dc + 3.3) * 0.5);
  }

  // Hairs: a short bent-looking streak, rare enough to feel accidental.
  vec2 hcell = floor(hc * 2.0);
  vec2 hlocal = fract(hc * 2.0);
  float hairSeed = hash21(hcell + vec2(dustFrame * 71.3 + uDustSalt, 17.0));
  if (hairSeed > 0.93 - uDust * 0.06) {
    vec2 a = hash22(hcell + vec2(dustFrame * 5.7 + uDustSalt, 2.0));
    float angle = hash21(hcell + 11.1) * 6.2831;
    float len = (0.06 + hash21(hcell + 13.3) * 0.24);
    vec2 b = a + vec2(cos(angle), sin(angle)) * len;
    float d = sdSegment(hlocal, a, b);
    float w = uPxH * 2.0;
    total += (1.0 - smoothstep(w, w * 2.5, d)) * (0.1 + hash21(hcell + 3.7) * 0.2);
  }

  return total * step(0.0001, uDust);
}

/** Projected-frame shading: hot centre, near-black corners. */
float vignetteAmount(vec2 duv) {
  if (uVignette <= 0.0) return 0.0;
  float maxR = length(vec2(uAspect, 1.0) * 0.5);
  float r = length((duv - 0.5) * vec2(uAspect, 1.0));
  float t = clamp((r - 0.3) / max(0.0001, maxR - 0.3), 0.0, 1.0);
  // Same two-segment ramp the canvas gradient used (0 → 0.35 → 0.95).
  float v = t < 0.6 ? mix(0.0, 0.35, t / 0.6) : mix(0.35, 0.95, (t - 0.6) / 0.4);
  return v * uVignette;
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`

// ---- Film Stock: the opaque background. Composited in sRGB (exactly like the
// canvas version did) and converted once at the end, so the wear keeps its
// authored contrast instead of vanishing into a near-black linear base.
const STOCK_FRAGMENT = FILM_COMMON + `
uniform vec3 uBase;
uniform vec3 uFlashColor;
uniform float uGrid;
uniform float uScratch;      // wandering scratch alpha (0 = none this frame)
uniform float uScratchX;     // its position, in height units
uniform vec3 uFlashes[${MAX_MARKS}];  // x, y (uv), intensity
uniform vec3 uStreaks[${MAX_MARKS}];  // x (height units), halfWidth, intensity

float gridLine(float coord, float spacing) {
  float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(uPxH * 0.5, uPxH * 1.5, d);
}

void main() {
  vec2 duv = barrel(vUv);
  vec2 hc = vec2(duv.x * uAspect, duv.y);

  vec3 col = uBase;

  // Faint graph grid, bowed along with everything else by the warp.
  if (uGrid > 0.0) {
    float grid = max(gridLine(hc.x, 0.0254), gridLine(hc.y, 0.0254));
    col += grid * uGrid * 0.07;
  }

  // Burn flashes: a warm bloom added where a note struck (additive, like the
  // canvas 'lighter' pass).
  for (int i = 0; i < ${MAX_MARKS}; i++) {
    vec3 f = uFlashes[i];
    if (f.z <= 0.0) continue;
    float d = distance(hc, vec2(f.x * uAspect, f.y)) / 0.7;
    col += uFlashColor * max(0.0, 1.0 - d) * f.z;
  }

  vec2 grain = grainMarks(hc);
  col = col * (1.0 - grain.x) + grain.y;
  col += dustMarks(hc);

  // The wandering scratch, plus any note-driven streak burst.
  if (uScratch > 0.0) {
    float d = abs(hc.x - uScratchX);
    col += (1.0 - smoothstep(uPxH * 0.75, uPxH * 2.0, d)) * uScratch;
  }
  for (int i = 0; i < ${MAX_MARKS}; i++) {
    vec3 s = uStreaks[i];
    if (s.z <= 0.0) continue;
    float d = abs(hc.x - s.x);
    col += (1.0 - smoothstep(s.y, s.y * 2.5, d)) * s.z;
  }

  // Flicker, vignette, then the projector surround close the frame.
  col = uFlicker < 0.0 ? col * (1.0 + uFlicker) : col * (1.0 - uFlicker) + uFlicker;
  col = mix(col, vec3(0.0), vignetteAmount(duv));
  col *= frameMask(duv);

  gl_FragColor = vec4(srgbToLinear(clamp(col, 0.0, 1.0)), uOpacity);
}`

// ---- Film Grain: the transparent overlay. Alpha blending can only lerp
// toward ONE colour, so the frame's darkening (D) and lightening (B) are
// accumulated separately and folded into a single (colour, alpha) that
// reproduces "darken, then lighten": dst·(1-D)(1-B) + B.
const GRAIN_FRAGMENT = FILM_COMMON + `
uniform float uStatic;

// Analog STATIC: dense horizontal scratch-hatch strokes covering the frame -
// hundreds of short gray-white dashes re-rolled every film frame (the TV-noise
// burst of the Monochrome reference, distinct from film dust's specks).
float staticMarks(vec2 hc) {
  if (uStatic <= 0.0) return 0.0;
  float rows = 92.0;
  float cells = 5.0;
  vec2 c = vec2(floor(hc.x * cells), floor(hc.y * rows));
  vec2 l = vec2(fract(hc.x * cells), fract(hc.y * rows));
  float present = hash21(c + vec2(uFrame * 23.7, uFrame * 5.3));
  // Coverage scales with the burst: full static is a near-solid scribble.
  if (present > uStatic * 0.85) return 0.0;
  float x0 = hash21(c + vec2(uFrame * 3.1, 7.7)) * 0.7;
  float len = 0.2 + hash21(c + vec2(uFrame * 9.3, 3.9)) * 0.8;
  float inx = step(x0, l.x) * step(l.x, x0 + len);
  float iny = smoothstep(0.52, 0.30, abs(l.y - 0.5));
  return inx * iny * (0.2 + hash21(c + 1.1) * 0.55);
}

void main() {
  vec2 duv = barrel(vUv);
  vec2 hc = vec2(duv.x * uAspect, duv.y);

  vec2 grain = grainMarks(hc);
  float dark = grain.x;
  float bright = grain.y + dustMarks(hc) + staticMarks(hc);

  if (uFlicker < 0.0) dark = 1.0 - (1.0 - dark) * (1.0 + uFlicker);
  else bright = bright + uFlicker;

  dark = 1.0 - (1.0 - dark) * (1.0 - vignetteAmount(duv));

  // The projector surround, opaque, so the bowed frame edge reads on the
  // COMPOSITED image (words included) and not just on this layer.
  float mask = frameMask(duv);
  dark = max(dark, 1.0 - mask);
  bright *= mask;

  dark = clamp(dark, 0.0, 1.0);
  bright = clamp(bright, 0.0, 1.0);
  float a = 1.0 - (1.0 - dark) * (1.0 - bright);
  if (a <= 0.0001) discard;
  gl_FragColor = vec4(vec3(bright / a), a * uOpacity);
}`

/** Parse '#rrggbb' into raw sRGB components. Deliberately NOT three's Color:
 *  the shaders composite in sRGB (as the canvas implementation did) and
 *  convert once at the end, so they need the authored values, not linear ones. */
function srgb(hex: string | undefined, fallback: string, out: Vector3): Vector3 {
  const value = parseInt((hex || fallback).slice(1), 16)
  if (Number.isNaN(value)) return out.set(0, 0, 0)
  return out.set(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

/** The uniforms every film shader shares, freshly allocated per instance. */
function commonUniforms() {
  return {
    uAspect: { value: 1 },
    uPxH: { value: 1 / 1080 },
    uFrame: { value: 0 },
    uGrain: { value: 0.55 },
    uGrainSize: { value: 2 },
    uDust: { value: 0.5 },
    uFlicker: { value: 0 },
    uVignette: { value: 0.65 },
    uWarp: { value: 0.2 },
    uDustSalt: { value: 0 },
    uOpacity: { value: 1 },
  }
}

/** Beat-quantized film time plus the frame-wide values both shaders need. */
function filmFrameValues(beat: number, secPerBeat: number, flicker: number) {
  const frame = Math.floor(beat * secPerBeat * FILM_FPS)
  const elapsed = frame / FILM_FPS
  // Luminance wobble: one signed alpha per 18fps tick, sized like the canvas
  // version (black washes bite harder than white ones).
  const f = (seededRand(Math.floor(elapsed * 18) * 31 + 5) - 0.5) * 2 * flicker
  const signedFlicker = Math.min(0.5, Math.abs(f) * (f < 0 ? 0.09 : 0.06)) * (f < 0 ? -1 : 1)
  return { frame, elapsed, signedFlicker }
}

// ---------------------------------------------------------------------------
// Film Stock - the background.
// ---------------------------------------------------------------------------

const STOCK_PARAMS: ParamDef[] = [
  { key: 'baseColor', label: 'Stock Color', type: 'color', default: '#1a171b' },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'scratch', label: 'Wandering Scratch', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'grid', label: 'Graph Grid', min: 0, max: 1, step: 0.05, default: 0.25 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.65 },
  { key: 'warp', label: 'Barrel Warp', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'flashColor', label: 'Burn Flash Color', type: 'color', default: '#ffe3b8' },
  { key: 'flashDur', label: 'Flash Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.5 },
]

function FilmStockVisual({ trackId }: { trackId: string }) {
  const { viewport, size } = useThree()
  const meshRef = useRef<Mesh>(null)

  const uniforms = useMemo(() => ({
    ...commonUniforms(),
    uBase: { value: new Vector3(0.102, 0.09, 0.106) },
    uFlashColor: { value: new Vector3(1, 0.89, 0.72) },
    uGrid: { value: 0.25 },
    uScratch: { value: 0 },
    uScratchX: { value: -1 },
    uFlashes: { value: Array.from({ length: MAX_MARKS }, () => new Vector3()) },
    uStreaks: { value: Array.from({ length: MAX_MARKS }, () => new Vector3()) },
  }), [])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false

    // No block at this beat = nothing on screen (blocks are the on-region).
    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const sp = state.stringParams
    const u = (mesh.material as ShaderMaterial).uniforms
    const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
    const { frame, elapsed, signedFlicker } = filmFrameValues(state.beat, state.secPerBeat, p.flicker ?? 0.35)

    u.uAspect.value = aspect
    u.uPxH.value = 1 / Math.max(1, size.height * viewport.dpr)
    u.uFrame.value = frame
    u.uGrain.value = p.grain ?? 0.55
    u.uGrainSize.value = p.grainSize ?? 2
    u.uDust.value = p.dust ?? 0.5
    u.uFlicker.value = signedFlicker
    u.uVignette.value = p.vignette ?? 0.65
    u.uWarp.value = p.warp ?? 0.2
    u.uGrid.value = p.grid ?? 0.25
    u.uOpacity.value = (mesh.material as ShaderMaterial).opacity
    srgb(sp.baseColor, '#1a171b', u.uBase.value as Vector3)
    srgb(sp.flashColor, '#ffe3b8', u.uFlashColor.value as Vector3)

    // The wandering full-height scratch: present in seeded ~2.5s windows, its
    // x jittering within the window.
    const scratchAmount = p.scratch ?? 0.5
    const windowIndex = Math.floor(elapsed * 0.4)
    if (scratchAmount > 0 && seededRand(windowIndex * 7919 + 3) < scratchAmount * 0.6) {
      const baseX = seededRand(windowIndex * 4271 + 9) * aspect
      u.uScratchX.value = baseX + (seededRand(frame * 53 + 1) - 0.5) * 0.008
      u.uScratch.value = 0.08 + seededRand(windowIndex * 31 + 2) * 0.1
    } else {
      u.uScratch.value = 0
    }

    // Note-driven marks. Only the freshest few of each kind reach the shader -
    // its arrays are fixed-size, and more than a handful would be mud anyway.
    const flashes = u.uFlashes.value as Vector3[]
    const streaks = u.uStreaks.value as Vector3[]
    for (let i = 0; i < MAX_MARKS; i++) { flashes[i].set(0, 0, 0); streaks[i].set(0, 0, 0) }
    const flashDur = p.flashDur ?? 0.5
    let flashCount = 0
    let streakCount = 0
    for (const n of state.notes) {
      const age = elapsed - n.beat * state.secPerBeat
      if (age < 0) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      if (n.pitch < 64) {
        if (age >= flashDur || flashCount >= MAX_MARKS) continue
        const k = 1 - age / flashDur
        flashes[flashCount++].set(
          0.3 + seededRand(n.beat * 13 + n.pitch) * 0.4,
          0.3 + seededRand(n.beat * 17 + n.pitch) * 0.4,
          k * k * velN * 0.55,
        )
      } else if (age < 0.4 && streakCount < MAX_MARKS) {
        const k = 1 - age / 0.4
        const s = n.beat * 977 + n.pitch * 31
        streaks[streakCount++].set(
          seededRand(s) * aspect + (seededRand(frame + s) - 0.5) * 0.014,
          Math.max(u.uPxH.value * 0.75, seededRand(s + 2) * 0.0015),
          k * (0.1 + seededRand(s + 1) * 0.18),
        )
      }
    }
  })

  return (
    <mesh ref={meshRef} renderOrder={-9999}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <shaderMaterial
        key="film-stock-v1"
        vertexShader={FILM_VERTEX}
        fragmentShader={STOCK_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
        userData={{ [FORCE_TRANSPARENT_KEY]: true }}
      />
    </mesh>
  )
}

export const filmStockInstrument: ObjectInstrumentDef = {
  id: 'filmStock',
  name: 'Film Stock',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: STOCK_PARAMS,
  midiRows: [
    { pitch: 64, label: 'Scratch streak', color: '#cccccc', emphasized: true },
    { pitch: 60, label: 'Burn flash', color: '#f0b41c' },
  ],
  component: FilmStockVisual,
  fullFrame: true,
}

// ---------------------------------------------------------------------------
// Film Grain - the on-top degradation overlay.
// ---------------------------------------------------------------------------

const GRAIN_PARAMS: ParamDef[] = [
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'grainSize', label: 'Grain Size', min: 1, max: 4, step: 1, default: 2 },
  { key: 'dust', label: 'Dust', min: 0, max: 1, step: 0.05, default: 0.3 },
  // Constant analog-static level; the Static burst MIDI row adds on top.
  { key: 'static', label: 'Static', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'warp', label: 'Barrel Warp', min: 0, max: 1, step: 0.05, default: 0.2 },
]

function FilmGrainVisual({ trackId }: { trackId: string }) {
  const { viewport, size } = useThree()
  const meshRef = useRef<Mesh>(null)
  const uniforms = useMemo(() => ({ ...commonUniforms(), uDustSalt: { value: 137 }, uStatic: { value: 0 } }), [])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false

    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const u = (mesh.material as ShaderMaterial).uniforms
    const { elapsed, frame, signedFlicker } = filmFrameValues(state.beat, state.secPerBeat, p.flicker ?? 0.35)

    // Note vocabulary: static bursts (pitch < 60) hold the scratch-hatch on
    // while the note sounds (a hard on/off, like TV noise cutting in); dust
    // bursts (60-61) thicken the speck field; flicker pops (>= 62) slam the
    // wobble amplitude for a beat-blink.
    let burst = 0
    let flickerBoost = 1
    let staticEnv = 0
    for (const n of state.notes) {
      const age = elapsed - n.beat * state.secPerBeat
      if (age < 0) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      if (n.pitch < 60) {
        const holdSec = Math.max(0.08, n.durationBeats * state.secPerBeat)
        if (age < holdSec) staticEnv = Math.max(staticEnv, velN)
      } else if (n.pitch < 62) {
        if (age < 0.35) burst = Math.max(burst, (1 - age / 0.35) * velN)
      } else if (age < 0.15) {
        flickerBoost = Math.max(flickerBoost, 1 + (1 - age / 0.15) * velN * 4)
      }
    }

    u.uAspect.value = viewport.height > 0 ? viewport.width / viewport.height : 1
    u.uPxH.value = 1 / Math.max(1, size.height * viewport.dpr)
    u.uFrame.value = frame
    u.uGrain.value = p.grain ?? 0.35
    u.uGrainSize.value = p.grainSize ?? 2
    u.uDust.value = Math.min(1, (p.dust ?? 0.3) + burst * 0.6)
    u.uStatic.value = Math.min(1, (p.static ?? 0) + staticEnv)
    u.uFlicker.value = Math.max(-0.9, Math.min(0.9, signedFlicker * flickerBoost))
    u.uVignette.value = p.vignette ?? 0.55
    u.uWarp.value = p.warp ?? 0.2
    u.uOpacity.value = (mesh.material as ShaderMaterial).opacity
  })

  // High renderOrder + no depth test: this plane composites after everything
  // else in its (front) scene - including on-top text - which is the point.
  // FORCE_TRANSPARENT: the shader's output is mostly near-zero alpha, and the
  // opacity wrapper would otherwise flip `transparent` off at opacity 1.
  return (
    <mesh ref={meshRef} renderOrder={9999}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <shaderMaterial
        key="film-grain-v1"
        vertexShader={FILM_VERTEX}
        fragmentShader={GRAIN_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        userData={{ [FORCE_TRANSPARENT_KEY]: true }}
      />
    </mesh>
  )
}

export const filmGrainInstrument: ObjectInstrumentDef = {
  id: 'filmGrain',
  name: 'Film Grain',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: GRAIN_PARAMS,
  midiRows: [
    { pitch: 62, label: 'Flicker pop', color: '#ffffff', emphasized: true },
    { pitch: 60, label: 'Dust burst', color: '#e8e4da' },
    { pitch: 56, label: 'Static burst (held)', color: '#9aa3b5' },
  ],
  component: FilmGrainVisual,
  fullFrame: true,
  defaultOnTop: true,
}
