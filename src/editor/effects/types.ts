import type { Group } from 'three'
import type { ParamDef } from '../instruments/types'

// Effects are plugins applied to an object's rendered output, ported from Excellent DAW.
// Three categories, chained per object: material ▸ transform ▸ shader. Scale is the
// deliberate ordering exception: renderers lift it outside VisualCopy movers. (Clone
// effects were replaced by VisualCopy splitters.)
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
  /** Material plugins re-material the wrapped group's meshes each frame (same purity
   *  contract as applyTransform: a function of settings + beat, caching allowed). The
   *  plugin must leave the instrument's own materials intact and restorable. */
  applyMaterial?: (root: Group, settings: Record<string, number>, time: number) => void
  /** Undo applyMaterial's swaps (called every frame while the instance is disabled,
   *  and on unmount) - must be idempotent and cheap once restored. */
  restoreMaterial?: (root: Group) => void
}
