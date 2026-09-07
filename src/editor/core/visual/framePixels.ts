import { Vector2, Vector4 } from 'three'
import type { OrthographicCamera, PointsMaterial, WebGLRenderer } from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

export const FRAME_REFERENCE_HEIGHT = 1080

const viewport = new Vector4()
const canvasSize = new Vector2()

/** Pixel-sized details use a fixed frame height, including offscreen render passes. */
export function framePixelScale(renderer: WebGLRenderer, referenceHeight = FRAME_REFERENCE_HEIGHT): number {
  return Math.max(1, renderer.getCurrentViewport(viewport).w) / referenceHeight
}

export function frameLineResolution(referenceHeight = FRAME_REFERENCE_HEIGHT) {
  return function (this: { material: LineMaterial }, renderer: WebGLRenderer): void {
    renderer.getCurrentViewport(viewport)
    this.material.resolution.set(referenceHeight * viewport.z / Math.max(1, viewport.w), referenceHeight)
    // A shared line material can draw into several differently shaped passes.
    this.material.uniformsNeedUpdate = true
  }
}

/** Configure a new stock PointsMaterial before any other shader customization. */
export function configureFramePointsMaterial(material: PointsMaterial): PointsMaterial {
  const correction = { value: 1 }
  material.onBeforeCompile = shader => {
    shader.uniforms.uFramePointScale = correction
    shader.vertexShader = `uniform float uFramePointScale;\n${shader.vertexShader}`.replace(
      'gl_PointSize = size;',
      'gl_PointSize = size;\n\tgl_PointSize *= uFramePointScale;',
    )
  }
  material.onBeforeRender = (renderer, _scene, camera) => {
    const attenuated = material.sizeAttenuation && !(camera as OrthographicCamera).isOrthographicCamera
    // Three's size/scale uniforms use canvas DPR and height even for render targets.
    const referenceHeight = attenuated
      ? Math.max(1, renderer.getSize(canvasSize).y)
      : FRAME_REFERENCE_HEIGHT
    correction.value = framePixelScale(renderer, referenceHeight) / renderer.getPixelRatio()
  }
  material.customProgramCacheKey = () => 'frame-points-v1'
  return material
}
