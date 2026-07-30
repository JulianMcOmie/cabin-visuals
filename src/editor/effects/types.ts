import type { Group } from 'three'
import type { ParamDef } from '../instruments/types'

// Effects are plugins applied to an object's rendered output, ported from Excellent DAW.
// Three categories, chained per object: material ▸ transform ▸ shader. Scale is the
// deliberate ordering exception: renderers lift it outside VisualCopy movers. (Clone
// effects were replaced by VisualCopy splitters.)
//
// `material` is the newest and the odd one out: instead of processing the object's
// OUTPUT, it reaches into the target's own materials and generates their surface.
// That is the only way to get a texture that is bolted to the mesh and travels with
// it - a screen-space `shader` pass is frame-relative, so its pattern slides across
// a moving object instead of belonging to it.
export type EffectCategory = 'transform' | 'shader' | 'material'


export interface VisualEffect {
  id: string
  name: string
  category: EffectCategory
  /** Hidden from the add-effect menu (existing instances keep rendering). The
   *  base transform effects are deprecated in favor of the canonical track
   *  transform panel (core/transform.ts). */
  deprecated?: boolean
  /** User-facing knobs (same shape as an instrument's params). Enum/boolean settings are
   *  encoded as numeric params for now (e.g. axis 0/1/2, a toggle as 0/1). */
  params: ParamDef[]
  /** Transform plugins mutate the wrapping group each frame. `settings` are the instance's
   *  param values; `time` is the current beat (so effects are music-synced). */
  applyTransform?: (group: Group, settings: Record<string, number>, time: number) => void
  /** Shader plugins: a GLSL fragment shader (screen-space; samples `tDiffuse`, sees
   *  `time`/`resolution` + a uniform per param). Applied as an FBO post-process pass. */
  fragmentShader?: string
  vertexShader?: string
  /** Material plugins: GLSL injected into the TARGET's own materials by
   *  `components/visual/MaterialWrapper.tsx`, so the pattern is generated on the
   *  surface and rides along as the mesh moves. The chunk must
   *  - declare `uniform float <uniformName(key)>` for each of its params plus
   *    `uKBeat` (the beat), and
   *  - define `vec3 kaleidoField(vec3 objDir)` returning linear albedo for a
   *    direction in the mesh's OWN space.
   *  Only bites on three's built-in materials (the injection keys off
   *  `#include <common>` / `vec4 diffuseColor`); instruments that draw with their
   *  own raw ShaderMaterial are left untouched. */
  materialField?: string
}
