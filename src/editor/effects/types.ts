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
// a moving object instead of belonging to it. Material plugins come in two shapes:
// a `materialField` GLSL chunk injected into built-in materials (Kaleido Skin), or
// an `applyMaterial`/`restoreMaterial` pair that re-materials the meshes per frame
// (Texturizer) - a plugin declares exactly one of the two.
//
// `deform` is the fourth, and the only one that moves the mesh's own VERTICES.
// A `transform` effect moves the wrapping Group (the whole object rigidly); a
// deformer rewrites `transformed` inside the vertex shader, so the surface
// itself twists, bends and ripples. It shares MaterialWrapper's injection hook
// rather than owning a second patcher - two `onBeforeCompile` wrappers fighting
// over one material is how you get a shader that compiles differently depending
// on mount order. It therefore inherits that path's limit exactly: instruments
// drawing with their own raw ShaderMaterial are left untouched.
export type EffectCategory = 'transform' | 'shader' | 'material' | 'deform'


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
  /** Deform plugins: GLSL injected into the TARGET's own materials alongside a
   *  `materialField`, rewriting the vertex position in the mesh's OWN space.
   *  Takes a `suffix` because deformers STACK (unlike generated surfaces, two
   *  deformers compose perfectly - twist then bend), and every instance's
   *  uniforms and function name must therefore be unique within one program.
   *  The chunk must
   *  - declare `uniform float <uniformName(key, suffix)>` for each of its params
   *    plus `uKBeat` (the beat, shared and declared once by the wrapper), and
   *  - define `vec3 fxApply<suffix>(vec3 pos, vec3 nrm)` returning the new
   *    object-space position, and
   *  - define `vec3 fxDeformNormal<suffix>(vec3 pos, vec3 nrm, vec3 moved)`
   *    returning the normal at the moved point (the wrapper calls it only for
   *    lit materials, and only on the last entry of a stack).
   *  Same injection limits as `materialField`. */
  vertexField?: (suffix: string) => string
  /** Deform plugins may also need the target TESSELLATED - a `boxGeometry` has
   *  eight vertices and cannot bend. The wrapper swaps in a subdivided clone at
   *  this level (and restores the original), mirroring how Texturizer swaps
   *  materials. Read from the instance's settings by key. */
  subdivideParam?: string
  /** Material plugins re-material the wrapped group's meshes each frame (same purity
   *  contract as applyTransform: a function of settings + beat, caching allowed). The
   *  plugin must leave the instrument's own materials intact and restorable. */
  applyMaterial?: (root: Group, settings: Record<string, number>, time: number) => void
  /** Undo applyMaterial's swaps (called every frame while the instance is disabled,
   *  and on unmount) - must be idempotent and cheap once restored. */
  restoreMaterial?: (root: Group) => void
}
