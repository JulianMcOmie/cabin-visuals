import type { Group, Material } from 'three'

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

export const BASE_OPACITY_KEY = '__cabinBaseOpacity'
export const FORCE_TRANSPARENT_KEY = '__cabinForceTransparent'

/** Instrument-side per-frame opacity write: sets the material's opacity AND its
 *  recorded base so the wrapper's mover pass multiplies rather than overwrites. */
export function setAnimatedOpacity(material: Material, opacity: number): void {
  material.opacity = opacity
  material.userData[BASE_OPACITY_KEY] = opacity
}

function clampOpacity(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Wrapper-side pass: multiply the object's mover opacity onto every material's
 *  base opacity (authored, or the instrument's latest animated value). A raw
 *  ShaderMaterial ignores Material.opacity, so any material declaring a
 *  `uOpacity` uniform (the lasers, FilmStock) gets the same value written
 *  there too - one write site, same frame as the render. */
export function applyMaterialOpacity(root: Group, opacity: number): void {
  const resolvedOpacity = clampOpacity(opacity)
  root.traverse((obj) => {
    const maybeMesh = obj as { material?: Material | Material[] }
    if (!maybeMesh.material) return
    const materials = Array.isArray(maybeMesh.material) ? maybeMesh.material : [maybeMesh.material]
    for (const material of materials) {
      const baseOpacity = typeof material.userData[BASE_OPACITY_KEY] === 'number'
        ? material.userData[BASE_OPACITY_KEY] as number
        : material.opacity
      material.userData[BASE_OPACITY_KEY] = baseOpacity
      material.transparent = material.userData[FORCE_TRANSPARENT_KEY] === true
        || resolvedOpacity < 0.999
        || baseOpacity < 0.999
      material.opacity = clampOpacity(baseOpacity * resolvedOpacity)
      const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms
      if (uniforms?.uOpacity) uniforms.uOpacity.value = material.opacity
    }
  })
}
