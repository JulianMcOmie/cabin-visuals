import type { Group, Matrix4 } from 'three'
import type { ParamDef } from '../instruments/types'

// Effects are plugins applied to an object's rendered output, ported from Excellent DAW.
// Three categories, chained per object (plan §4.6): transform ▸ clone ▸ shader.
export type EffectCategory = 'transform' | 'clone' | 'shader'

/** What a clone plugin produces: how many copies to render, each copy's transform, and
 *  optionally its opacity (for trail/falloff). Evaluated per frame; `time` = the beat. */
export interface CloneSpec {
  count: number
  getTransform: (index: number, settings: Record<string, number>, time: number) => Matrix4
  /** 0..1 per copy — drives trail/edge fade (echo, linear duplicate). Omit for opaque. */
  getOpacity?: (index: number, settings: Record<string, number>, time: number) => number
}

export interface VisualPlugin {
  id: string
  name: string
  category: EffectCategory
  /** User-facing knobs (same shape as an instrument's params). Enum/boolean settings are
   *  encoded as numeric params for now (e.g. axis 0/1/2, a toggle as 0/1). */
  params: ParamDef[]
  /** Transform plugins mutate the wrapping group each frame. `settings` are the instance's
   *  param values; `time` is the current beat (so effects are music-synced). */
  applyTransform?: (group: Group, settings: Record<string, number>, time: number) => void
  /** Clone plugins replicate the object into `count` copies, each with its own transform. */
  getClones?: (settings: Record<string, number>) => CloneSpec
  /** Shader plugins: a GLSL fragment shader (screen-space; samples `tDiffuse`, sees
   *  `time`/`resolution` + a uniform per param). Applied as an FBO post-process pass. */
  fragmentShader?: string
  vertexShader?: string
}
