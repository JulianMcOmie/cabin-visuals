import type { Group } from 'three'
import type { ParamDef } from '../instruments/types'

// Effects are plugins applied to an object's rendered output. Ported from Excellent
// DAW's plugin model. Transforms come first (wrap the object in a group and mutate it
// each frame); clone + shader categories land later.
export type EffectCategory = 'transform'

export interface VisualPlugin {
  id: string
  name: string
  category: EffectCategory
  /** User-facing knobs (same shape as an instrument's params). */
  params: ParamDef[]
  /** Transform plugins mutate the wrapping group each frame. `settings` are the
   *  instance's param values; `time` is the current beat (so effects are music-synced,
   *  like the objects). */
  applyTransform?: (group: Group, settings: Record<string, number>, time: number) => void
}
