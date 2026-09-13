import { BufferGeometry, DataTexture, FloatType, GLSL3, InstancedBufferGeometry, Matrix4, Mesh, PlaneGeometry, Points, RGBAFormat } from 'three'
import type { ParticlePlan } from '../core/visualCopies/particlePlan'
import { attachParticlePlanPicking } from './particlePlanPicking'
import { createParticleMaterial } from './particleCore'

/** One quad, one compact layout texture, and an instance count. There are no
 * per-particle attributes or instance matrices to allocate or upload. */
export function createParticlePlanMesh(plan: ParticlePlan, points = false) {
  const stageValues = (values: readonly number[] | undefined, fallback = 0) => {
    const array = new Int32Array(16).fill(fallback)
    if (values) array.set(values)
    return array
  }
  const width = Math.min(1024, plan.matrices.length / 4)
  const height = Math.ceil(plan.matrices.length / 4 / width)
  const values = new Float32Array(width * height * 4)
  values.set(plan.matrices)
  let texture = new DataTexture(values, width, height, RGBAFormat, FloatType)
  texture.needsUpdate = true
  const plane = new PlaneGeometry(2, 2)
  const geometry = points ? new BufferGeometry() : new InstancedBufferGeometry()
  if (!points) {
    geometry.setIndex(plane.index)
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
  }
  if (geometry instanceof InstancedBufferGeometry) geometry.instanceCount = plan.count
  else geometry.setDrawRange(0, plan.count)
  const material = createParticleMaterial()
  material.name = 'Factored Particle'
  material.glslVersion = GLSL3
  Object.assign(material.uniforms, {
    uLayouts: { value: texture }, uLayoutWidth: { value: width },
    uStages: { value: plan.counts.length }, uTotal: { value: plan.count },
    uCounts: { value: Int32Array.from([...plan.counts, ...new Array(16 - plan.counts.length).fill(1)]) },
    uOffsets: { value: Int32Array.from([...plan.offsets, ...new Array(16 - plan.offsets.length).fill(0)]) },
    uProgram: { value: plan.program ? 1 : 0 },
    uKinds: { value: stageValues(plan.program?.kinds) },
    uInternalOffsets: { value: stageValues(plan.program?.internalOffsets) },
    uBareOffsets: { value: stageValues(plan.program?.bareOffsets) },
    uGuardOffsets: { value: stageValues(plan.program?.guardOffsets, -1) },
    uGuardStrides: { value: stageValues(plan.program?.guardStrides, 1) },
    uAppearanceOffsets: { value: stageValues(plan.appearanceOffsets, -1) },
    uBareAppearanceOffsets: { value: stageValues(plan.bareAppearanceOffsets, -1) },
    uPlacement: { value: new Matrix4() }, uMeshScale: { value: 1 },
    uViewportHeight: { value: 1 },
  })
  material.vertexShader = `
    uniform sampler2D uLayouts;
    uniform int uLayoutWidth, uStages, uTotal;
    uniform int uCounts[16], uOffsets[16];
    uniform int uProgram, uKinds[16], uInternalOffsets[16], uBareOffsets[16];
    uniform int uGuardOffsets[16], uGuardStrides[16];
    uniform int uAppearanceOffsets[16], uBareAppearanceOffsets[16];
    uniform mat4 uPlacement;
    uniform float uMeshScale, uMinRadiusNdc, uOpacity, uViewportHeight;
    uniform vec3 uColor;
    out vec2 vUv;
    out vec4 vColor;
    out float vPointSize;
    vec4 layoutColumn(int index) {
      return texelFetch(uLayouts, ivec2(index % uLayoutWidth, index / uLayoutWidth), 0);
    }
    mat4 layoutMatrix(int index) {
      int p = index * 4;
      return mat4(layoutColumn(p), layoutColumn(p+1), layoutColumn(p+2), layoutColumn(p+3));
    }
    float layoutScalar(int index) {
      return layoutColumn(index / 4)[index % 4];
    }
    // Match Color.offsetHSL on the source's linear RGB values. Copies add hue
    // along the chain; convert only once, after every contribution is known.
    float hueChannel(float p, float q, float h) {
      h = fract(h);
      if (h < 1.0 / 6.0) return p + (q - p) * 6.0 * h;
      if (h < 0.5) return q;
      if (h < 2.0 / 3.0) return p + (q - p) * 6.0 * (2.0 / 3.0 - h);
      return p;
    }
    vec3 shiftHue(vec3 rgb, float shift) {
      if (shift == 0.0) return rgb;
      float high = max(rgb.r, max(rgb.g, rgb.b));
      float low = min(rgb.r, min(rgb.g, rgb.b));
      float delta = high - low;
      if (delta == 0.0) return rgb;
      float lightness = (low + high) * 0.5;
      float saturation = lightness <= 0.5 ? delta / (high + low) : delta / (2.0 - high - low);
      float hue = high == rgb.r ? (rgb.g - rgb.b) / delta + (rgb.g < rgb.b ? 6.0 : 0.0)
        : high == rgb.g ? (rgb.b - rgb.r) / delta + 2.0 : (rgb.r - rgb.g) / delta + 4.0;
      hue = fract(hue / 6.0 + shift);
      float q = lightness <= 0.5 ? lightness * (1.0 + saturation) : lightness + saturation - lightness * saturation;
      float p = 2.0 * lightness - q;
      return vec3(hueChannel(p, q, hue + 1.0 / 3.0), hueChannel(p, q, hue), hueChannel(p, q, hue - 1.0 / 3.0));
    }
    void main() {
      mat4 world = uProgram == 0 ? uPlacement : mat4(1.0);
      mat4 internal = mat4(1.0);
      int stride = uTotal;
      float opacity = 1.0, hue = 0.0;
      #ifdef PARTICLE_POINTS
        int index = gl_VertexID;
      #else
        int index = gl_InstanceID;
      #endif
      for (int stage = 0; stage < 16; stage++) {
        if (stage >= uStages) break;
        stride /= uCounts[stage];
        int slot = (index / stride) % uCounts[stage];
        int kind = uProgram == 0 ? 0 : uKinds[stage];
        bool applyMotion = true;
        if (kind == 2) {
          int guard = uGuardOffsets[stage];
          applyMotion = guard == -1;
          if (guard >= 0) {
            int flag = guard + index / uGuardStrides[stage];
            applyMotion = layoutColumn(flag / 4)[flag % 4] > 0.5;
          }
          world *= layoutMatrix((applyMotion ? uOffsets[stage] : uBareOffsets[stage]) + slot);
          if (applyMotion) internal *= layoutMatrix(uInternalOffsets[stage] + slot);
        } else if (kind == 1) {
          world = layoutMatrix(uOffsets[stage] + slot) * world;
        } else {
          world *= layoutMatrix(uOffsets[stage] + slot);
        }
        int appearance = applyMotion ? uAppearanceOffsets[stage] : uBareAppearanceOffsets[stage];
        if (appearance >= 0) {
          opacity *= layoutScalar(appearance + slot * 2);
          hue += layoutScalar(appearance + slot * 2 + 1);
        }
      }
      float fade = min(1.0, uOpacity * opacity);
      if (fade <= 0.001) {
        // MIDI gates and unborn trail slots keep their stable indices, but
        // should consume no fragments, just like the CPU's live-instance pack.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        vPointSize = 0.0; vUv = vec2(0.0); vColor = vec4(0.0);
        return;
      }
      if (uProgram != 0) world = uPlacement * world * internal;
      float diameter = max(length(world[0].xyz), max(length(world[1].xyz), length(world[2].xyz))) * abs(uMeshScale);
      vec4 center = viewMatrix * world[3];
      diameter = max(diameter, uMinRadiusNdc * abs(center.z) / projectionMatrix[1][1]);
      #ifdef PARTICLE_POINTS
        float divisor = projectionMatrix[2][3] == 0.0 ? 1.0 : abs(center.z);
        vPointSize = diameter * projectionMatrix[1][1] * uViewportHeight / divisor;
        gl_PointSize = max(1.0, vPointSize);
      #else
        center.xy += position.xy * diameter;
        vUv = uv;
      #endif
      gl_Position = projectionMatrix * center;
      vColor = vec4(shiftHue(uColor, hue), fade);
    }
  `
  material.fragmentShader = 'out vec4 outColor;\n' + material.fragmentShader.replaceAll('varying ', 'in ').replaceAll('gl_FragColor', 'outColor')
  material.fragmentShader = material.fragmentShader.replace('void main() {', 'void main() {\nif (vColor.a <= 0.001) discard;')
  if (points) {
    material.defines.PARTICLE_POINTS = 1
    material.fragmentShader = material.fragmentShader.replace('in vec2 vUv;', 'in float vPointSize;\n#define vUv ((gl_PointCoord - 0.5) * max(1.0, vPointSize) / max(0.00001, vPointSize) + 0.5)')
      .replace('void main() {', 'void main() {\nif (vPointSize <= 0.0) discard;')
  }
  const mesh = points ? new Points(geometry, material) : new Mesh(geometry, material)
  mesh.name = 'Factored Particle instances'
  mesh.frustumCulled = false
  const disposePicking = attachParticlePlanPicking(mesh)
  return {
    mesh,
    points,
    get texture() { return texture },
    update(next: ParticlePlan) {
      // Reuse the mesh, shader and texture allocation while knobs/count lanes
      // animate. The upload is the sum of stage sizes, never their product.
      if ((texture.image.data as Float32Array).length < next.matrices.length) {
        texture.dispose()
        const width = Math.min(1024, next.matrices.length / 4)
        const height = Math.ceil(next.matrices.length / 4 / width)
        texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType)
        material.uniforms.uLayouts.value = texture
        material.uniforms.uLayoutWidth.value = width
      }
      ;(texture.image.data as Float32Array).set(next.matrices)
      texture.needsUpdate = true
      if (geometry instanceof InstancedBufferGeometry) geometry.instanceCount = next.count
      else geometry.setDrawRange(0, next.count)
      material.uniforms.uStages.value = next.counts.length
      material.uniforms.uTotal.value = next.count
      material.uniforms.uCounts.value.set(next.counts)
      material.uniforms.uOffsets.value.set(next.offsets)
      material.uniforms.uProgram.value = next.program ? 1 : 0
      material.uniforms.uAppearanceOffsets.value.fill(-1)
      material.uniforms.uBareAppearanceOffsets.value.fill(-1)
      if (next.appearanceOffsets) material.uniforms.uAppearanceOffsets.value.set(next.appearanceOffsets)
      if (next.bareAppearanceOffsets) material.uniforms.uBareAppearanceOffsets.value.set(next.bareAppearanceOffsets)
      if (next.program) {
        material.uniforms.uKinds.value.set(next.program.kinds)
        material.uniforms.uInternalOffsets.value.set(next.program.internalOffsets)
        material.uniforms.uBareOffsets.value.set(next.program.bareOffsets)
        material.uniforms.uGuardOffsets.value.set(next.program.guardOffsets)
        material.uniforms.uGuardStrides.value.set(next.program.guardStrides)
      }
    },
    dispose() { disposePicking(); geometry.dispose(); material.dispose(); texture.dispose() },
  }
}
