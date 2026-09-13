import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import type { EffectInstance, Track } from '../../types'

function canEnable(tracks: Record<string, Track>, track: Track, effectId: string): boolean {
  return (track.childIds ?? []).some(id => {
    const lane = tracks[id]
    const target = lane?.type === 'automation' ? parseFxTarget(lane.targetParam) : null
    // Structural, like ObjectRenderer: even empty or muted lanes keep their
    // effect available, so editing notes never requires a different renderer.
    return target?.key === 'enabled' && target.instanceId === effectId
  })
}

/** Whether a copy needs effect machinery the pooled renderer cannot apply.
 * Own Scale is supported by the pool. Other effects can be omitted only when
 * explicitly disabled and unable to turn on through an enable lane. Group
 * effects wrap members in ObjectRenderer; their enabled Scale is not the
 * pool's own Scale channel, so it still requires the per-copy renderer. */
export function hasUnbatchableEffects(tracks: Record<string, Track> | undefined, trackId: string): boolean {
  const track = tracks?.[trackId]
  if (!tracks || !track) return true
  const active = (effect: EffectInstance, owner: Track) => effect.enabled !== false
    || !effect.id || !getEffect(effect.pluginId)
    || canEnable(tracks, owner, effect.id)
    // ObjectRenderer merges ancestor effects, then checks the member's own
    // enable-lane ids. Check both owners conservatively for inherited effects.
    || (owner !== track && canEnable(tracks, track, effect.id))
  if (track.effects?.some(effect => effect.pluginId !== 'scale' && active(effect, track))) return true
  const seen = new Set([trackId])
  for (let parent = track.parentId; parent; parent = tracks[parent]?.parentId) {
    if (seen.has(parent) || !tracks[parent]) return true
    seen.add(parent)
    const ancestor = tracks[parent]
    if (ancestor.type === 'group' && ancestor.effects?.some(effect => active(effect, ancestor))) return true
  }
  return false
}
