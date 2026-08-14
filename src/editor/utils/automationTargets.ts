// The targets an automation lane under a given parent can drive, resolved at
// the COMPONENT layer: ProjectStore can't read instrument defs (components
// import stores - instant cycle), so the timeline drag commits resolve this
// list here and hand it to the store's remapAutomationTarget.

import { getInstrument } from '../instruments'
import { isNumberParam } from '../instruments/types'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { compositionAutomatableParams, compositionDef, isCompositionTrack } from '../core/directors'
import { TRANSFORM_PARAM_DEFS, withSpatialTransformParams, withTransformParams } from '../core/transform'
import { getEffect } from '../effects'
import { fxTarget } from '../effects/automation'
import type { Track } from '../types'

export interface AutomationTargetOption {
  key: string
  label: string
}

/**
 * Every target an automation lane under `parent` could drive, in the order the
 * context menu offers them: the parent's params first (object tracks add the
 * canonical transforms, splitters the spatial ones - see core/transform.ts),
 * then the fx-namespaced effect settings. That order makes index 0 the natural
 * default when a drag forces a retarget. `mainActive` gates the composition
 * arm exactly like the menu (a composition id only composes on Main).
 */
export function automationTargetsForParent(parent: Track, mainActive: boolean): AutomationTargetOption[] {
  const composition = mainActive && isCompositionTrack(parent)
  const def = composition ? undefined : getInstrument(parent.instrumentId)
  const moverDef = getMoverOrSplitterDefinition(
    parent.type === 'mover' ? parent.moverId : parent.type === 'splitter' ? parent.splitterId : undefined,
  )
  const params = (def
    ? withTransformParams(def.params)
    : moverDef
      ? parent.type === 'splitter' ? withSpatialTransformParams(moverDef.params) : moverDef.params
      // A GROUP's lanes drive its canonical transform (opacity included).
      : parent.type === 'group'
        ? TRANSFORM_PARAM_DEFS
        : composition ? compositionAutomatableParams(compositionDef(parent.instrumentId)) : []
  ).filter(isNumberParam)
  const fxItems = (parent.effects ?? []).flatMap((inst) => {
    const plugin = getEffect(inst.pluginId)
    if (!plugin) return []
    return [
      { key: fxTarget(inst.id, 'enabled'), label: `${plugin.name} · On/Off` },
      ...plugin.params.filter(isNumberParam).map((p) => ({
        key: fxTarget(inst.id, p.key),
        label: `${plugin.name} · ${p.label}`,
      })),
    ]
  })
  return [...params.map((p) => ({ key: p.key, label: p.label })), ...fxItems]
}

/** Whether the lane still wears its auto-name (its current target's label under
 *  its CURRENT parent) - the `rename` flag remapAutomationTarget expects, read
 *  BEFORE the move so the old parent still resolves the label. */
export function laneWearsAutoName(lane: Track, parent: Track, mainActive: boolean): boolean {
  const label = automationTargetsForParent(parent, mainActive)
    .find((o) => o.key === lane.targetParam)?.label
  return !!label && lane.name === label
}
