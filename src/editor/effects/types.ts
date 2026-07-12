import type { Group, Matrix4 } from 'three'
import type { ParamDef } from '../instruments/types'

// Effects are plugins applied to an object's rendered output, ported from Excellent DAW.
// Two categories, chained per object: transform ▸ shader. (Clone effects were
// replaced by VisualCopy splitters.)
export type EffectCategory = 'transform' | 'shader'


export interface VisualEffect {
  id: string
  name: string
  category: EffectCategory
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
}
