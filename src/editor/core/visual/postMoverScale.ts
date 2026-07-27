import { Matrix4 } from 'three'
import { effectiveEffectState, type EffectOverrides } from '../../effects/automation'
import { evaluateScaleEffect } from '../../effects/transforms/scale'
import type { EffectInstance } from '../../types'

const _scale = new Matrix4()

/** Product of every enabled Scale effect as sampled at this beat. Scale is the
 * only transform effect intentionally lifted outside the VisualCopy/mover
 * transform; other transform effects keep their ordinary nested-chain order. */
export function evaluatePostMoverScale(
  instances: readonly EffectInstance[],
  overrides: EffectOverrides | undefined,
  beat: number,
): number {
  let scale = 1
  for (const instance of instances) {
    if (instance.pluginId !== 'scale') continue
    const effect = effectiveEffectState(instance, overrides)
    if (effect.enabled) scale *= evaluateScaleEffect(effect.settings, beat)
  }
  return scale
}

/**
 * Compose `world × scale-effect × mover`.
 *
 * With column-vector transforms, the mover acts first and Scale acts on its
 * result, so mover translations expand/contract with the effect. The object's
 * instrument size is deliberately absent; renderers still append that later.
 */
export function composePostMoverScale(
  world: Matrix4,
  mover: Matrix4 | undefined,
  scale: number,
  out: Matrix4,
): Matrix4 {
  out.copy(world)
  if (scale !== 1) out.multiply(_scale.makeScale(scale, scale, scale))
  if (mover) out.multiply(mover)
  return out
}
