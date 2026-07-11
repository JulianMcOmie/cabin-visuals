import type { EffectInstance } from '../types'

// Effect automation rides the ordinary automation-track mechanism: a child
// automation track whose targetParam is namespaced `fx:<instanceId>:<key>`,
// where key is one of the plugin's numeric params or the pseudo-param
// 'enabled' (a 0/1 lane; >= 0.5 means on). resolve.ts turns these into
// keyframe lanes, computeAtBeat samples them into ObjectState.effectOverrides,
// and the effect wrappers read the merged view through effectiveEffectState.

const FX_PREFIX = 'fx:'

/** The automation targetParam addressing one effect instance's setting. */
export function fxTarget(instanceId: string, key: string): string {
  return `${FX_PREFIX}${instanceId}:${key}`
}

/** Parse an fx-namespaced targetParam; null for plain (instrument-param) targets. */
export function parseFxTarget(targetParam: string | undefined): { instanceId: string; key: string } | null {
  if (!targetParam || !targetParam.startsWith(FX_PREFIX)) return null
  const sep = targetParam.lastIndexOf(':')
  if (sep <= FX_PREFIX.length) return null
  return { instanceId: targetParam.slice(FX_PREFIX.length, sep), key: targetParam.slice(sep + 1) }
}

/** Per-frame sampled values for automated effects: instanceId → key → value. */
export type EffectOverrides = Record<string, Record<string, number>>

/**
 * An effect instance's settings/enabled as of THIS frame: the stored instance
 * merged with any sampled automation. No overrides for the instance = the
 * stored values pass through untouched (and unallocated).
 */
export function effectiveEffectState(
  instance: EffectInstance,
  overrides: EffectOverrides | undefined,
): { enabled: boolean; settings: Record<string, number> } {
  const o = overrides?.[instance.id]
  if (!o) return { enabled: instance.enabled, settings: instance.settings }
  const enabled = o.enabled !== undefined ? o.enabled >= 0.5 : instance.enabled
  const settings = { ...instance.settings }
  for (const key in o) if (key !== 'enabled') settings[key] = o[key]
  return { enabled, settings }
}
