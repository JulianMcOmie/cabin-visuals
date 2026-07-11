import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { isNumberParam } from '../../instruments/types'
import { moverInputParamDefs, moverRegistry, getMover } from '../../core/visual/movers/registry'
import { getEffect } from '../../effects'
import { fxTarget } from '../../effects/automation'
import { NestedMenu, type NestedMenuGroup } from '../NestedMenu'

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
  const addMoverTrack = useProjectStore((s) => s.addMoverTrack)

  if (!track) return null
  const def = getInstrument(track.instrumentId)
  const dimDef = track.type === 'mover' ? getMover(track.moverId) : undefined
  const abilities = def?.abilities ?? []
  // Only numeric params can be automated (keyframes interpolate a number).
  const params = track.type === 'mover' && dimDef
    ? moverInputParamDefs(dimDef).filter(isNumberParam)
    : (def?.params ?? []).filter(isNumberParam)
  const movers = def ? Object.values(moverRegistry) : []
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))

  // Effect automation targets: per instance, its On/Off pseudo-param plus every
  // numeric plugin param, addressed by the fx-namespaced targetParam.
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
      key: 'automation',
      label: 'Add automation track',
      items: params.map((p) => {
        const added = automatedParams.has(p.key)
        return { id: p.key, label: p.label, disabled: added, checked: added }
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
  ]

  const onPick = (groupKey: string, itemId: string) => {
    if (groupKey === 'ability') {
      const a = abilities.find((ab) => ab.key === itemId)
      if (a) addAbilityTrack(trackId, a.key, a.label)
    } else if (groupKey === 'mover') {
      const d = movers.find((m) => m.id === itemId)
      if (d) addMoverTrack(trackId, d.id, d.label)
    } else if (groupKey === 'automation') {
      const p = params.find((pp) => pp.key === itemId)
      if (p) addAutomationTrack(trackId, p.key, p.label)
    } else if (groupKey === 'effect') {
      const item = fxItems.find((f) => f.key === itemId)
      if (item) addAutomationTrack(trackId, item.key, item.label)
    }
  }

  return <NestedMenu x={x} y={y} groups={groups} onPick={onPick} onClose={onClose} />
}
