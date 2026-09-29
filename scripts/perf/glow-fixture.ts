import * as T from 'three'
import {
  GlowPass,
  glowTarget,
  glowMaterial,
  GLOW_EXTRACT,
  GLOW_VERTEX,
} from '../../src/editor/components/visual/GlowPass'
import { GLOW_DEFAULTS, GLOW_PRESETS } from '../../src/editor/effects/shaders/glow'
import {
  glowSceneStats,
  renderVisibleGlowSource,
  registerGlowSource,
  prepareSceneGlow,
  renderSceneWithGlow,
  GLOW_CORE_OUTPUT,
  GLOW_HALO_OUTPUT,
  glowCoreBlend,
  glowHaloBlend,
  type GlowSource,
} from '../../src/editor/components/visual/glowScene'
const gl = new T.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: true,
})
gl.setSize(960, 540)
gl.setPixelRatio(1)
gl.toneMapping = T.NoToneMapping
gl.autoClear = false
document.body.appendChild(gl.domElement)
const pass = new GlowPass(),
  target = glowTarget(128, 128)
function read(rt: T.WebGLRenderTarget) {
  const buf = new Uint16Array(rt.width * rt.height * 4)
  gl.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf)
  return Float32Array.from(buf, T.DataUtils.fromHalfFloat)
}
function texture(alpha: number, color = [0.02, 0.005, 0.001]) {
  const data = new Float32Array(128 * 128 * 4)
  for (let y = 48; y < 80; y++)
    for (let x = 48; x < 80; x++) {
      const i = (y * 128 + x) * 4
      data.set([...color.map((c) => c * alpha), alpha], i)
    }
  const t = new T.DataTexture(data, 128, 128, T.RGBAFormat, T.FloatType)
  t.needsUpdate = true
  return t
}
const center = (64 * 128 + 64) * 4,
  edge = (64 * 128 + 82) * 4
const results: Record<string, unknown> = {}
function assert(name: string, ok: boolean, details?: unknown) {
  results[name] = { pass: ok, details }
  if (!ok) throw new Error(name + ': ' + JSON.stringify(details))
}
const s = { ...GLOW_DEFAULTS, radius: 100 }
let input = texture(1)
pass.render(gl, input, target, { ...s, strength: 0 })
let pixels = read(target)
assert('neutral HDR core', Math.abs(pixels[center] - 0.02) < 0.0001, pixels[center])
pass.render(gl, input, target, { ...s, source: 1 })
pixels = read(target)
const whole = pixels[edge]
assert(
  'halo strength preserves opaque core',
  Math.abs(pixels[center] - 0.02) < 0.0001,
  pixels[center],
)
assert('dark colored object emits without whitening source', whole > 0.005, whole)
pass.render(gl, input, target, { ...s, source: 0, threshold: 0.7 })
pixels = read(target)
assert('highlights rejects dark source', pixels[edge] === 0, pixels[edge])
pass.render(gl, input, target, { ...s, source: 2 })
pixels = read(target)
assert('outline emits only border', pixels[edge] > 0 && pixels[center] < 0.1, [
  pixels[edge],
  pixels[center],
])
input.dispose()
input = texture(0.5)
pass.render(gl, input, target, s)
pixels = read(target)
assert('fades apply once', Math.abs(pixels[edge] / whole - 0.5) < 0.01, pixels[edge] / whole)
input.dispose()
input = texture(0)
pass.render(gl, input, target, s)
pixels = read(target)
assert(
  'zero alpha has no residual light',
  pixels.every((v) => v === 0),
)
input.dispose()
input = texture(1, [8, 2, 0.1])
pass.render(gl, input, target, { ...s, strength: 0 })
pixels = read(target)
assert('HDR above one survives', pixels[center] === 8, pixels[center])
// Threshold extraction is tested directly, before filtering and coverage.
const extract = glowMaterial(GLOW_EXTRACT, {
  tDiffuse: { value: input },
  pixel: { value: new T.Vector2(1 / 128, 1 / 128) },
  source: { value: 0 },
  threshold: { value: 8 },
  softness: { value: 1 },
  tintMix: { value: 0 },
  tint: { value: new T.Vector3(1, 1, 1) },
})
pass.draw(gl, extract, target)
pixels = read(target)
assert('soft knee midpoint', Math.abs(pixels[center] - 4) < 0.01, pixels[center])
extract.uniforms.threshold.value = 10
extract.uniforms.softness.value = 0
pass.draw(gl, extract, target)
pixels = read(target)
assert('hard cutoff remains finite', pixels[center] === 0 && pixels.every(Number.isFinite))

// A depth-fog extension can attenuate extracted light without touching core.
input.dispose()
input = texture(1)
const fogged = glowTarget(128, 128)
const attenuate = glowMaterial(
  'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv)*.5;}',
  { tDiffuse: { value: null } },
)
pass.emissionStage = ({ emission }) => {
  attenuate.uniforms.tDiffuse.value = emission
  pass.draw(gl, attenuate, fogged)
  return fogged.texture
}
pass.render(gl, input, target, s)
pixels = read(target)
assert(
  'emission-stage attenuation leaves core intact',
  Math.abs(pixels[edge] / whole - 0.5) < 0.01 && Math.abs(pixels[center] - 0.02) < 0.0001,
)
pass.emissionStage = undefined
pass.render(gl, input, target, { ...s, radius: 36, stretch: 12, angle: 0 })
pixels = read(target)
const horizontal = pixels[(64 * 128 + 94) * 4],
  vertical = pixels[(94 * 128 + 64) * 4]
assert(
  'maximum stretch produces a horizontal streak',
  horizontal > vertical * 10 && horizontal > 0.001,
  {
    horizontal,
    vertical,
  },
)
pass.render(gl, input, target, { ...s, radius: 36, stretch: 12, angle: 90 })
pixels = read(target)
assert(
  'orientation rotates the streak',
  pixels[(94 * 128 + 64) * 4] > pixels[(64 * 128 + 94) * 4] * 10,
)
pass.render(gl, input, target, {
  ...s,
  tintMix: 1,
  tintHue: 120,
  tintSaturation: 1,
})
pixels = read(target)
assert(
  'tint colors emission without recoloring core',
  pixels[edge + 1] > pixels[edge] * 10 && Math.abs(pixels[center] - 0.02) < 0.0001,
)
pass.render(gl, input, target, {
  ...s,
  strength: 0,
  coreBrightness: 3,
  coreWhite: 1,
})
pixels = read(target)
assert(
  'white-hot brightness is independent of halo',
  Math.abs(pixels[center] - 0.06) < 0.0001 &&
    pixels[center] === pixels[center + 1] &&
    pixels[center] === pixels[center + 2] &&
    pixels[edge] === 0,
)
// Same authored radius at two output sizes, measured away from source edges.
pass.render(gl, input, target, s)
const low = read(target)
const highTarget = glowTarget(256, 256)
pass.render(gl, input, highTarget, s)
const high = read(highTarget)
const lo = low[(64 * 128 + 84) * 4],
  hi =
    (high[(128 * 256 + 168) * 4] +
      high[(128 * 256 + 169) * 4] +
      high[(129 * 256 + 168) * 4] +
      high[(129 * 256 + 169) * 4]) *
    0.25
assert('preview/export halo reach', Math.abs(lo - hi) / Math.max(lo, hi) < 0.08, {
  lo,
  hi,
  relativeError: Math.abs(lo - hi) / Math.max(lo, hi),
})
// Additive instruments retain their RGB blend but need union coverage, not a².
const additiveScene = new T.Scene(),
  additiveCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
additiveCamera.position.z = 2
const additiveMat = new T.MeshBasicMaterial({
  color: new T.Color(0.2, 0.1, 0.02),
  transparent: true,
  opacity: 0.5,
  blending: T.AdditiveBlending,
  depthWrite: false,
})
additiveScene.add(new T.Mesh(new T.PlaneGeometry(1, 1), additiveMat))
gl.setRenderTarget(target)
gl.clear()
renderVisibleGlowSource(gl, additiveScene, additiveCamera, [additiveScene])
pixels = read(target)
assert(
  'additive coverage fades once',
  Math.abs(pixels[center + 3] - 0.5) < 0.001 && Math.abs(pixels[center] - 0.1) < 0.001,
  [pixels[center], pixels[center + 3]],
)
assert('additive material restored', additiveMat.blending === T.AdditiveBlending)

// Real source rendering + borrowed depth, including a custom ShaderMaterial.
const scene = new T.Scene(),
  camera = new T.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 50)
camera.position.z = 10
scene.add(new T.AmbientLight(0xffffff, 1))
const resources: (() => void)[] = [],
  entries: GlowSource[] = []
function source(
  trackId: string,
  x: number,
  y: number,
  object: T.Object3D,
  settings = { ...GLOW_DEFAULTS },
) {
  const src = new T.Scene(),
    holder = new T.Group()
  holder.position.set(x, y, 0)
  holder.add(object)
  src.add(holder)
  const core = new T.Mesh(
    new T.PlaneGeometry(2, 2),
    new T.ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_CORE_OUTPUT,
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        tOriginal: { value: null },
        delta: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      ...glowCoreBlend,
    }),
  )
  const halo = new T.Mesh(
    new T.PlaneGeometry(2, 2),
    new T.ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_HALO_OUTPUT,
      uniforms: { tDiffuse: { value: null }, tCore: { value: null } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      ...glowHaloBlend,
    }),
  )
  core.frustumCulled = halo.frustumCulled = false
  core.renderOrder = 999
  halo.renderOrder = 1000
  scene.add(core, halo)
  const e: GlowSource = {
    trackId,
    scene: src,
    holder,
    coreMesh: core,
    haloMesh: halo,
    active: true,
    emitsHalo: true,
    dirty: true,
    batchKey: trackId + JSON.stringify(settings),
    nativeCore: true,
    nativeSource: true,
    width: 960,
    height: 540,
    run: (r, t, out, on, g) => g.render(r, t, out, settings, on),
  }
  resources.push(registerGlowSource(scene, e))
  entries.push(e)
  return e
}
const line = new T.Mesh(
  new T.PlaneGeometry(2.5, 0.025),
  new T.MeshBasicMaterial({ color: new T.Color(0.04, 0.01, 0.001) }),
)
source('line', -5, 2, line)
const canvas = document.createElement('canvas')
canvas.width = 512
canvas.height = 160
const ctx = canvas.getContext('2d')!
ctx.fillStyle = '#126288'
ctx.font = 'bold 120px sans-serif'
ctx.textAlign = 'center'
ctx.fillText('GLOW', 256, 123)
source(
  'text',
  0,
  2,
  new T.Mesh(
    new T.PlaneGeometry(3.5, 1.1),
    new T.MeshBasicMaterial({
      map: new T.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  ),
)
const points = new T.BufferGeometry()
const coords = []
for (let i = 0; i < 36; i++) coords.push(Math.sin(i * 2.4) * 1.2, Math.cos(i * 1.7) * 0.8, 0)
points.setAttribute('position', new T.Float32BufferAttribute(coords, 3))
source(
  'particles',
  5,
  2,
  new T.Points(
    points,
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader:
        'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=4.;}',
      fragmentShader:
        'void main(){if(length(gl_PointCoord-.5)>.5)discard;gl_FragColor=vec4(.12,.01,.05,1.);}',
    }),
  ),
)
source(
  'solid',
  -5,
  -1.5,
  new T.Mesh(
    new T.CircleGeometry(0.8, 64),
    new T.MeshBasicMaterial({ color: new T.Color(0.002, 0.04, 0.01) }),
  ),
)
const hidden = source(
  'hidden',
  0,
  -1.5,
  new T.Mesh(
    new T.CircleGeometry(0.7, 64),
    new T.MeshBasicMaterial({ color: new T.Color(0.01, 0.1, 0.1) }),
  ),
)
const occluder = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ color: 0x111111 }))
occluder.position.set(0, -1.5, 1)
scene.add(occluder)
for (let i = 0; i < 5; i++)
  source(
    'copies',
    3.5 + i * 0.6,
    -1.5,
    new T.Mesh(
      new T.PlaneGeometry(0.04, 1.6),
      new T.MeshBasicMaterial({ color: new T.Color(0.015, 0.015, 0.08) }),
    ),
    { ...GLOW_DEFAULTS, radius: 28, stretch: 2 },
  )
// Match production's linear scene target followed by a single output encoding.
const displayTarget = new T.WebGLRenderTarget(960, 540, {
  type: T.HalfFloatType,
  stencilBuffer: true,
})
const displayScene = new T.Scene(),
  displayCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1)
displayScene.add(
  new T.Mesh(
    new T.PlaneGeometry(2, 2),
    new T.ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: `uniform sampler2D tDiffuse;varying vec2 vUv;
void main(){gl_FragColor=texture2D(tDiffuse,vUv);
#include <colorspace_fragment>
}`,
      uniforms: { tDiffuse: { value: displayTarget.texture } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  ),
)
function draw() {
  for (const e of entries) e.dirty = true
  prepareSceneGlow(gl, scene, camera)
  gl.setRenderTarget(displayTarget)
  gl.setClearColor(0x03040a, 1)
  gl.clear()
  renderSceneWithGlow(gl, scene, camera)
  gl.setRenderTarget(null)
  gl.clear()
  gl.render(displayScene, displayCamera)
  return gl.domElement.toDataURL()
}
displayTarget.viewport.set(13, 17, 120, 80)
displayTarget.scissor.set(13, 17, 120, 80)
displayTarget.scissorTest = true
gl.setRenderTarget(displayTarget)
gl.setViewport(13, 17, 120, 80)
gl.setScissor(13, 17, 120, 80)
gl.setScissorTest(true)
for (const e of entries) e.dirty = true
prepareSceneGlow(gl, scene, camera)
assert('source capture restores preview atlas viewport and scissor',
  Array.from(gl.getContext().getParameter(gl.getContext().VIEWPORT)).join() === '13,17,120,80' &&
  Array.from(gl.getContext().getParameter(gl.getContext().SCISSOR_BOX)).join() === '13,17,120,80' &&
  gl.getContext().isEnabled(gl.getContext().SCISSOR_TEST))
displayTarget.viewport.set(0, 0, 960, 540)
displayTarget.scissor.set(0, 0, 960, 540)
displayTarget.scissorTest = false
gl.setViewport(0, 0, 960, 540)
gl.setScissor(0, 0, 960, 540)
gl.setScissorTest(false)
const first = draw(),
  second = draw()
assert(
  'copies share one blur chain',
  glowSceneStats()[0].sources === 10 && glowSceneStats()[0].groups === 6,
  glowSceneStats(),
)
assert('paused renders are deterministic', first === second)
const hiddenTex = (hidden.haloMesh.material as T.ShaderMaterial).uniforms.tDiffuse
  .value as T.Texture
// Render the hidden source output to the readable target: hidden source must be zero.
const copy = glowMaterial(
  'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv);}',
  { tDiffuse: { value: hiddenTex } },
)
pass.draw(gl, copy, target)
pixels = read(target)
assert(
  'fully occluded source produces zero halo',
  pixels.every((v) => v === 0),
  Math.max(...pixels),
)
const runHidden = hidden.run
let visibleAlpha = 0
hidden.run = (renderer, input, output, halo, g) => {
  if (!halo) {
    const sample = new Uint16Array(4)
    renderer.readRenderTargetPixels(renderer.getRenderTarget()!, 480, 180, 1, 1, sample)
    visibleAlpha = T.DataUtils.fromHalfFloat(sample[3])
  }
  runHidden(renderer, input, output, halo, g)
}
occluder.material.transparent = true
occluder.material.opacity = 0.5
occluder.material.depthWrite = false
draw()
assert(
  'translucent foreground attenuates source coverage',
  Math.abs(visibleAlpha - 0.5) < 0.001,
  visibleAlpha,
)
occluder.material.opacity = 1
draw()
assert(
  'opaque-looking non-depth-writing foreground hides emission',
  visibleAlpha === 0,
  visibleAlpha,
)
occluder.material.opacity = 0.5
occluder.material.depthWrite = true
draw()
assert(
  'transparent depth writers preserve visible source contribution',
  Math.abs(visibleAlpha - 0.5) < 0.001,
  visibleAlpha,
)
hidden.emitsHalo = false
draw()
const beforeBoost = read(displayTarget)[(180 * 960 + 480) * 4 + 1]
hidden.nativeCore = false
hidden.emitsHalo = false
hidden.run = (r, t, out, on, g) =>
  g.render(r, t, out, { ...GLOW_DEFAULTS, strength: 0, coreBrightness: 2 }, on)
draw()
const afterBoost = read(displayTarget)[(180 * 960 + 480) * 4 + 1]
assert(
  'core boost behind glass adds only visible source difference',
  Math.abs(afterBoost - beforeBoost - 0.05) < 0.002,
  { beforeBoost, afterBoost },
)
hidden.nativeCore = true
hidden.emitsHalo = true
hidden.run = runHidden
occluder.material.opacity = 1
occluder.material.transparent = false
draw()
const ctxGL = gl.getContext() as WebGL2RenderingContext,
  originalTex = ctxGL.texImage2D.bind(ctxGL)
let allocations = 0
ctxGL.texImage2D = ((...args: Parameters<typeof ctxGL.texImage2D>) => {
  allocations++
  return Reflect.apply(originalTex, ctxGL, args)
}) as typeof ctxGL.texImage2D
const originalStorage = ctxGL.texStorage2D.bind(ctxGL)
ctxGL.texStorage2D = (...args) => {
  allocations++
  return Reflect.apply(originalStorage, ctxGL, args)
}
draw()
draw()
ctxGL.texImage2D = originalTex
ctxGL.texStorage2D = originalStorage
assert('steady frames do not reallocate targets', allocations === 0, allocations)
;(window as unknown as Record<string, unknown>).glowResults = results
;(window as unknown as Record<string, unknown>).glowCapture = draw()

const presetCaptures: Record<string, string> = {}
for (const [name, settings] of Object.entries(GLOW_PRESETS)) {
  for (const e of entries) {
    e.run = (r, t, out, on, g) => g.render(r, t, out, settings, on)
    e.nativeCore = settings.coreBrightness === 1 && settings.coreWhite === 0
    e.batchKey = e.trackId + JSON.stringify(settings)
  }
  presetCaptures[name] = draw()
}
;(window as unknown as Record<string, unknown>).glowPresetCaptures = presetCaptures
