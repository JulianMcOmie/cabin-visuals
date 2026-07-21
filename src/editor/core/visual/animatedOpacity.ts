import type { Group, Material, ShaderMaterial } from 'three'

// The placement wrapper (ObjectRenderer) applies the opacity-mover value to every
// material under an object by writing `material.opacity = base * moverOpacity`,
// where `base` is remembered in userData. For static materials the base is
// captured once from the authored opacity. For materials an instrument ANIMATES
// per frame, capture-once is poison: whatever value happened to be present on
// first traverse (often 0 - e.g. TextDisplay before its first word note) becomes
// the permanent base, and the wrapper overwrites the animation every frame.
//
// So: any per-frame opacity write inside an instrument must go through
// setAnimatedOpacity, which keeps the recorded base in lockstep with the
// animation. The wrapper then composes mover opacity ON TOP of the animated
// value instead of fighting it.
//
// Raw ShaderMaterials are the exception: the renderer never uploads
// `material.opacity` for them (only built-in materials get that refresh), so
// the wrapper's write was a silent no-op and the visibility mover simply could
// not gate shader instruments (Photo, Stars, the particle systems...). Worse,
// the wrapper still flipped `transparent` off their authored alpha blending
// whenever the gate sat fully open, hard-edging every soft particle. Those
// materials go through the fragment wrap below: every gl_FragColor assignment
// gains a trailing alpha multiply by a gate uniform the wrapper drives each
// frame - the same base × gate composition standard materials get, with the
// shader's own alpha as the base. LineMaterial (the NeonPolar/HopfFibration fat
// lines) forwards `material.opacity` to its own uniform via a property
// accessor, so it stays on the standard path.

export const BASE_OPACITY_KEY = '__cabinBaseOpacity'
export const FORCE_TRANSPARENT_KEY = '__cabinForceTransparent'

/** The uniform the shader wrap multiplies into every gl_FragColor alpha. */
export const GATE_OPACITY_UNIFORM = '__cabinGateOpacity'
const SHADER_WRAPPED_KEY = '__cabinShaderOpacityWrapped'
const AUTHORED_TRANSPARENT_KEY = '__cabinAuthoredTransparent'

/** Instrument-side per-frame opacity write: sets the material's opacity AND its
 *  recorded base so the wrapper's mover pass multiplies rather than overwrites. */
export function setAnimatedOpacity(material: Material, opacity: number): void {
  material.opacity = opacity
  material.userData[BASE_OPACITY_KEY] = opacity
}

function clampOpacity(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** ShaderMaterials whose `material.opacity` write reaches the shader on its own
 *  (the fat-line materials forward it to a uniform) stay on the standard path. */
function isRawShaderMaterial(material: Material): material is ShaderMaterial {
  const maybe = material as ShaderMaterial & { isLineMaterial?: boolean }
  return maybe.isShaderMaterial === true && maybe.isLineMaterial !== true
}

/** Append an alpha multiply to every gl_FragColor assignment in the material's
 *  fragment shader, driven by a gate uniform. Patching each assignment (rather
 *  than renaming main and post-multiplying) keeps early returns and multi-branch
 *  shaders correct. Idempotent per material; one recompile on first wrap. */
function wrapShaderMaterial(material: ShaderMaterial): boolean {
  if (material.userData[SHADER_WRAPPED_KEY] === true) return true
  if (material.glslVersion) return false // GLSL3 writes to declared outs, not gl_FragColor
  const source = material.fragmentShader
  if (!/gl_FragColor\s*=[^;]+;/.test(source)) return false
  material.fragmentShader =
    `uniform float ${GATE_OPACITY_UNIFORM};\n` +
    source.replace(/gl_FragColor\s*=[^;]+;/g, (statement) => `${statement} gl_FragColor.a *= ${GATE_OPACITY_UNIFORM};`)
  material.uniforms = material.uniforms ?? {}
  material.uniforms[GATE_OPACITY_UNIFORM] = { value: 1 }
  material.userData[SHADER_WRAPPED_KEY] = true
  material.needsUpdate = true
  return true
}

/** Gate a raw ShaderMaterial through its wrap uniform, preserving the authored
 *  transparency (particle fades, glow falloffs) the standard path would have
 *  stomped off at a fully-open gate. */
function applyShaderMaterialOpacity(material: ShaderMaterial, resolvedOpacity: number): void {
  if (typeof material.userData[AUTHORED_TRANSPARENT_KEY] !== 'boolean') {
    material.userData[AUTHORED_TRANSPARENT_KEY] = material.transparent
  }
  material.uniforms[GATE_OPACITY_UNIFORM].value = resolvedOpacity
  material.transparent = (material.userData[AUTHORED_TRANSPARENT_KEY] as boolean)
    || material.userData[FORCE_TRANSPARENT_KEY] === true
    || resolvedOpacity < 0.999
}

/** Wrapper-side pass: multiply the object's mover opacity onto every material's
 *  base opacity (authored, or the instrument's latest animated value). */
export function applyMaterialOpacity(root: Group, opacity: number): void {
  const resolvedOpacity = clampOpacity(opacity)
  root.traverse((obj) => {
    const maybeMesh = obj as { material?: Material | Material[] }
    if (!maybeMesh.material) return
    const materials = Array.isArray(maybeMesh.material) ? maybeMesh.material : [maybeMesh.material]
    for (const material of materials) {
      if (isRawShaderMaterial(material) && wrapShaderMaterial(material)) {
        applyShaderMaterialOpacity(material, resolvedOpacity)
        continue
      }
      const baseOpacity = typeof material.userData[BASE_OPACITY_KEY] === 'number'
        ? material.userData[BASE_OPACITY_KEY] as number
        : material.opacity
      material.userData[BASE_OPACITY_KEY] = baseOpacity
      material.transparent = material.userData[FORCE_TRANSPARENT_KEY] === true
        || resolvedOpacity < 0.999
        || baseOpacity < 0.999
      material.opacity = clampOpacity(baseOpacity * resolvedOpacity)
    }
  })
}
