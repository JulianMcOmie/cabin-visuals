import { Color, DataTexture, FloatType, GLSL3, InstancedBufferGeometry, Matrix4, Mesh, PlaneGeometry, RGBAFormat } from 'three'
import type { InstancedCopyFrame } from '../core/visual/instancedFrame'
import { createParticleMaterial } from './particleCore'
import { attachParticlePlanPicking } from './particlePlanPicking'

/** Draw copies × local particles without expanding that product on the CPU.
 * Each copy occupies five texels (matrix + RGBA); each local dot occupies one.
 * Arbitrary movers/colorizers are already resolved into the copy placement.
 * This is deliberately independent of the compact splitter-plan fast path. */
export function createParticleFieldMesh(localCapacity: number, maxTextureSize: number) {
  const localData = new Float32Array(localCapacity * 4)
  const localTexture = new DataTexture(localData, localCapacity, 1, RGBAFormat, FloatType)
  let copyTexture = new DataTexture(new Float32Array(20), 5, 1, RGBAFormat, FloatType)
  const plane = new PlaneGeometry(2, 2), geometry = new InstancedBufferGeometry()
  geometry.setIndex(plane.index)
  geometry.setAttribute('position', plane.getAttribute('position'))
  geometry.setAttribute('uv', plane.getAttribute('uv'))
  geometry.instanceCount = 0
  const material = createParticleMaterial()
  material.name = 'Shared Particle field'
  material.glslVersion = GLSL3
  Object.assign(material.uniforms, {
    uLocal: { value: localTexture }, uCopies: { value: copyTexture },
    uCopyWidth: { value: 5 }, uLocalCount: { value: 1 }, uSize: { value: 1 },
    uViewportHeight: { value: 1 },
  })
  material.vertexShader = `
    uniform sampler2D uLocal, uCopies;
    uniform int uCopyWidth, uLocalCount;
    uniform float uSize;
    out vec2 vUv;
    out vec4 vColor;
    vec4 copyColumn(int index) {
      return texelFetch(uCopies, ivec2(index % uCopyWidth, index / uCopyWidth), 0);
    }
    void main() {
      int copyIndex = gl_InstanceID / uLocalCount;
      int dotIndex = gl_InstanceID % uLocalCount;
      int p = copyIndex * 5;
      mat4 world = mat4(copyColumn(p), copyColumn(p+1), copyColumn(p+2), copyColumn(p+3));
      vec4 dot = texelFetch(uLocal, ivec2(dotIndex, 0), 0);
      vec4 center = viewMatrix * world * vec4(dot.xyz, 1.0);
      float diameter = max(length(world[0].xyz), max(length(world[1].xyz), length(world[2].xyz))) * abs(uSize);
      center.xy += position.xy * diameter;
      gl_Position = projectionMatrix * center;
      vUv = uv;
      vColor = copyColumn(p+4);
      vColor.a *= dot.w;
    }
  `
  material.fragmentShader = 'out vec4 outColor;\n' + material.fragmentShader.replaceAll('varying ', 'in ').replaceAll('gl_FragColor', 'outColor')
  const mesh = new Mesh(geometry, material)
  mesh.name = 'Shared Particle Stream'
  mesh.frustumCulled = false
  const disposePicking = attachParticlePlanPicking(mesh)
  const matrix = new Matrix4(), color = new Color()
  return {
    mesh,
    get copyTexture() { return copyTexture },
    localTexture,
    update(frame: InstancedCopyFrame, local: { count: number; positions: Float32Array }, baseColor: string, size: number, glow: number) {
      const count = Math.max(1, frame.copies.length)
      const required = count * 20
      if ((copyTexture.image.data as Float32Array).length < required) {
        const capacity = 2 ** Math.ceil(Math.log2(count))
        const width = Math.min(maxTextureSize, capacity * 5)
        const height = Math.ceil(capacity * 5 / width)
        copyTexture.dispose()
        copyTexture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType)
        material.uniforms.uCopies.value = copyTexture
        material.uniforms.uCopyWidth.value = width
      }
      const values = copyTexture.image.data as Float32Array
      let live = 0
      for (let i = 0; i < count; i++) {
        const fade = Math.min(1, frame.copyFade(i))
        if (fade <= 0.001) continue
        frame.composeCopyMatrix(i, matrix)
        frame.copyColor(i, baseColor, color)
        const offset = live++ * 20
        matrix.toArray(values, offset)
        values[offset + 16] = color.r
        values[offset + 17] = color.g
        values[offset + 18] = color.b
        values[offset + 19] = fade
      }
      localData.set(local.positions.subarray(0, local.count * 4))
      localTexture.needsUpdate = true
      copyTexture.needsUpdate = true
      material.uniforms.uLocalCount.value = local.count
      material.uniforms.uSize.value = size
      material.uniforms.uGlow.value = glow
      geometry.instanceCount = live * local.count
      mesh.visible = live > 0
    },
    dispose() { disposePicking(); geometry.dispose(); material.dispose(); localTexture.dispose(); copyTexture.dispose() },
  }
}
