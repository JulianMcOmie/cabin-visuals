import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BufferGeometry,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderLib,
  UniformsUtils,
  Vector2,
  Vector4,
} from 'three'
import type { Camera, WebGLRenderer } from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  configureFramePointsMaterial,
  FRAME_REFERENCE_HEIGHT,
  frameLineResolution,
  framePixelScale,
  previewSamplingScale,
} from './framePixels'

type RenderSize = { width: number; height: number; canvasHeight: number; pixelRatio: number }

function rendererFor(size: RenderSize): WebGLRenderer {
  return {
    getCurrentViewport: (target: Vector4) => target.set(0, 0, size.width, size.height),
    getSize: (target: Vector2) => target.set(size.canvasHeight * 16 / 9, size.canvasHeight),
    getPixelRatio: () => size.pixelRatio,
  } as WebGLRenderer
}

function compilePoints(material: PointsMaterial, renderer: WebGLRenderer) {
  const shader = {
    vertexShader: ShaderLib.points.vertexShader,
    fragmentShader: ShaderLib.points.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.points.uniforms),
  } as Parameters<PointsMaterial['onBeforeCompile']>[0]
  material.onBeforeCompile(shader, renderer)
  return shader
}

const scene = new Scene()
const geometry = new BufferGeometry()
const object = new Points(geometry)
const group = new Group()

function beforePointsDraw(material: PointsMaterial, renderer: WebGLRenderer, camera: Camera) {
  material.onBeforeRender(renderer, scene, camera, geometry, object, group)
}

test('frame pixels preserve their fraction of the rendered frame at every resolution and DPR', () => {
  const cases: RenderSize[] = [
    { width: 960, height: 540, canvasHeight: 540, pixelRatio: 1 },
    { width: 1920, height: 1080, canvasHeight: 540, pixelRatio: 2 },
    { width: 1920, height: 1080, canvasHeight: 1080, pixelRatio: 1 },
    { width: 3840, height: 2160, canvasHeight: 2160, pixelRatio: 1 },
    { width: 320, height: 180, canvasHeight: 1080, pixelRatio: 2 },
  ]
  for (const size of cases) {
    const pixels = 12 * framePixelScale(rendererFor(size))
    assert.equal(pixels / size.height, 12 / FRAME_REFERENCE_HEIGHT)
  }
})

test('frame pixel scale supports an explicit reference and guards an empty viewport', () => {
  const size = { width: 1920, height: 512, canvasHeight: 1080, pixelRatio: 1 }
  assert.equal(framePixelScale(rendererFor(size), 1024), 0.5)
  size.height = 0
  assert.equal(framePixelScale(rendererFor(size)), 1 / 1080)
})

test('line resolution keeps width proportional across targets and updates a shared material', () => {
  const size = { width: 960, height: 540, canvasHeight: 540, pixelRatio: 2 }
  const renderer = rendererFor(size)
  const material = new LineMaterial({ linewidth: 12 })
  const line = { material }
  const onBeforeRender = frameLineResolution()
  onBeforeRender.call(line, renderer)
  assert.deepEqual(material.resolution.toArray(), [1920, 1080])
  assert.equal(material.linewidth, 12)
  assert.equal(material.uniformsNeedUpdate, true)

  material.uniformsNeedUpdate = false
  Object.assign(size, { width: 360, height: 640 })
  onBeforeRender.call(line, renderer)
  assert.deepEqual(material.resolution.toArray(), [607.5, 1080])
  assert.equal(material.uniformsNeedUpdate, true)

  frameLineResolution(1024).call(line, renderer)
  assert.deepEqual(material.resolution.toArray(), [576, 1024])
})

test('stock points shader receives one correction before Three applies perspective attenuation', () => {
  const renderer = rendererFor({ width: 960, height: 540, canvasHeight: 540, pixelRatio: 1 })
  const material = new PointsMaterial({ size: 7, opacity: 0.4, sizeAttenuation: true })
  const originalCacheKey = material.customProgramCacheKey()
  assert.equal(configureFramePointsMaterial(material), material)
  const shader = compilePoints(material, renderer)
  assert.ok(shader.vertexShader.startsWith('uniform float uFramePointScale;'))
  assert.ok(shader.vertexShader.includes('gl_PointSize = size;\n\tgl_PointSize *= uFramePointScale;'))
  assert.ok(shader.vertexShader.indexOf('gl_PointSize *= uFramePointScale;') < shader.vertexShader.indexOf('#ifdef USE_SIZEATTENUATION'))
  assert.notEqual(material.customProgramCacheKey(), originalCacheKey)
  assert.equal(material.size, 7)
  assert.equal(material.opacity, 0.4)
})

test('screen-sized points cancel canvas DPR and scale with the actual target height', () => {
  const material = configureFramePointsMaterial(new PointsMaterial({ size: 12, sizeAttenuation: false }))
  const size = { width: 960, height: 540, canvasHeight: 540, pixelRatio: 1 }
  const renderer = rendererFor(size)
  const shader = compilePoints(material, renderer)
  const camera = new PerspectiveCamera()
  for (const [height, canvasHeight, pixelRatio] of [[540, 540, 1], [1080, 540, 2], [180, 1080, 2], [2160, 2160, 1]]) {
    Object.assign(size, { height, canvasHeight, pixelRatio })
    beforePointsDraw(material, renderer, camera)
    const renderedSize = material.size * pixelRatio * shader.uniforms.uFramePointScale.value
    assert.equal(renderedSize / height, 12 / 1080)
  }
})

test('perspective points preserve world attenuation when drawing into a smaller target', () => {
  const material = configureFramePointsMaterial(new PointsMaterial({ size: 0.1, sizeAttenuation: true }))
  const size = { width: 960, height: 540, canvasHeight: 540, pixelRatio: 1 }
  const renderer = rendererFor(size)
  const shader = compilePoints(material, renderer)
  const camera = new PerspectiveCamera()
  const distance = 5
  for (const [height, canvasHeight, pixelRatio] of [[540, 540, 1], [1080, 540, 2], [180, 1080, 2], [2160, 2160, 1]]) {
    Object.assign(size, { height, canvasHeight, pixelRatio })
    beforePointsDraw(material, renderer, camera)
    const renderedSize = material.size * pixelRatio * (canvasHeight * 0.5 / distance) * shader.uniforms.uFramePointScale.value
    assert.ok(Math.abs(renderedSize / height - material.size / (2 * distance)) < 1e-12)
  }
})

test('orthographic points use frame pixels even when sizeAttenuation is enabled', () => {
  const material = configureFramePointsMaterial(new PointsMaterial({ size: 12, sizeAttenuation: true }))
  const renderer = rendererFor({ width: 320, height: 180, canvasHeight: 540, pixelRatio: 2 })
  const camera = new OrthographicCamera()
  // Draw-time correction must survive compilation and subsequent recompilation.
  beforePointsDraw(material, renderer, camera)
  const shader = compilePoints(material, renderer)
  const nextShader = compilePoints(material, renderer)
  assert.equal(shader.uniforms.uFramePointScale, nextShader.uniforms.uFramePointScale)
  assert.equal(material.size * 2 * shader.uniforms.uFramePointScale.value, 2)
})

test('preview sampling preserves fine details with bounded supersampling and native Retina resolution', () => {
  for (const [height, dpr, expected] of [[270, 1, 2], [540, 1, 2], [720, 1, 1.5], [1080, 1, 1], [2160, 1, 1], [540, 2, 2], [1080, 2, 2], [1080, 3, 2]]) {
    assert.equal(previewSamplingScale(1, height, dpr, false), expected)
  }
  assert.equal(previewSamplingScale(1, 0, 1, false), 2)
})

test('sampling keeps fast mode budgets and pins export to exact output dimensions', () => {
  for (const height of [270, 1080, 2160]) for (const dpr of [1, 2]) {
    for (const scale of [0.25, 0.5, 1]) {
      assert.equal(previewSamplingScale(scale, height, dpr, true), 1)
      if (scale < 1) assert.equal(previewSamplingScale(scale, height, dpr, false), scale)
    }
  }
})
