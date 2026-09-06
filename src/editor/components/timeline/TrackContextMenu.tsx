import { useProjectStore } from '../../store/ProjectStore'
import { getInstrument } from '../../instruments'
import { listMoverOrSplitterDefinitions, getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { ENVELOPE_OPACITY_TARGET } from '../../core/visual/resolve'
import { compositionDef, isCompositionTrack } from '../../core/directors'
import { parseFxTarget } from '../../effects/automation'
import { NestedMenu, type NestedMenuGroup } from '../NestedMenu'
import { useUIStore } from '../../store/UIStore'
import { isSceneTrackId } from '../../core/sceneTrack'
import { automationTargetsForParent } from '../../utils/automationTargets'

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
  const wrapTracksInSwitcher = useProjectStore((s) => s.wrapTracksInSwitcher)
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
  const isComposition = activeIsMain && isCompositionTrack(track)
  const def = isComposition ? undefined : getInstrument(track.instrumentId)
  // Mover/splitter tracks have no instrument, but their definition has numeric
  // params of its own - automation children target those the exact same way.
  const moverDef = getMoverOrSplitterDefinition(
    track.type === 'mover' ? track.moverId : track.type === 'splitter' ? track.splitterId : undefined,
  )
  const abilities = def?.abilities ?? []
  const targets = automationTargetsForParent(track, activeIsMain)
  const params = targets.filter((target) => !parseFxTarget(target.key))
  const fxItems = targets.filter((target) => parseFxTarget(target.key))
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
  // A SWITCHER racks devices: the full catalog applies to it exactly as it does
  // to a group, and what lands there becomes another row of its lane.
  const isSwitcher = track.type === 'switcher'
  const isDevice = track.type === 'mover' || track.type === 'splitter'
  const isSceneTrack = isSceneTrackId(track.id)
  // `legacy` definitions (the library's Extras shelf: All Movers, Motion) are
  // left out entirely. The library can demote them into a collapsed folder;
  // this menu is one flat list per kind, so a superseded entry would sit right
  // beside the definition that replaced it.
  const newDefs = (def || moverDef || isGroup || isSwitcher ? listMoverOrSplitterDefinitions() : [])
    .filter((d) => !d.legacy)
  // A `parentGate` definition (Bypass) acts on the DEVICE it is nested under, so
  // it is only offered on a mover/splitter track - never on an object or a
  // group, where it would have nothing to gate - and never in the mover list,
  // which means something else there.
  const movers = newDefs.filter((d) => d.kind === 'mover' && !d.parentGate)
  // Not offered on a gate itself: nothing resolves a gate's own children, so a
  // Bypass under a Bypass would sit there doing nothing.
  const parentGates = moverDef && !moverDef.parentGate ? newDefs.filter((d) => d.parentGate) : []
  const colorizers = def || isGroup || isSwitcher ? newDefs.filter((d) => d.kind === 'colorizer') : []
  const splitters = def || isGroup || isSwitcher ? newDefs.filter((d) => d.kind === 'splitter') : []
  const childTracks = track.childIds.map((cid) => tracks[cid])
  const addedAbilities = new Set(childTracks.filter((c) => c?.type === 'ability').map((c) => c!.abilityKey))
  const automatedParams = new Set(childTracks.filter((c) => c?.type === 'automation').map((c) => c!.targetParam))
  const envelopedParams = new Set(childTracks.filter((c) => c?.type === 'envelope').map((c) => c!.targetParam))
  // Same three-way rule as moveTrackToScene: Main accepts only composition
  // tracks; mainOnly composers (switcher/cut/radialCut) never leave Main; crop
  // and plain instruments move freely between visual scenes.
  const moveDef = track.type === 'base' ? compositionDef(track.instrumentId) : undefined
  // The scene instrument belongs to its scene by definition - there is no
  // document entry to move, and offering it would be a dead item.
  const moveDestinations = !track.parentId && track.type !== 'audio' && !isSceneTrack
    ? sceneOrder
      .map((id) => scenes[id])
      .filter((scene) => scene && scene.id !== activeSceneId && (scene.isMain
        ? isCompositionTrack(track)
        : !moveDef?.mainOnly))
    : []

  // Envelope targets: object tracks only - the reserved renderer-level Opacity first
  // (it wins over an instrument's own 'opacity' param, which is skipped to avoid a
  // duplicate entry), then the numeric params, then numeric effect settings. Each
  // carries the target value reached at full gain (param max; Opacity needs none).
  const envelopeItems = def
    ? [
        { key: ENVELOPE_OPACITY_TARGET, label: 'Opacity', envTarget: undefined as number | undefined },
        ...targets
          .filter((p) => p.key !== ENVELOPE_OPACITY_TARGET)
          .filter((p) => p.bounds)
          .map((p) => ({ key: p.key, label: p.label, envTarget: p.bounds!.max as number | undefined })),
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
      label: def || isGroup || isSwitcher ? 'Add mover track' : 'Move this mover with',
      items: movers.map((d) => ({ id: d.id, label: d.label })),
    },
    {
      key: 'colorizer',
      label: 'Add colorizer track',
      items: colorizers.map((d) => ({ id: d.id, label: d.label })),
    },
    {
      key: 'parentGate',
      label: 'Switch this device with',
      items: parentGates.map((d) => ({ id: d.id, label: d.label })),
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
      // Ungroup is meaningless on the scene instrument: it holds no members
      // (the scene's tracks stay at root), and it cannot be dissolved - ⌘⇧S
      // hides it. See core/sceneTrack.ts.
      items: isGroup && !isSceneTrack ? [{ id: 'ungroup', label: 'Ungroup' }] : [],
    },
    // Racking a device is the one-track case of wrapTracksInSwitcher; unwrapping
    // splices the devices back where the rack stood, exactly as ungroup does.
    {
      key: 'switcher',
      label: 'Switcher',
      items: isSwitcher
        ? [{ id: 'unwrap', label: 'Unwrap switcher' }]
        : isDevice ? [{ id: 'wrap', label: 'Wrap in a switcher' }] : [],
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
    } else if (groupKey === 'parentGate') {
      const d = parentGates.find((g) => g.id === itemId)
      if (d) addMoverTrack(trackId, d.id, d.label)
    } else if (groupKey === 'automation') {
      const p = params.find((pp) => pp.key === itemId)
      // Count params (`integer` on the def) start their lane on the
      // whole-number grid with stepped interpolation.
      if (p) addAutomationTrack(trackId, p.key, p.label, { integer: p.integer })
    } else if (groupKey === 'envelope') {
      const item = envelopeItems.find((f) => f.key === itemId)
      if (item) addEnvelopeTrack(trackId, item.key, item.label, item.envTarget)
    } else if (groupKey === 'effect') {
      const item = fxItems.find((f) => f.key === itemId)
      if (item) addAutomationTrack(trackId, item.key, item.label, { integer: item.integer })
    } else if (groupKey === 'move-scene') {
      moveTrackToScene(trackId, itemId)
      useUIStore.getState().setSelectedTrackId(null)
    } else if (groupKey === 'ungroup') {
      ungroupTrack(trackId)
      useUIStore.getState().setSelectedTrackId(null)
    } else if (groupKey === 'switcher') {
      if (itemId === 'wrap') {
        const id = wrapTracksInSwitcher([trackId])
        if (id) useUIStore.getState().setSelectedTrackId(id)
      } else {
        ungroupTrack(trackId)
        useUIStore.getState().setSelectedTrackId(null)
      }
    }
  }

  return <NestedMenu x={x} y={y} groups={groups} onPick={onPick} onClose={onClose} />
}
