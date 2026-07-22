import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { isNumberParam } from '../../instruments/types'
import { listMoverOrSplitterDefinitions, getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { ENVELOPE_OPACITY_TARGET } from '../../core/visual/resolve'
import { getEffect } from '../../effects'
import { fxTarget } from '../../effects/automation'
import { NestedMenu, type NestedMenuGroup } from '../NestedMenu'
import { SWAPPABLE_OBJECT_INSTRUMENTS } from '../LeftSidebar'
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
  const setTrackInstrument = useProjectStore((s) => s.setTrackInstrument)
  const moveTrackToScene = useProjectStore((s) => s.moveTrackToScene)
  const scenes = useProjectStore((s) => s.scenes)
  const sceneOrder = useProjectStore((s) => s.sceneOrder)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)

  if (!track) return null
  const def = getInstrument(track.instrumentId)
  // Mover/splitter tracks have no instrument, but their definition has numeric
  // params of its own - automation children target those the exact same way.
  const moverDef = getMoverOrSplitterDefinition(
    track.type === 'mover' ? track.moverId : track.type === 'splitter' ? track.splitterId : undefined,
  )
  const abilities = def?.abilities ?? []
  // Only numeric params can be automated (keyframes interpolate a number).
  const params = (def?.params ?? moverDef?.params ?? []).filter(isNumberParam)
  const newDefs = def ? listMoverOrSplitterDefinitions() : []
  const movers = newDefs.filter((d) => d.kind === 'mover')
  const colorizers = newDefs.filter((d) => d.kind === 'colorizer')
  const splitters = newDefs.filter((d) => d.kind === 'splitter')
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))
  const envelopedParams = new Set(childTracks.filter((c) => c?.type === 'envelope').map((c) => c!.targetParam))
  const moveDestinations = !track.parentId && track.type !== 'audio'
    ? sceneOrder
      .map((id) => scenes[id])
      .filter((scene) => scene && scene.id !== activeSceneId && scene.isMain === (track.type === 'director'))
    : []

  // Effect automation targets: per instance, its On/Off pseudo-param plus every
  // numeric plugin param, addressed by the fx-namespaced targetParam.
  const fxNumericItems = (track.effects ?? []).flatMap((inst) => {
    const plugin = getEffect(inst.pluginId)
    if (!plugin) return []
    return plugin.params.filter(isNumberParam).map((p) => ({
      key: fxTarget(inst.id, p.key),
      label: `${plugin.name} · ${p.label}`,
      envTarget: p.max,
    }))
  })
  const fxItems = (track.effects ?? []).flatMap((inst) => {
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
      label: 'Add mover track',
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
    {
      // Logic-style in-place swap: children, MIDI, targets and tags survive;
      // params reset to the new instrument's defaults (setTrackInstrument).
      key: 'change-instrument',
      label: 'Change instrument',
      items: def
        ? SWAPPABLE_OBJECT_INSTRUMENTS.map((item) => {
            const current = item.id === track.instrumentId
            return { id: item.id, label: item.name, disabled: current, checked: current }
          })
        : [],
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
    } else if (groupKey === 'change-instrument') {
      const item = SWAPPABLE_OBJECT_INSTRUMENTS.find((i) => i.id === itemId)
      if (item) setTrackInstrument(trackId, item.id, item.name)
    }
  }

  return <NestedMenu x={x} y={y} groups={groups} onPick={onPick} onClose={onClose} />
}
