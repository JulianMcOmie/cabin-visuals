import { Fragment, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  BufferGeometry,
  Float32BufferAttribute,
  Scene as ThreeScene,
  WebGLRenderTarget,
  HalfFloatType,
  LinearFilter,
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusDstColorFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  PMREMGenerator,
  NoToneMapping,
  Vector2,
  Vector3,
  type Texture,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { BloomEffect } from 'postprocessing'
import { getCompositionLayers, getObjectState, setMountedRenderScenes, subscribeObjects, getObjectList, type ObjectListEntry } from '../../core/visual/VisualEngine'
import type { CompositionLayer } from '../../core/directors'
import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { isOnTopTrack } from '../../instruments/types'
import { DEFAULT_SCENE_BACKGROUND, type Scene, type SceneGradient } from '../../types'
import { ObjectRenderer } from './ObjectRenderer'
import { FinalInvertMaskContext } from '../../core/visual/finalInvertMask'
import { resolveActiveColorFilter } from '../../instruments/ColorFilters'
import { resolveActiveStrobe } from '../../instruments/Strobe'
import { BASS_RIPPLE_FIELD_GLSL, resolveActiveBassRipple } from '../../instruments/BassRipple'
import { IMPACT_WARP_FIELD_GLSL, resolveActiveImpactWarp } from '../../instruments/ImpactWarp'
import { CROP_MASK_FRAGMENT, resolveActiveCropMask } from '../../instruments/Crop'
import { MAX_DIVISIONS as CROP_MAX_DIVISIONS } from '../../core/directors/crop'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { useTimeStore } from '../../store/TimeStore'

RectAreaLightUniformsLib.init()

interface MountedScene {
  base: ThreeScene
  front: ThreeScene
  invert: ThreeScene
  target: WebGLRenderTarget
  invertTarget: WebGLRenderTarget
  filterTargets: [WebGLRenderTarget, WebGLRenderTarget]
  outputTexture: Texture
}

interface PartitionUniforms {
  radial: { value: number }
  slice: { value: number }
  angle: { value: number }
  wedge: { value: number }
  flash: { value: number }
  blur: { value: number }
  index: { value: number }
  count: { value: number }
  aspect: { value: number }
}

function disposeMountedScene(runtime: MountedScene) {
  runtime.target.dispose()
  runtime.invertTarget.dispose()
  runtime.filterTargets.forEach((target) => target.dispose())
}

function makeCompositorGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(8), 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

const COLOR_FILTER_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

// Backdrop gradient, painted over the clear color before a scene's objects
// render. Geometry (t) reproduces CSS gradients exactly - linear projects onto
// the gradient line with CSS's |W sin| + |H cos| line length so the stops land
// on the corners, radial is a from-center circle reaching the farthest corner -
// and the stops MIX in sRGB (what CSS does) before converting to the
// renderer's linear working space, so the inspector's CSS previews and the
// real backdrop are the same picture.
const BACKDROP_GRADIENT_FRAGMENT = `
uniform vec3 colorFrom;
uniform vec3 colorTo;
uniform float kind;      // 0 linear, 1 mirror, 2 radial
uniform float angle;     // radians, CSS convention: 0 points up, clockwise
uniform vec2 resolution;
varying vec2 vUv;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main() {
  vec2 p = (vUv - 0.5) * resolution;
  float t;
  if (kind > 1.5) {
    t = length(p) / max(0.5 * length(resolution), 1e-4);
  } else {
    vec2 dir = vec2(sin(angle), cos(angle));
    float len = abs(resolution.x * dir.x) + abs(resolution.y * dir.y);
    t = dot(p, dir) / max(len, 1e-4) + 0.5;
    if (kind > 0.5) t = 1.0 - abs(2.0 * t - 1.0); // mirror: from at both edges
  }
  gl_FragColor = vec4(srgbToLinear(mix(colorFrom, colorTo, clamp(t, 0.0, 1.0))), 1.0);
}`

/** The scene's enabled backdrop gradient, or null when it wears a flat color
 * or exports with alpha (same precedence as sceneBackdropMode). */
function activeBackdropGradient(scene: Scene | undefined): SceneGradient | null {
  if (!scene || scene.backgroundTransparent) return null
  return scene.backgroundGradient?.enabled ? scene.backgroundGradient : null
}

/** Writes a #rrggbb hex into `out` as RAW sRGB 0..1 components - deliberately
 * NOT converted to working space; the gradient shader mixes in sRGB and does
 * its own conversion. */
function setHexSrgb(out: Vector3, hex: string) {
  const n = parseInt(hex.slice(1), 16)
  out.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const COLOR_FILTER_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float mode;
uniform float amount;
uniform float time;
varying vec2 vUv;

vec3 hueShift(vec3 color, float turns) {
  vec3 axis = normalize(vec3(1.0));
  float angle = turns * 6.28318530718;
  return color * cos(angle)
    + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1.0 - cos(angle));
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  vec3 color = source.rgb;
  float hdrScale = max(1.0, max(color.r, max(color.g, color.b)));
  vec3 working = color / hdrScale;
  float luma = dot(working, vec3(0.2126, 0.7152, 0.0722));
  vec3 filtered = working;

  if (mode < 1.5) {
    filtered = vec3(1.0) - working;
  } else if (mode < 2.5) {
    filtered = vec3(1.0) - abs(working * 2.0 - vec3(1.0));
  } else if (mode < 3.5) {
    filtered = working.gbr;
  } else if (mode < 4.5) {
    filtered = working.brg;
  } else if (mode < 5.5) {
    filtered = vec3(
      smoothstep(0.0, 0.55, luma),
      smoothstep(0.25, 0.78, luma),
      smoothstep(0.62, 1.0, luma)
    );
  } else if (mode < 6.5) {
    vec3 shadow = vec3(0.015, 0.02, 0.16);
    vec3 light = vec3(1.0, 0.02, 0.62);
    filtered = mix(shadow, light, smoothstep(0.05, 0.95, luma));
    filtered += vec3(0.0, 0.35, 0.45) * smoothstep(0.55, 1.0, working.g);
  } else if (mode < 7.5) {
    filtered = floor(working * 4.0 + 0.5) / 4.0;
  } else if (mode < 8.5) {
    filtered = 0.5 + 0.5 * cos(6.28318530718 * (luma + vec3(0.0, 0.33, 0.67)));
  } else if (mode < 9.5) {
    filtered = hueShift(working, 0.16 + mod(time * 0.035, 1.0));
  } else if (mode < 10.5) {
    // Strobe · blackout. Modes 10 and 11 belong to the Strobe instrument, which
    // maps its styles onto this shader's numbering (instruments/Strobe.tsx).
    // Color Filters' own rows only reach mode 9, so the two strobe-only looks
    // stay out of that instrument's vocabulary.
    filtered = vec3(0.0);
  } else {
    // Strobe · flash. hdrScale carries this back up to the frame's own headroom
    // below, so a white flash over a bright scene is as bright as that scene.
    filtered = vec3(1.0);
  }

  filtered *= hdrScale;
  gl_FragColor = vec4(mix(color, clamp(filtered, 0.0, hdrScale), amount), source.a);
}`

/** Scene-wide positional warp. Displaces each pixel by a fractal value-noise
 *  field, sampled twice at decorrelated offsets for the x and y components.
 *  Noise rather than a radial sine: a sine has a visible center and visible
 *  rings, noise has neither, so low strengths read as haze rather than effect. */
const WARP_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float scale;
uniform float speed;
uniform float time;
uniform float aspect;
varying vec2 vUv;

${BASS_RIPPLE_FIELD_GLSL}

void main() {
  vec2 offset = bassRippleOffset(vUv, amount, scale, speed, time, aspect);
  gl_FragColor = texture2D(tDiffuse, clamp(vUv + offset, 0.0, 1.0));
}`

/** The percussive counterpart: a triggered, single-strike displacement in one of
 *  four shapes, plus the channel split that makes a hit read as a hit
 *  (instruments/ImpactWarp.tsx owns the field, the split and the style enum). */
const IMPACT_WARP_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float style;
uniform float amount;
uniform vec2 dir;
uniform float phase;
uniform float size;
uniform float seed;
uniform float aspect;
varying vec2 vUv;

${IMPACT_WARP_FIELD_GLSL}

void main() {
  vec2 offset = impactWarpOffset(vUv, style, amount, dir, phase, size, seed, aspect);
  vec2 split = impactWarpSplit(offset);
  vec4 mid = texture2D(tDiffuse, impactWarpWrap(vUv + offset));
  float red = texture2D(tDiffuse, impactWarpWrap(vUv + offset + split)).r;
  float blue = texture2D(tDiffuse, impactWarpWrap(vUv + offset - split)).b;
  gl_FragColor = vec4(red, mid.g, blue, mid.a);
}`

const FINAL_GRADE_FRAGMENT = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 resolution;
uniform float time;
uniform float bloomIntensity;
uniform float rawGrade;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 fxaa(vec2 uv) {
  vec2 inverseResolution = 1.0 / resolution;
  vec3 rgbNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * inverseResolution).rgb;
  vec3 rgbNE = texture2D(tScene, uv + vec2( 1.0, -1.0) * inverseResolution).rgb;
  vec3 rgbSW = texture2D(tScene, uv + vec2(-1.0,  1.0) * inverseResolution).rgb;
  vec3 rgbSE = texture2D(tScene, uv + vec2( 1.0,  1.0) * inverseResolution).rgb;
  vec3 rgbM = texture2D(tScene, uv).rgb;
  vec3 lumaWeights = vec3(0.299, 0.587, 0.114);
  float lumaNW = dot(rgbNW, lumaWeights);
  float lumaNE = dot(rgbNE, lumaWeights);
  float lumaSW = dot(rgbSW, lumaWeights);
  float lumaSE = dot(rgbSE, lumaWeights);
  float lumaM = dot(rgbM, lumaWeights);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  vec2 direction;
  direction.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  direction.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
  float directionReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  float inverseDirectionMin = 1.0 / (min(abs(direction.x), abs(direction.y)) + directionReduce);
  direction = clamp(direction * inverseDirectionMin, vec2(-8.0), vec2(8.0)) * inverseResolution;

  vec3 rgbA = 0.5 * (
    texture2D(tScene, uv + direction * (1.0 / 3.0 - 0.5)).rgb +
    texture2D(tScene, uv + direction * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture2D(tScene, uv + direction * -0.5).rgb +
    texture2D(tScene, uv + direction * 0.5).rgb
  );
  float lumaB = dot(rgbB, lumaWeights);
  return (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
}

void main() {
  vec4 source = texture2D(tScene, vUv);
  vec3 color = fxaa(vUv) + texture2D(tBloom, vUv).rgb * bloomIntensity;

  // rawGrade bypasses the stylistic grade (saturation/contrast/vignette/
  // grain), for instruments that reproduce external footage color-exactly
  // (Polyester Edit). FXAA and bloom still apply.
  if (rawGrade < 0.5) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, 1.08);
    color = (color - 0.5) * 1.045 + 0.5;

    vec2 centered = vUv - 0.5;
    centered.x *= resolution.x / max(1.0, resolution.y);
    float vignette = smoothstep(0.92, 0.20, length(centered));
    color *= mix(0.82, 1.0, vignette);

    float grain = hash(gl_FragCoord.xy + vec2(time * 19.7, time * 7.3)) - 0.5;
    color += grain * 0.014;
  }
  gl_FragColor = vec4(max(color, 0.0), source.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** Shape one compositor quad into a full-height screen partition while keeping
 * UVs in final-frame coordinates, so each scene is cropped rather than squeezed. */
function setPartitionGeometry(geometry: BufferGeometry, partition?: CompositionLayer['partition']) {
  const linear = partition?.kind === 'linear' ? partition : undefined
  const count = linear ? Math.max(1, linear.count) : 1
  const start = linear ? linear.index / count : 0
  const end = linear ? (linear.index + 1) / count : 1
  const halfSlant = (linear?.slant ?? 0) / 2
  const xs = [start - halfSlant, end - halfSlant, end + halfSlant, start + halfSlant]
  const ys = [0, 0, 1, 1]
  const positions = geometry.getAttribute('position') as Float32BufferAttribute
  const uvs = geometry.getAttribute('uv') as Float32BufferAttribute
  for (let i = 0; i < 4; i++) {
    positions.setXYZ(i, -1 + xs[i] * 2, -1 + ys[i] * 2, 0)
    uvs.setXY(i, xs[i], ys[i])
  }
  positions.needsUpdate = true
  uvs.needsUpdate = true
}

function makeCompositorMaterial(invertBehind = false) {
  const uniforms: PartitionUniforms = {
    radial: { value: 0 },
    slice: { value: 0 },
    angle: { value: 0 },
    wedge: { value: 0 },
    flash: { value: 0 },
    blur: { value: 0 },
    index: { value: 0 },
    count: { value: 1 },
    aspect: { value: 1 },
  }
  const material = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false })
  if (invertBehind) {
    // The mask is a premultiplied white glyph. This blend computes, per channel:
    // alpha * (1 - destination) + destination * (1 - alpha).
    material.premultipliedAlpha = true
    material.blending = CustomBlending
    material.blendEquation = AddEquation
    material.blendSrc = OneMinusDstColorFactor
    material.blendDst = OneMinusSrcAlphaFactor
    material.blendSrcAlpha = OneFactor
    material.blendDstAlpha = OneMinusSrcAlphaFactor
  }
  material.userData.partitionUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      partitionRadial: uniforms.radial,
      partitionSlice: uniforms.slice,
      partitionAngle: uniforms.angle,
      partitionWedge: uniforms.wedge,
      partitionFlash: uniforms.flash,
      partitionBlur: uniforms.blur,
      partitionIndex: uniforms.index,
      partitionCount: uniforms.count,
      partitionAspect: uniforms.aspect,
    })
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vPartitionUv;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPartitionUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
varying vec2 vPartitionUv;
uniform float partitionRadial;
uniform float partitionSlice;
uniform float partitionAngle;
uniform float partitionWedge;
uniform float partitionFlash;
uniform float partitionBlur;
uniform float partitionIndex;
uniform float partitionCount;
uniform float partitionAspect;
void main() {`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
vec4 partitionSampled;
if (partitionBlur > 0.0) {
  vec2 pb = vPartitionUv - vec2(0.5);
  pb.x *= partitionAspect;
  // Smear along the axis the mask is organized by: across the bands for a
  // linear cut, outward from the center for a radial one.
  vec2 dir = partitionWedge > 0.5
    ? normalize(pb + vec2(1e-6))
    : vec2(cos(partitionAngle), sin(partitionAngle));
  // Back to uv space, undoing the aspect correction on x.
  vec2 step = vec2(dir.x / partitionAspect, dir.y) * partitionBlur;
  partitionSampled = vec4(0.0);
  for (int i = 0; i < 9; i++) {
    partitionSampled += texture2D(map, vPartitionUv + step * (float(i) / 8.0 - 0.5));
  }
  partitionSampled /= 9.0;
} else {
  partitionSampled = texture2D(map, vPartitionUv);
}
diffuseColor *= partitionSampled;
#endif
`)
      .replace('#include <clipping_planes_fragment>', `
#include <clipping_planes_fragment>
if (partitionRadial > 0.5) {
  vec2 p = vPartitionUv - vec2(0.5);
  p.x *= partitionAspect;
  float maxRadius = 0.5 * length(vec2(partitionAspect, 1.0));
  float radius = length(p) / maxRadius;
  float outerRadius = (partitionIndex + 1.0) / partitionCount;
  if (radius > outerRadius) discard;
}
if (partitionSlice > 0.5) {
  // Aspect-corrected frame space, so a band's width is its true on-screen
  // width rather than a UV width that stretches with the viewport.
  vec2 p = vPartitionUv - vec2(0.5);
  p.x *= partitionAspect;
  float t;
  if (partitionWedge > 0.5) {
    // Radial: even wedges about the aspect-corrected center. Every pixel has an
    // angle, so the frame is covered by construction - no span to derive.
    t = fract((atan(p.y, p.x) - partitionAngle) / 6.2831853);
  } else {
    vec2 n = vec2(cos(partitionAngle), sin(partitionAngle));
    // Half-extent of the frame measured along the cut normal - the projection of
    // the furthest corner onto n. Deriving the band span from this (rather than
    // from a fixed axis) is what guarantees the outermost bands reach the corners
    // at every angle, with no uncovered wedge.
    float halfSpan = 0.5 * (partitionAspect * abs(n.x) + abs(n.y));
    t = (dot(p, n) + halfSpan) / (2.0 * halfSpan);
  }
  // Bands are even in t, which is distance along the normal - so they are even
  // in PERPENDICULAR width at any angle.
  float band = floor(clamp(t, 0.0, 0.999999) * partitionCount);
  if (abs(band - partitionIndex) > 0.5) discard;
}`)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <premultiplied_alpha_fragment>',
      `if (partitionFlash > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.15), partitionFlash);
#include <premultiplied_alpha_fragment>`,
    )
    if (invertBehind) {
      // Use the mask alpha as premultiplied white regardless of the offscreen
      // mask's RGB encoding, effects, or antialias interpolation.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <premultiplied_alpha_fragment>',
        'gl_FragColor.rgb = vec3(gl_FragColor.a);',
      )
    }
  }
  material.customProgramCacheKey = () => invertBehind ? 'scene-partition-invert-v3' : 'scene-partition-v3'
  return material
}

/** Point one compositor quad at `layer`: texture, opacity, partition geometry +
 * uniforms, viewport placement, render order. Shared by the scene-layer meshes
 * and the final-invert meshes, which differ ONLY in the texture they sample -
 * these assignments were duplicated verbatim before this helper, and a new mask
 * field silently reaching one loop but not the other is exactly the bug that
 * duplication invites. */
function applyCompositorLayer(
  mesh: Mesh,
  layer: CompositionLayer,
  index: number,
  texture: Texture,
  aspect: number,
) {
  const material = mesh.material as MeshBasicMaterial
  if (material.map !== texture) {
    material.map = texture
    material.needsUpdate = true
  }
  material.opacity = layer.opacity
  setPartitionGeometry(mesh.geometry, layer.partition)
  const uniforms = material.userData.partitionUniforms as PartitionUniforms
  const radial = layer.partition?.kind === 'radial' ? layer.partition : undefined
  const slice = layer.partition?.kind === 'slice' ? layer.partition : undefined
  uniforms.radial.value = radial ? 1 : 0
  uniforms.slice.value = slice ? 1 : 0
  // Degrees on the contract (what the director exposes), radians in the
  // shader, converted once here rather than per fragment.
  uniforms.angle.value = ((slice?.angle ?? 0) * Math.PI) / 180
  uniforms.index.value = slice?.index ?? radial?.radiusIndex ?? radial?.index ?? 0
  uniforms.count.value = Math.max(1, slice?.count ?? radial?.count ?? 1)
  uniforms.aspect.value = aspect
  uniforms.wedge.value = slice?.radial ? 1 : 0
  uniforms.flash.value = layer.flash ?? 0
  uniforms.blur.value = layer.blur ?? 0
  if (layer.partition) {
    mesh.position.set(0, 0, -index * 0.001)
    mesh.scale.set(1, 1, 1)
  } else {
    mesh.position.set(
      -1 + layer.viewport.x * 2 + layer.viewport.width,
      -1 + layer.viewport.y * 2 + layer.viewport.height,
      -index * 0.001,
    )
    mesh.scale.set(layer.viewport.width, layer.viewport.height, 1)
  }
  mesh.renderOrder = index
}

function lights() {
  return (
    <>
      <ambientLight intensity={0.12} />
      <hemisphereLight color="#dbeafe" groundColor="#170921" intensity={0.55} />
      <rectAreaLight position={[4, 4, 5]} rotation={[-0.62, 0.62, 0]} color="#fff7ed" intensity={6} width={5} height={5} />
      <directionalLight
        position={[4, 7, 5]}
        intensity={2.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-camera-near={0.1}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      />
      <pointLight position={[-4, 2, -3]} color="#60a5fa" intensity={7} distance={20} decay={2} />
      <pointLight position={[3, -1, 3]} color="#fb7185" intensity={3.5} distance={16} decay={2} />
    </>
  )
}

/**
 * Scene id → the track ids of every object using `instrumentId`, in resolve
 * order. The scene-wide post-process instruments (Bass Ripple, Color Filters,
 * Strobe) all need this same grouping to drive their compositor passes.
 *
 * De-duplicated by track: one track resolves to an entry per VisualCopy
 * occurrence, and these instruments post-process the whole scene once - running
 * a pass per copy would just apply the same filter several times over.
 */
function postProcessTracksByScene(objects: readonly ObjectListEntry[], instrumentId: string) {
  const byScene = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const object of objects) {
    if (object.instrumentId !== instrumentId) continue
    const key = `${object.sceneId}:${object.trackId}`
    if (seen.has(key)) continue
    seen.add(key)
    const ids = byScene.get(object.sceneId) ?? []
    ids.push(object.trackId)
    byScene.set(object.sceneId, ids)
  }
  return byScene
}

/**
 * Every logical project scene stays mounted in its own literal THREE.Scene.
 * A second scene per runtime is the existing "In front" pass; a third holds
 * final-frame inversion masks. The compositor renders ordinary scene layers
 * first, then applies those masks against the combined result.
 *
 * The final compositor consumes an ORDERED ARRAY of layers. Today those layers
 * come from preview or Scene Switcher, but multiple directors already append
 * simultaneous layers without a singular active-scene assumption.
 */
export function VisualScene() {
  const objects = useSyncExternalStore(subscribeObjects, getObjectList, getObjectList)
  const { gl, camera, size } = useThree()
  const environment = useMemo(() => {
    const room = new RoomEnvironment()
    const pmrem = new PMREMGenerator(gl)
    const target = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    return target
  }, [gl])
  const sceneKey = [...new Set(objects.map((o) => o.sceneId))].sort().join(',')
  // Incremental scene mounting: runtimes are keyed by scene id and REUSED when
  // the scene set changes. Rebuilding the whole map on every add/remove would
  // remount every scene's object portals and dispose their render targets
  // mid-flight - the "adding a scene blanks unrelated scenes" bug. Creation
  // happens in render (new ids only, so a discarded render can only leak, never
  // break committed scenes); disposal of dropped runtimes waits for the commit
  // effect below.
  const prevMountedRef = useRef(new Map<string, MountedScene>())
  const mounted = useMemo(() => {
    const prev = prevMountedRef.current
    const map = new Map<string, MountedScene>()
    for (const sceneId of sceneKey ? sceneKey.split(',') : []) {
      const reused = prev.get(sceneId)
      if (reused) {
        map.set(sceneId, reused)
        continue
      }
      const options = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType }
      const maskOptions = { minFilter: LinearFilter, magFilter: LinearFilter }
      const width = Math.max(1, size.width)
      const height = Math.max(1, size.height)
      const target = new WebGLRenderTarget(width, height, options)
      map.set(sceneId, {
        base: new ThreeScene(),
        front: new ThreeScene(),
        invert: new ThreeScene(),
        target,
        invertTarget: new WebGLRenderTarget(width, height, maskOptions),
        filterTargets: [
          new WebGLRenderTarget(width, height, options),
          new WebGLRenderTarget(width, height, options),
        ],
        outputTexture: target.texture,
      })
    }
    return map
  // Scene structure changes on resolve; target resizing is handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  const compositor = useMemo(() => {
    const scene = new ThreeScene()
    const invertScene = new ThreeScene()
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
    cam.position.z = 1
    const meshes: Mesh[] = []
    const invertMeshes: Mesh[] = []
    const filterScene = new ThreeScene()
    const filterCam = new OrthographicCamera(-1, 1, 1, -1, 0, 2)
    filterCam.position.z = 1
    const filterMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: COLOR_FILTER_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        mode: { value: 0 },
        amount: { value: 1 },
        time: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const warpMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: WARP_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        amount: { value: 0 },
        scale: { value: 3 },
        speed: { value: 0.6 },
        time: { value: 0 },
        aspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const impactWarpMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: IMPACT_WARP_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        style: { value: 0 },
        amount: { value: 0 },
        dir: { value: new Vector2() },
        phase: { value: 0 },
        size: { value: 0.5 },
        seed: { value: 0 },
        aspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const cropMaskMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: CROP_MASK_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null as Texture | null },
        sliceState: { value: new Float32Array(CROP_MAX_DIVISIONS) },
        count: { value: 1 },
        angle: { value: 0 },
        wedge: { value: 0 },
        flash: { value: 0 },
        blur: { value: 0 },
        wet: { value: 1 },
        aspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const gradientMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: BACKDROP_GRADIENT_FRAGMENT,
      uniforms: {
        colorFrom: { value: new Vector3() },
        colorTo: { value: new Vector3() },
        kind: { value: 0 },
        angle: { value: 0 },
        resolution: { value: new Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    })
    const filterMesh = new Mesh(new PlaneGeometry(2, 2), filterMaterial)
    filterMesh.frustumCulled = false
    filterScene.add(filterMesh)
    const hdrOptions = { minFilter: LinearFilter, magFilter: LinearFilter, type: HalfFloatType }
    const compositeTarget = new WebGLRenderTarget(1, 1, hdrOptions)
    // Production mip-chain bloom from `postprocessing`. It extracts luminance
    // from the half-float scene buffer, then combines seven progressively wider
    // levels. HDR emitters create a tight core and long, smooth falloff without
    // geometry shells or hand-authored blur planes.
    const bloomEffect = new BloomEffect({
      luminanceThreshold: 1.15,
      luminanceSmoothing: 0.08,
      mipmapBlur: true,
      radius: 0.72,
      levels: 7,
    })
    bloomEffect.initialize(gl, true, HalfFloatType)
    const finalMaterial = new ShaderMaterial({
      vertexShader: COLOR_FILTER_VERTEX,
      fragmentShader: FINAL_GRADE_FRAGMENT,
      uniforms: {
        tScene: { value: compositeTarget.texture },
        tBloom: { value: bloomEffect.texture },
        resolution: { value: new Vector2(1, 1) },
        time: { value: 0 },
        bloomIntensity: { value: 0.9 },
        rawGrade: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    return {
      scene, invertScene, cam, meshes, invertMeshes,
      filterScene, filterCam, filterMesh, filterMaterial, warpMaterial, impactWarpMaterial, cropMaskMaterial, gradientMaterial,
      compositeTarget, bloomEffect, finalMaterial,
    }
  }, [gl])

  useEffect(() => {
    for (const runtime of mounted.values()) {
      runtime.target.setSize(Math.max(1, size.width), Math.max(1, size.height))
      runtime.invertTarget.setSize(Math.max(1, size.width), Math.max(1, size.height))
      runtime.filterTargets.forEach((target) => target.setSize(Math.max(1, size.width), Math.max(1, size.height)))
    }
    const width = Math.max(1, size.width)
    const height = Math.max(1, size.height)
    compositor.compositeTarget.setSize(width, height)
    compositor.bloomEffect.setSize(width, height)
    compositor.finalMaterial.uniforms.resolution.value.set(width, height)
  }, [compositor, mounted, size.width, size.height])

  useEffect(() => {
    for (const runtime of mounted.values()) {
      runtime.base.environment = environment.texture
      runtime.front.environment = environment.texture
    }
  }, [environment, mounted])

  useEffect(() => () => environment.dispose(), [environment])

  useEffect(() => {
    const roots = new Map<string, ThreeScene>()
    for (const [sceneId, runtime] of mounted) {
      roots.set(`${sceneId}:base`, runtime.base)
      roots.set(`${sceneId}:front`, runtime.front)
      roots.set(`${sceneId}:invert`, runtime.invert)
    }
    setMountedRenderScenes(roots)
    return () => setMountedRenderScenes(new Map())
  }, [mounted])

  // Commit the new mounted set and dispose ONLY the runtimes that fell out of
  // it - surviving scenes keep their THREE.Scenes and GPU targets untouched.
  useEffect(() => {
    const prev = prevMountedRef.current
    prevMountedRef.current = mounted
    for (const [sceneId, runtime] of prev) {
      if (mounted.get(sceneId) !== runtime) disposeMountedScene(runtime)
    }
  }, [mounted])

  // Prewarm shaders for scenes that exist but haven't been DRAWN yet. A scene
  // is only rendered once the composition requests it, and three compiles all
  // of its materials on that first draw - a synchronous multi-hundred-ms hitch
  // exactly when the user clicks into another scene (or the Scene Switcher
  // first cuts to it mid-playback). compileAsync uses the parallel-compile
  // extension off the render loop, so by switch time the programs are ready.
  // Delayed a tick so the portals' meshes have committed into the runtimes.
  const prewarmedRef = useRef(new Set<string>())
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const [sceneId, runtime] of mounted) {
        if (prewarmedRef.current.has(sceneId)) continue
        prewarmedRef.current.add(sceneId)
        void gl.compileAsync(runtime.base, camera).catch(() => {})
        void gl.compileAsync(runtime.front, camera).catch(() => {})
      }
      for (const sceneId of prewarmedRef.current) {
        if (!mounted.has(sceneId)) prewarmedRef.current.delete(sceneId)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [mounted, gl, camera])

  useEffect(() => () => {
    for (const runtime of prevMountedRef.current.values()) disposeMountedScene(runtime)
    prevMountedRef.current = new Map()
  }, [])

  useEffect(() => () => {
    for (const mesh of compositor.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    for (const mesh of compositor.invertMeshes) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    compositor.filterMesh.geometry.dispose()
    compositor.filterMaterial.dispose()
    compositor.warpMaterial.dispose()
    compositor.impactWarpMaterial.dispose()
    compositor.cropMaskMaterial.dispose()
    compositor.gradientMaterial.dispose()
    compositor.bloomEffect.dispose()
    compositor.finalMaterial.dispose()
    compositor.compositeTarget.dispose()
  }, [compositor])

  const bassRippleTrackIds = useMemo(() => postProcessTracksByScene(objects, 'bassRipple'), [objects])
  const impactWarpTrackIds = useMemo(() => postProcessTracksByScene(objects, 'impactWarp'), [objects])
  const colorFilterTrackIds = useMemo(() => postProcessTracksByScene(objects, 'colorFilters'), [objects])
  const strobeTrackIds = useMemo(() => postProcessTracksByScene(objects, 'strobe'), [objects])
  const cropTrackIds = useMemo(() => postProcessTracksByScene(objects, 'crop'), [objects])

  const placementKey = useProjectStore((s) => objects.map((o) => {
    const track = s.scenes[o.sceneId]?.tracks[o.trackId]
    const onTop = isOnTopTrack(getInstrument(o.instrumentId), track?.params, track?.onTop)
    const finalInvert = onTop
      && o.instrumentId === 'textDisplay'
      && (track?.params?.colorMode ?? 0) >= 0.5
    return finalInvert ? 'I' : onTop ? 'F' : 'B'
  }).join(''))

  useFrame(() => {
    const previous = gl.getRenderTarget()
    const previousAutoClear = gl.autoClear
    const previousToneMapping = gl.toneMapping
    gl.autoClear = false
    // Preserve scene-linear values above 1.0 through every offscreen pass.
    // Tone mapping happens once, in the final grade after bloom is composed.
    gl.toneMapping = NoToneMapping
    // Fullscreen gradient over whatever was just cleared into the current
    // render target - the gradient variant of setClearColor. Writes no depth,
    // so the scene's objects draw over it exactly as over a flat clear.
    const paintBackdropGradient = (gradient: SceneGradient) => {
      const uniforms = compositor.gradientMaterial.uniforms
      setHexSrgb(uniforms.colorFrom.value as Vector3, gradient.from)
      setHexSrgb(uniforms.colorTo.value as Vector3, gradient.to)
      uniforms.kind.value = gradient.kind === 'radial' ? 2 : gradient.kind === 'mirror' ? 1 : 0
      uniforms.angle.value = (gradient.angle * Math.PI) / 180
      ;(uniforms.resolution.value as Vector2).set(Math.max(1, size.width), Math.max(1, size.height))
      compositor.filterMesh.material = compositor.gradientMaterial
      gl.render(compositor.filterScene, compositor.filterCam)
    }
    try {
      const layers = getCompositionLayers()
      const requested = new Set(layers.map((layer) => layer.sceneId))

      for (const sceneId of requested) {
        const runtime = mounted.get(sceneId)
        if (!runtime) continue
        const projectScene = useProjectStore.getState().scenes[sceneId]
        gl.setRenderTarget(runtime.target)
        gl.setClearColor(projectScene?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, projectScene?.backgroundTransparent ? 0 : 1)
        gl.clear(true, true, true)
        const sceneGradient = activeBackdropGradient(projectScene)
        if (sceneGradient) paintBackdropGradient(sceneGradient)
        gl.render(runtime.base, camera)
        gl.clearDepth()
        gl.render(runtime.front, camera)

        // Scene-wide color filters are ordinary scene tracks whose held notes
        // choose post-process modes. Multiple tracks chain in resolved order.
        let filteredTexture: Texture = runtime.target.texture
        let filterPass = 0

        // Positional warp runs BEFORE the colour filters: it decides where the
        // pixels are, they decide what colour those pixels end up. Warping a
        // graded image instead would drag the grade's own gradients around.
        for (const trackId of bassRippleTrackIds.get(sceneId) ?? []) {
          const ripple = resolveActiveBassRipple(getObjectState(trackId))
          if (!ripple) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.warpMaterial
          compositor.warpMaterial.uniforms.tDiffuse.value = filteredTexture
          compositor.warpMaterial.uniforms.amount.value = ripple.amount
          compositor.warpMaterial.uniforms.scale.value = ripple.scale
          compositor.warpMaterial.uniforms.speed.value = ripple.speed
          compositor.warpMaterial.uniforms.time.value = ripple.beat
          compositor.warpMaterial.uniforms.aspect.value = Math.max(0.0001, size.width / Math.max(1, size.height))
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        // Impact Warp is the OUTERMOST positional gesture: it runs after the
        // ripple, so a scene already rumbling gets punched as one image rather
        // than the punch being fed into the rumble. Both still precede colour.
        for (const trackId of impactWarpTrackIds.get(sceneId) ?? []) {
          const hit = resolveActiveImpactWarp(getObjectState(trackId))
          if (!hit) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.impactWarpMaterial
          const uniforms = compositor.impactWarpMaterial.uniforms
          uniforms.tDiffuse.value = filteredTexture
          uniforms.style.value = hit.style
          uniforms.amount.value = hit.amount
          ;(uniforms.dir.value as Vector2).set(hit.dirX, hit.dirY)
          uniforms.phase.value = hit.phase
          uniforms.size.value = hit.size
          uniforms.seed.value = hit.seed
          uniforms.aspect.value = Math.max(0.0001, size.width / Math.max(1, size.height))
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        for (const trackId of colorFilterTrackIds.get(sceneId) ?? []) {
          const filter = resolveActiveColorFilter(getObjectState(trackId))
          if (!filter) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.filterMaterial
          compositor.filterMaterial.uniforms.tDiffuse.value = filteredTexture
          compositor.filterMaterial.uniforms.mode.value = filter.mode
          compositor.filterMaterial.uniforms.amount.value = filter.amount
          compositor.filterMaterial.uniforms.time.value = filter.beat
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        // Strobe runs LAST of the scene's own passes: it is a flash over the
        // finished look, not one more colour in the grade. Inverting a graded
        // frame is the intent; grading an inverted one would tint the flash.
        // A dark half-cycle resolves to null, so the pass simply does not run.
        for (const trackId of strobeTrackIds.get(sceneId) ?? []) {
          const strobe = resolveActiveStrobe(getObjectState(trackId))
          if (!strobe) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.filterMaterial
          compositor.filterMaterial.uniforms.tDiffuse.value = filteredTexture
          compositor.filterMaterial.uniforms.mode.value = strobe.mode
          compositor.filterMaterial.uniforms.amount.value = strobe.amount
          compositor.filterMaterial.uniforms.time.value = strobe.beat
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        // The in-scene Crop mask runs after even the Strobe: it is a matte
        // over the finished look, so every grade, warp and flash lands inside
        // the visible slices - running earlier would fill the punched holes
        // back in with whatever pass came after. Null resolve (no notes yet,
        // muted, fully dry) skips the pass entirely.
        for (const trackId of cropTrackIds.get(sceneId) ?? []) {
          const mask = resolveActiveCropMask(getObjectState(trackId))
          if (!mask) continue
          const output = runtime.filterTargets[filterPass % runtime.filterTargets.length]
          compositor.filterMesh.material = compositor.cropMaskMaterial
          const uniforms = compositor.cropMaskMaterial.uniforms
          uniforms.tDiffuse.value = filteredTexture
          uniforms.sliceState.value = mask.sliceState
          uniforms.count.value = mask.count
          uniforms.angle.value = mask.angle
          uniforms.wedge.value = mask.wedge ? 1 : 0
          uniforms.flash.value = mask.flash
          uniforms.blur.value = mask.blur
          uniforms.wet.value = mask.wet
          uniforms.aspect.value = Math.max(0.0001, size.width / Math.max(1, size.height))
          gl.setRenderTarget(output)
          gl.setClearColor(0x000000, 0)
          gl.clear(true, true, true)
          gl.render(compositor.filterScene, compositor.filterCam)
          filteredTexture = output.texture
          filterPass++
        }
        runtime.outputTexture = filteredTexture

        // Final-invert text is isolated as a transparent mask. It is applied only
        // after every requested scene layer has been composited below.
        gl.setRenderTarget(runtime.invertTarget)
        gl.setClearColor(0x000000, 0)
        gl.clear(true, true, true)
        gl.render(runtime.invert, camera)
      }

      while (compositor.meshes.length < layers.length) {
        const material = makeCompositorMaterial()
        const geometry = makeCompositorGeometry()
        setPartitionGeometry(geometry)
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        compositor.meshes.push(mesh)
        compositor.scene.add(mesh)
      }
      const layerAspect = Math.max(0.0001, size.width / Math.max(1, size.height))
      compositor.meshes.forEach((mesh, i) => {
        const layer = layers[i]
        mesh.visible = !!layer
        if (!layer) return
        const runtime = mounted.get(layer.sceneId)
        mesh.visible = !!runtime
        if (!runtime) return
        applyCompositorLayer(mesh, layer, i, runtime.outputTexture, layerAspect)
      })

      const project = useProjectStore.getState()
      const mainId = project.sceneOrder.find((id) => project.scenes[id]?.isMain)
      const main = mainId ? project.scenes[mainId] : undefined
      gl.setRenderTarget(compositor.compositeTarget)
      gl.setClearColor(main?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, main?.backgroundTransparent ? 0 : 1)
      gl.clear(true, true, true)
      // Main's own backdrop shows wherever the scene layers don't cover
      // (viewports, partitions) - it gets the gradient treatment too. The
      // final to-screen pass repaints the whole frame from this target, so
      // this is the only composite-level site that needs it.
      const mainGradient = activeBackdropGradient(main)
      if (mainGradient) paintBackdropGradient(mainGradient)
      gl.render(compositor.scene, compositor.cam)

      // Luminance-thresholded, multi-resolution bloom consumes the completed
      // scene composite, so preview, directors, partitions and export all match.
      compositor.bloomEffect.update(gl, compositor.compositeTarget, 0)

      compositor.filterMesh.material = compositor.finalMaterial
      compositor.finalMaterial.uniforms.tBloom.value = compositor.bloomEffect.texture
      compositor.finalMaterial.uniforms.time.value = getBeatOverride() ?? useTimeStore.getState().currentBeat
      // Color-exact instruments (the Crazy Edit template's photo slots / FX)
      // reproduce external footage: with one in the composition the stylistic
      // grade and the ACES tone map switch off for the frame, so drawn colors
      // reach the screen verbatim. (Same instrument-id pattern as
      // placementKey's textDisplay case.)
      const rawGrade = objects.some((o) => o.instrumentId === 'photoSlot' || o.instrumentId === 'polyFx')
      compositor.finalMaterial.uniforms.rawGrade.value = rawGrade ? 1 : 0
      gl.toneMapping = rawGrade ? NoToneMapping : previousToneMapping
      gl.setRenderTarget(previous)
      gl.setClearColor(main?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, main?.backgroundTransparent ? 0 : 1)
      gl.clear(true, true, true)
      gl.render(compositor.filterScene, compositor.filterCam)

      while (compositor.invertMeshes.length < layers.length) {
        const material = makeCompositorMaterial(true)
        const geometry = makeCompositorGeometry()
        setPartitionGeometry(geometry)
        const mesh = new Mesh(geometry, material)
        mesh.frustumCulled = false
        compositor.invertMeshes.push(mesh)
        compositor.invertScene.add(mesh)
      }
      compositor.invertMeshes.forEach((mesh, i) => {
        const layer = layers[i]
        mesh.visible = !!layer
        if (!layer) return
        const runtime = mounted.get(layer.sceneId)
        mesh.visible = !!runtime
        if (!runtime) return
        applyCompositorLayer(mesh, layer, i, runtime.invertTarget.texture, layerAspect)
      })
      gl.render(compositor.invertScene, compositor.cam)
    } finally {
      gl.setRenderTarget(previous)
      gl.toneMapping = previousToneMapping
      gl.autoClear = previousAutoClear
    }
  }, 100)

  return (
    <>
      {[...mounted.entries()].map(([sceneId, runtime]) => {
        const sceneObjects = objects.filter((o) => o.sceneId === sceneId)
        const base = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'B')
        const front = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'F')
        const invert = sceneObjects.filter((o) => placementKey[objects.indexOf(o)] === 'I')
        return (
          <Fragment key={sceneId}>
            {createPortal(
            <>
              {lights()}
              {base.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </>,
            runtime.base,
            )}
            {createPortal(
            <>
              {lights()}
              {front.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}:front`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </>,
            runtime.front,
            )}
            {createPortal(
            <FinalInvertMaskContext.Provider value>
              {lights()}
              {invert.map((o) => <ObjectRenderer key={`${o.trackId}:${o.visualCopyIndex}:invert`} sceneId={o.sceneId} trackId={o.trackId} instrumentId={o.instrumentId} visualCopyIndex={o.visualCopyIndex} />)}
            </FinalInvertMaskContext.Provider>,
            runtime.invert,
            )}
          </Fragment>
        )
      })}
    </>
  )
}
