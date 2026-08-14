import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { isNumberParam } from '../../instruments/types'
import { listMoverOrSplitterDefinitions, getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { ENVELOPE_OPACITY_TARGET } from '../../core/visual/resolve'
import { TRANSFORM_PARAM_DEFS, withSpatialTransformParams, withTransformParams } from '../../core/transform'
import { compositionAutomatableParams, compositionDef, isCompositionTrack } from '../../core/directors'
import { getEffect } from '../../effects'
import { fxTarget } from '../../effects/automation'
import { NestedMenu, type NestedMenuGroup } from '../NestedMenu'
import { useUIStore } from '../../store/UIStore'

interface TrackContextMenuProps {
  x: number
  y: number
  trackId: string
  onClose: () => void
}

/**
 * Right-click menu on a track's label, rendered through the shared NestedMenu shell.
 * Submenus scoped to the track's instrument: ability lanes, movers, automatable params,
 * and effect-instance params. Items already present are checked + disabled.
 */
export function TrackContextMenu({ x, y, trackId, onClose }: TrackContextMenuProps) {
  const track = useProjectStore((s) => s.tracks[trackId])
  const tracks = useProjectStore((s) => s.tracks)
  const addAbilityTrack = useProjectStore((s) => s.addAbilityTrack)
  const addAutomationTrack = useProjectStore((s) => s.addAutomationTrack)
  const addEnvelopeTrack = useProjectStore((s) => s.addEnvelopeTrack)
  const addMoverTrack = useProjectStore((s) => s.addMoverTrack)
  const moveTrackToScene = useProjectStore((s) => s.moveTrackToScene)
  const ungroupTrack = useProjectStore((s) => s.ungroupTrack)
  const scenes = useProjectStore((s) => s.scenes)
  const sceneOrder = useProjectStore((s) => s.sceneOrder)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)

  if (!track) return null
  // A composition track (on Main) offers the shared Opacity + its def's
  // params, sampled per frame in VisualEngine's resolveComposition. It has no
  // object, so it never offers the tf* transform params - which is why the
  // object def is masked out for it below even for a dual-surface id like
  // crop.
  const activeIsMain = !!scenes[activeSceneId]?.isMain
  const directorDef = activeIsMain && track.type === 'base' ? compositionDef(track.instrumentId) : undefined
  const isComposition = activeIsMain && isCompositionTrack(track)
  const def = isComposition ? undefined : getInstrument(track.instrumentId)
  // Mover/splitter tracks have no instrument, but their definition has numeric
  // params of its own - automation children target those the exact same way.
  const moverDef = getMoverOrSplitterDefinition(
    track.type === 'mover' ? track.moverId : track.type === 'splitter' ? track.splitterId : undefined,
  )
  const abilities = def?.abilities ?? []
  // Only numeric params can be automated (keyframes interpolate a number). Object
  // tracks also offer the canonical transform params (core/transform.ts); SPLITTER
  // tracks offer the spatial ones - such a lane moves the splitter's copies in the
  // splitter's own reference frame, like a mover child (resolve.ts's splitter weave).
  const params = (def
    ? withTransformParams(def.params)
    : moverDef
      ? track.type === 'splitter' ? withSpatialTransformParams(moverDef.params) : moverDef.params
      // A GROUP automates its canonical transform (opacity included) - the
      // formation-as-one channel, inherited by the whole subtree.
      : track.type === 'group' ? TRANSFORM_PARAM_DEFS
        : isComposition ? compositionAutomatableParams(directorDef) : []
  ).filter(isNumberParam)
  // A mover/splitter track offers movers too, but they mean something different
  // there, and never join the object's chain: under a MOVER a child moves its
  // parent's field (core/visualCopies/moverFrame.ts); under a SPLITTER it moves
  // the splitter's copies in the splitter's own reference frame
  // (core/visualCopies/splitterChildChain.ts). Splitters and colorizers stay an
  // object-track affordance.
  // A GROUP track takes chain children too: they broadcast to the member
  // objects above them (resolve.ts's group pass), so the full mover/splitter/
  // colorizer catalog applies.
  const isGroup = track.type === 'group'
  const newDefs = def || moverDef || isGroup ? listMoverOrSplitterDefinitions() : []
  const movers = newDefs.filter((d) => d.kind === 'mover')
  const colorizers = def || isGroup ? newDefs.filter((d) => d.kind === 'colorizer') : []
  const splitters = def || isGroup ? newDefs.filter((d) => d.kind === 'splitter') : []
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))
  const envelopedParams = new Set(childTracks.filter((c) => c?.type === 'envelope').map((c) => c!.targetParam))
  // Same three-way rule as moveTrackToScene: Main accepts only composition
  // tracks; mainOnly composers (switcher/cut/radialCut) never leave Main; crop
  // and plain instruments move freely between visual scenes.
  const moveDef = track.type === 'base' ? compositionDef(track.instrumentId) : undefined
  const moveDestinations = !track.parentId && track.type !== 'audio'
    ? sceneOrder
      .map((id) => scenes[id])
      .filter((scene) => scene && scene.id !== activeSceneId && (scene.isMain
        ? isCompositionTrack(track)
        : !moveDef?.mainOnly))
    : []

  // Effect automation targets: per instance, its On/Off pseudo-param plus every
  // numeric plugin param, addressed by the fx-namespaced targetParam. Not
  // offered on a group: its broadcast effects have no engine-side lane
  // sampling yet, so a lane would be silently inert.
  const automatableEffects = isGroup ? [] : track.effects ?? []
  const fxNumericItems = automatableEffects.flatMap((inst) => {
    const plugin = getEffect(inst.pluginId)
    if (!plugin) return []
    return plugin.params.filter(isNumberParam).map((p) => ({
      key: fxTarget(inst.id, p.key),
      label: `${plugin.name} · ${p.label}`,
      envTarget: p.max,
    }))
  })
  const fxItems = automatableEffects.flatMap((inst) => {
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

  // Envelope targets: object tracks only - the reserved renderer-level Opacity first
  // (it wins over an instrument's own 'opacity' param, which is skipped to avoid a
  // duplicate entry), then the numeric params, then numeric effect settings. Each
  // carries the target value reached at full gain (param max; Opacity needs none).
  const envelopeItems = def
    ? [
        { key: ENVELOPE_OPACITY_TARGET, label: 'Opacity', envTarget: undefined as number | undefined },
        ...params
          .filter((p) => p.key !== ENVELOPE_OPACITY_TARGET)
          .map((p) => ({ key: p.key, label: p.label, envTarget: p.max as number | undefined })),
        ...fxNumericItems.map((f) => ({ key: f.key, label: f.label, envTarget: f.envTarget as number | undefined })),
      ]
    : []

  const groups: NestedMenuGroup[] = [
    {
      key: 'ability',
      label: 'Add ability track',
      items: abilities.map((a) => {
        const added = addedAbilities.has(a.key)
        return { id: a.key, label: a.label, disabled: added, checked: added, swatchColor: a.color ?? '#818cf8' }
      }),
    },
    {
      key: 'mover',
      label: def || isGroup ? 'Add mover track' : 'Move this mover with',
      items: movers.map((d) => ({ id: d.id, label: d.label })),
    },
    {
      key: 'colorizer',
      label: 'Add colorizer track',
      items: colorizers.map((d) => ({ id: d.id, label: d.label })),
    },
    {
      key: 'splitter',
      label: 'Add splitter track',
      items: splitters.map((d) => ({ id: d.id, label: d.label })),
    },
    {
      key: 'automation',
      label: 'Add automation track',
      items: params.map((p) => {
        const added = automatedParams.has(p.key)
        return { id: p.key, label: p.label, disabled: added, checked: added }
      }),
    },
    {
      key: 'envelope',
      label: 'Add envelope track',
      items: envelopeItems.map((item) => {
        const added = envelopedParams.has(item.key)
        return { id: item.key, label: item.label, disabled: added, checked: added }
      }),
    },
    {
      key: 'effect',
      label: 'Automate effect',
      items: fxItems.map((item) => {
        const added = automatedParams.has(item.key)
        return { id: item.key, label: item.label, disabled: added, checked: added }
      }),
    },
    {
      key: 'move-scene',
      label: 'Move to scene',
      items: moveDestinations.map((scene) => ({ id: scene.id, label: scene.name })),
    },
    // Dissolving a group is a single action (⌘⇧G on the selected group does the
    // same); one item keeps the shared submenu shell.
    {
      key: 'ungroup',
      label: 'Group',
      items: isGroup ? [{ id: 'ungroup', label: 'Ungroup' }] : [],
    },
  ]

  const onPick = (groupKey: string, itemId: string) => {
    if (groupKey === 'ability') {
      const a = abilities.find((ab) => ab.key === itemId)
      if (a) addAbilityTrack(trackId, a.key, a.label)
    } else if (groupKey === 'mover') {
      const d = movers.find((m) => m.id === itemId)
      if (d) addMoverTrack(trackId, d.id, d.label)
    } else if (groupKey === 'splitter') {
      const d = splitters.find((m) => m.id === itemId)
      if (d) addMoverTrack(trackId, d.id, d.label)
    } else if (groupKey === 'colorizer') {
      const d = colorizers.find((c) => c.id === itemId)
      if (d) addMoverTrack(trackId, d.id, d.label)
    } else if (groupKey === 'automation') {
      const p = params.find((pp) => pp.key === itemId)
      if (p) addAutomationTrack(trackId, p.key, p.label)
    } else if (groupKey === 'envelope') {
      const item = envelopeItems.find((f) => f.key === itemId)
      if (item) addEnvelopeTrack(trackId, item.key, item.label, item.envTarget)
    } else if (groupKey === 'effect') {
      const item = fxItems.find((f) => f.key === itemId)
      if (item) addAutomationTrack(trackId, item.key, item.label)
    } else if (groupKey === 'move-scene') {
      moveTrackToScene(trackId, itemId)
      useUIStore.getState().setSelectedTrackId(null)
    } else if (groupKey === 'ungroup') {
      ungroupTrack(trackId)
      useUIStore.getState().setSelectedTrackId(null)
    }
  }

  return <NestedMenu x={x} y={y} groups={groups} onPick={onPick} onClose={onClose} />
}
