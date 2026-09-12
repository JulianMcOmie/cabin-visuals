import { Camera, Color, InstancedBufferGeometry, Matrix4, Mesh, NoBlending, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three'
import type { WebGLRenderer } from 'three'
import type { createParticlePlanMesh } from './particlePlanRenderer'

/** Pick the actual shader-expanded surface with a one-pixel depth pass. Only
 * pointer queries pay for a GPU readback; playback never enumerates instances. */
export function attachParticlePlanPicking(mesh: ReturnType<typeof createParticlePlanMesh>['mesh']): () => void {
  let renderer: WebGLRenderer | undefined, drawnCamera: Camera | undefined
  let warmed: WebGLRenderer | undefined
  const drawViewport = new Vector4()
  mesh.onBeforeRender = (gl, _scene, camera) => {
    renderer = gl; drawnCamera = camera
    mesh.material.uniforms.uViewportHeight.value = gl.getCurrentViewport(drawViewport).w
    if (warmed !== gl) {
      warmed = gl
      // Compile during scene preparation, so the first pointer query does
      // not pay shader compilation on top of its one-pixel GPU readback.
      gl.compile(scene, camera)
    }
  }
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false })
  const material = new ShaderMaterial({
    glslVersion: mesh.material.glslVersion ?? undefined,
    vertexShader: mesh.material.vertexShader,
    uniforms: mesh.material.uniforms,
    depthTest: true, depthWrite: true, blending: NoBlending, toneMapped: false,
    fragmentShader: `
      #include <packing>
      uniform float uGlow, uOpacity;
      in vec2 vUv;
      out vec4 outColor;
      void main() {
        if (uOpacity <= 0.001 || length(vUv * 2.0 - 1.0) > (uGlow > 0.0 ? 1.0 : 0.55)) discard;
        outColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
  })
  // Always pick with quads: WebGL clips points by their center, which would
  // miss the edge of a point whose center lies outside the one-pixel crop.
  const plane = new PlaneGeometry(2, 2), geometry = new InstancedBufferGeometry()
  geometry.setIndex(plane.index)
  geometry.setAttribute('position', plane.getAttribute('position'))
  geometry.setAttribute('uv', plane.getAttribute('uv'))
  const scene = new Scene(), picked = new Mesh(geometry, material)
  picked.frustumCulled = false
  scene.add(picked)
  const pixel = new Uint8Array(4), projected = new Vector3(), point = new Vector3(), size = new Vector2()
  const crop = new Matrix4(), viewport = new Vector4(), scissor = new Vector4(), clear = new Color()
  mesh.raycast = (raycaster, intersections) => {
    const gl = renderer, camera = raycaster.camera ?? drawnCamera
    if (!gl || !camera || !mesh.visible || material.uniforms.uOpacity.value <= 0.001) return
    geometry.instanceCount = mesh.geometry instanceof InstancedBufferGeometry ? mesh.geometry.instanceCount : mesh.geometry.drawRange.count
    // Every point on this ray projects onto the requested screen position.
    raycaster.ray.at(1, projected).project(camera)
    gl.getDrawingBufferSize(size)
    const pickCamera = camera.clone()
    pickCamera.matrixAutoUpdate = false
    pickCamera.matrix.copy(camera.matrixWorld)
    pickCamera.matrixWorld.copy(camera.matrixWorld)
    pickCamera.matrixWorldInverse.copy(camera.matrixWorldInverse)
    pickCamera.layers.set(0)
    crop.set(size.x, 0, 0, -projected.x * size.x, 0, size.y, 0, -projected.y * size.y, 0, 0, 1, 0, 0, 0, 0, 1)
    pickCamera.projectionMatrix.copy(crop).multiply(camera.projectionMatrix)
    pickCamera.projectionMatrixInverse.copy(pickCamera.projectionMatrix).invert()
    const previous = gl.getRenderTarget(), face = gl.getActiveCubeFace(), level = gl.getActiveMipmapLevel()
    const alpha = gl.getClearAlpha(), auto = gl.autoClear, scissorTest = gl.getScissorTest(), xr = gl.xr.enabled
    const context = gl.getContext() as WebGL2RenderingContext
    // Three's asynchronous thumbnail readback may leave a PBO bound while
    // its fence is pending. A synchronous typed-array read requires no PBO.
    const packBuffer = context.getParameter(context.PIXEL_PACK_BUFFER_BINDING)
    gl.getViewport(viewport); gl.getScissor(scissor); gl.getClearColor(clear)
    try {
      gl.xr.enabled = false; gl.autoClear = false
      gl.setRenderTarget(target); gl.setViewport(0, 0, 1, 1); gl.setScissorTest(false)
      gl.setClearColor(0xffffff, 1); gl.clear(true, true, true)
      gl.render(scene, pickCamera)
      context.bindBuffer(context.PIXEL_PACK_BUFFER, null)
      gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    } finally {
      context.bindBuffer(context.PIXEL_PACK_BUFFER, packBuffer)
      gl.setRenderTarget(previous, face, level); gl.setViewport(viewport); gl.setScissor(scissor)
      gl.setScissorTest(scissorTest); gl.setClearColor(clear, alpha); gl.autoClear = auto; gl.xr.enabled = xr
    }
    if (pixel.every(value => value === 255)) return
    const depth = pixel[0] / 256 + pixel[1] / 65536 + pixel[2] / 16777216 + pixel[3] / (255 * 16777216)
    point.set(projected.x, projected.y, depth * 2 - 1).unproject(camera)
    const distance = raycaster.ray.origin.distanceTo(point)
    if (distance < raycaster.near || distance > raycaster.far) return
    intersections.push({ distance, point: point.clone(), object: mesh })
  }
  return () => { target.dispose(); material.dispose(); geometry.dispose() }
}
