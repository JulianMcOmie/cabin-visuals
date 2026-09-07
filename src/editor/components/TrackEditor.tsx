'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Check, Plus, X } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { tracksWithTag } from '../utils/trackTags'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { compositionDef, isCompositionTrack } from '../core/directors'
import { CompositionSettingsPanel } from './CompositionSettingsPanel'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import { TRANSFORM_PARAM_DEFS } from '../core/transform'
import { ENVELOPE_OPACITY_TARGET } from '../core/visual/resolve'
import { DEFAULT_SPLINE_TENSION, automationMode } from '../core/visual/automation'
import { getEffect, PLUGIN_LIST, type VisualEffect, type EffectCategory } from '../effects'
import { parseFxTarget } from '../effects/automation'
import { NestedMenu, type NestedMenuGroup } from './NestedMenu'
import { AudioTrackDetail } from './AudioTrackDetail'
import { SceneSettingsPanel } from './SceneSettingsPanel'
import { isNumberParam, isStringParam } from '../instruments/types'
import { getUserInterfaceRenderer, ParamControl, type UserInterfaceParameter } from '../userInterfaceRenderers'
import { getEffectUserInterface, getMoverUserInterface } from '../userInterfaceRenderers/bespokeRegistries'
import { consolePanel } from '../userInterfaceRenderers/console'
import { EnvelopeUserInterface } from '../userInterfaceRenderers/EnvelopeUserInterface'
import { AutomationUserInterface } from '../userInterfaceRenderers/AutomationUserInterface'
import { CopyTargetsUserInterface } from '../userInterfaceRenderers/CopyTargetsUserInterface'
import { SwitcherUserInterface } from '../userInterfaceRenderers/SwitcherUserInterface'
import { resolveTrackDisplayColor, resolveTrackIdentityColor } from '../utils/trackDisplayColor'
import { withAlpha } from '../userInterfaceRenderers/colorWheel'
import type { Routing, EffectInstance, Scene, Track } from '../types'
import { isSceneTrackId } from '../core/sceneTrack'
import { automationTargetsForParent } from '../utils/automationTargets'

type Tab = 'instrument' | 'effects' | 'targets'

/** The track's instrument color, if its definition exposes a `color` string
 *  param - the accent that lights the instrument chassis and its effect LEDs.
 *  Null for instruments without a color (they get neutral chrome). */
function instrumentAccent(track: Track): string | null {
  const def = getInstrument(track.instrumentId)
  const colorParam = def?.params.find((p) => p.key === 'color' && isStringParam(p))
  if (!colorParam) return null
  return track.stringParams?.color ?? String(colorParam.default)
}

/** A select-styled dropdown for checking multiple targets (tags and/or tracks). */
function TargetSelect({
  options, selected, onToggle,
}: {
  options: { key: string; label: string }[]
  selected: Set<string>
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const chosen = options.filter((o) => selected.has(o.key))
  const summary = chosen.length === 0 ? '- none -' : chosen.map((o) => o.label).join(', ')

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full h-7 px-2 flex items-center justify-between gap-2 rounded bg-[var(--bg-app)] text-[11px] border border-[var(--border)] outline-none hover:border-[var(--border-strong)] cursor-pointer"
      >
        <span className={`truncate ${chosen.length === 0 ? 'text-[var(--text-muted)]' : 'text-[var(--text-2)]'}`}>{summary}</span>
        <ChevronDown size={13} className="flex-shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg shadow-black/40 py-1">
          {options.map((o) => {
            const isChecked = selected.has(o.key)
            return (
              <button
                key={o.key}
                onClick={() => onToggle(o.key)}
                className="w-full px-2 h-7 flex items-center gap-2 text-[11px] text-[var(--text-2)] hover:bg-[var(--border)] cursor-pointer"
              >
                <span
                  className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center ${
                    isChecked ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-strong)]'
                  }`}
                >
                  {isChecked && <Check size={11} className="text-[var(--on-accent)]" strokeWidth={3} />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The picker menu's groups, generated from the registry so a new plugin shows up
// here with no extra wiring. Category order is fixed below.
const EFFECT_CATEGORIES: { key: EffectCategory; label: string }[] = [
  { key: 'transform', label: 'Transform' },
  // 'Surface' rather than 'Material': these GENERATE the object's surface (the
  // pattern is bolted to the mesh and travels with it), which is what the user is
  // choosing between - not the fact that a three material is what gets patched.
  { key: 'material', label: 'Surface' },
  // 'Deform' rather than 'Vertex': what the user is choosing is that the MESH
  // itself bends, as against Transform, which moves the whole object rigidly.
  { key: 'deform', label: 'Deform' },
  { key: 'shader', label: 'Shader' },
]
const EFFECT_MENU_GROUPS: NestedMenuGroup[] = EFFECT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  items: PLUGIN_LIST.filter((p) => p.category === c.key && !p.deprecated).map((p) => ({ id: p.id, label: p.name })),
}))
// Scene-category effects are full-frame passes over a scene's finished render -
// they only run on a Scene FX chain, so the picker offers ONLY them there and
// never offers them on an object/group chain, where they would sit inert.
const SCENE_EFFECT_MENU_GROUPS: NestedMenuGroup[] = [{
  key: 'scene',
  label: 'Scene',
  items: PLUGIN_LIST.filter((p) => p.category === 'scene' && !p.deprecated).map((p) => ({ id: p.id, label: p.name })),
}]

/** One effect in the Effects tab, styled as a device in a rack (the Ableton
 *  read): a chassis card whose header carries a power LED (lit by the parent
 *  instrument's accent), the name, reorder arrows, and remove. Collapse is
 *  local per instance, so it persists across re-renders; collapsed = header
 *  bar only. Reordering is meaningful: the render chain follows array order.
 *  No overflow-hidden on the card (bespoke bodies may float popovers); the
 *  header rounds its own top corners instead. */
function EffectItem({
  plugin, inst, index, count, accent, onToggle, onRemove, onMove, onSetSetting,
}: {
  plugin: VisualEffect
  inst: EffectInstance
  index: number
  count: number
  accent: string
  onToggle: () => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  onSetSetting: (key: string, value: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const BespokeEffect = getEffectUserInterface(plugin.id)
  // A device that declares its own colour wears it here too, so the rack's LEDs
  // tell the devices apart at a glance and each card matches the console it
  // opens (the scene FX family; per-object effects have none and inherit the
  // chain owner's accent as before).
  const deviceAccent = plugin.accent ?? accent
  return (
    <div className="mb-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-track-row)]">
      <div className={`flex h-[26px] items-center gap-2 px-2 bg-[var(--bg-elevated)] ${
        collapsed ? 'rounded-[7px]' : 'rounded-t-[7px] border-b border-[var(--border)]'
      }`}>
        <button
          onClick={onToggle}
          className="group flex h-4 w-4 flex-shrink-0 items-center justify-center cursor-pointer"
          aria-label={inst.enabled ? 'Disable effect' : 'Enable effect'}
        >
          <span
            className="h-1.5 w-1.5 rounded-full group-active:scale-75"
            style={inst.enabled
              ? { background: deviceAccent, boxShadow: `0 0 5px ${deviceAccent}` }
              : { background: 'var(--border-strong)' }}
          />
        </button>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 min-w-0 items-center gap-1 cursor-pointer"
          aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
        >
          <span className={`text-[11px] font-semibold truncate ${inst.enabled ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
            {plugin.name}
          </span>
          {collapsed ? <ChevronRight size={12} className="flex-shrink-0 text-[var(--text-muted)]" /> : <ChevronDown size={12} className="flex-shrink-0 text-[var(--text-muted)]" />}
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onMove(-1) }}
            disabled={index === 0}
            className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default"
            aria-label="Move effect up"
          >
            <ArrowUp size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMove(1) }}
            disabled={index === count - 1}
            className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] disabled:opacity-30 cursor-pointer disabled:cursor-default"
            aria-label="Move effect down"
          >
            <ArrowDown size={11} />
          </button>
          <button onClick={onRemove} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer" aria-label="Remove effect">
            <X size={12} />
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className={`px-2.5 pt-2.5 pb-1 ${inst.enabled ? '' : 'opacity-50'}`}>
      {BespokeEffect ? (
        // Bespoke panels are React.lazy shells (userInterfaceRenderers/lazyPanel.ts);
        // the boundary is per-render-site so a first-time load blanks only this
        // device's body, never the rack.
        <Suspense fallback={null}>
          <BespokeEffect
            targetId={inst.id}
            parameters={plugin.params
              .filter((p) => typeof p.default === 'number')
              .map((p) => ({
                definition: p,
                value: inst.settings[p.key] ?? (p.default as number),
                setValue: (v: number | string) => { if (typeof v === 'number') onSetSetting(p.key, v) },
              }))}
          />
        </Suspense>
      ) : plugin.params.map((p) => (
        <ParamControl
          key={p.key}
          param={p}
          numValue={inst.settings[p.key]}
          strValue={undefined}
          onNum={(v) => onSetSetting(p.key, v)}
        />
      ))}
      </div>
      )}
    </div>
  )
}

// Two label sets: the rail is a @container, and below ~300px the tabs drop to
// their short forms so the identity name keeps room to read (same trick the
// library sidebar's tabs use when it is dragged narrow).
const TABS: { id: Tab; label: string; short: string; sceneLabel: string; sceneShort: string }[] = [
  { id: 'instrument', label: 'Instrument', short: 'Inst', sceneLabel: 'Settings', sceneShort: 'Scene' },
  { id: 'effects', label: 'Effects', short: 'FX', sceneLabel: 'Effects', sceneShort: 'FX' },
  { id: 'targets', label: 'Targets', short: 'Tgt', sceneLabel: 'Targets', sceneShort: 'Tgt' },
]

/** What a track can point AT, which is what decides whether the Targets tab is
 *  offered at all. Two independent channels, either of which earns the tab:
 *
 *  - `objects` — the #tag / branch / track routing a GLOBAL mover (one with no
 *    parent instrument) or a Crop uses to say which objects it reaches.
 *  - `copies` — which of the copies arriving at a mover/splitter ROW it acts on
 *    (core/visualCopies/copyTargets.ts). Every chain row has this, wherever it
 *    sits; the panel itself says so when nothing above it makes copies.
 *
 *  A plain instrument track has neither, and gets the two-tab rail it always
 *  had rather than a third tab with nothing in it. */
function targetChannels(
  track: Track | null,
  parent: Track | undefined,
): { objects: boolean; copies: boolean } | null {
  if (!track) return null
  const isChainRow = track.type === 'mover' || track.type === 'splitter'
  const objects = track.instrumentId === 'crop'
    || (isChainRow && (!track.parentId || !parent || !getInstrument(parent.instrumentId)))
  const copies = isChainRow
  return objects || copies ? { objects, copies } : null
}

function tabsFor(channels: { objects: boolean; copies: boolean } | null) {
  return channels ? TABS : TABS.filter((t) => t.id !== 'targets')
}

/** What the panel is pointed at, for the identity that shares the tab rail:
 *  the NAME it wears, the KIND behind that name (a tooltip, not a second line -
 *  the rail has one line to give), and the COLOR that lights the active tab.
 *  Scenes have no identity color of their own, so they borrow the theme accent. */
function panelIdentity(
  track: Track | null,
  scene: Scene | null | undefined,
): { name: string; kind: string; color: string } | null {
  if (track) {
    // The scene instrument wears the SCENE's name and the theme accent, exactly
    // as the no-selection scene panel does - it is the same subject, reached a
    // different way, and a masthead that said "Group" would deny that.
    if (isSceneTrackId(track.id)) {
      return { name: scene?.name ?? track.name, kind: 'Scene instrument', color: 'var(--accent)' }
    }
    const kind =
      track.type === 'base'
        ? getInstrument(track.instrumentId)?.name ?? compositionDef(track.instrumentId)?.name ?? 'Instrument'
      : track.type === 'mover' || track.type === 'splitter'
        ? getMoverOrSplitterDefinition(track.type === 'splitter' ? track.splitterId : track.moverId)?.label
          ?? (track.type === 'splitter' ? 'Splitter' : 'Mover')
      : track.type === 'automation' ? 'Automation'
      : track.type === 'envelope' ? 'Envelope'
      : track.type === 'ability' ? 'Ability'
      : track.type === 'group' ? 'Group'
      : track.type === 'switcher' ? 'Switcher'
      : 'Track'
    // The instrument's own color, not the timeline's display color: the tab is
    // naming this instrument, so an achromatic instrument should light the tab
    // white rather than borrow a cycle color that starts out blue and reads as
    // the app/scene accent.
    return { name: track.name, kind, color: resolveTrackIdentityColor(track) }
  }
  if (scene) return { name: scene.name, kind: scene.isMain ? 'Main scene' : 'Scene', color: 'var(--accent)' }
  return null
}

/** The top-level mover targets picker (#tag / branch / track scopes), shared by
 *  legacy movers and new-registry (VisualCopy) movers and splitters. */
function MoverTargets({ track, cropMode }: { track: Track; cropMode?: boolean }) {
  const setTrackTargets = useProjectStore((s) => s.setTrackTargets)
  // Crop-to-crop routing is a deliberate no-op in the engine (nothing renders
  // there to mask), so a crop's picker doesn't offer other crops at all.
  const targetable = (t: Track) =>
    !!getInstrument(t.instrumentId) && t.id !== track.id && !(cropMode && t.instrumentId === 'crop')
  // The picker lists every object track (name, tags, branch-ness) but must not
  // re-render on every project edit, so it subscribes to a string fingerprint
  // of exactly what it shows and re-reads the record only when that changes.
  const objectTracksKey = useProjectStore((s) => {
    let key = ''
    for (const t of Object.values(s.tracks)) {
      if (targetable(t)) {
        key += `${t.id}${t.name}${(t.tags ?? []).join(',')}${(t.childIds?.length ?? 0) > 0 ? 'b' : ''}`
      }
    }
    return key
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tracks = useMemo(() => useProjectStore.getState().tracks, [objectTracksKey])
  const objectTracks = Object.values(tracks).filter(targetable)
  const allTags = [...new Set(objectTracks.flatMap((t) => t.tags ?? []))].sort()
  const branchTracks = objectTracks.filter((t) => (t.childIds?.length ?? 0) > 0)
  const keyOf = (r: Routing) =>
    r.scope.kind === 'tag' ? `tag:${r.scope.tag}`
    : r.scope.kind === 'track' ? `track:${r.scope.id}`
    : `subtree:${r.scope.id}`
  const options = [
    ...allTags.map((tag) => ({
      key: `tag:${tag}`,
      label: `#${tag}`,
      routing: { port: 'mover', scope: { kind: 'tag' as const, tag }, amount: 1 },
    })),
    ...branchTracks.map((t) => ({
      key: `subtree:${t.id}`,
      label: `${t.name} (branch)`,
      routing: { port: 'mover', scope: { kind: 'subtree' as const, id: t.id }, amount: 1 },
    })),
    ...objectTracks.map((t) => ({
      key: `track:${t.id}`,
      label: t.name,
      routing: { port: 'mover', scope: { kind: 'track' as const, id: t.id }, amount: 1 },
    })),
  ]
  const selected = new Set(track.targets?.map(keyOf))
  const toggle = (key: string) => {
    const next = (track.targets ?? []).slice()
    const idx = next.findIndex((r) => keyOf(r) === key)
    if (idx >= 0) next.splice(idx, 1)
    else {
      const opt = options.find((o) => o.key === key)
      if (opt) next.push(opt.routing)
    }
    setTrackTargets(track.id, next)
  }
  // Target resolution is silent-fail in the engine (an unresolved routing is
  // skipped, a mover with no targets affects nothing) - so say it out loud here
  // instead of letting a global mover look broken.
  const targets = track.targets ?? []
  const deadTargets = targets.filter((r) =>
    r.scope.kind === 'tag' ? !allTags.includes(r.scope.tag) : !tracks[r.scope.id])
  // Read-only: what each checked #tag currently resolves to. Dead tags are
  // skipped - the warning below already announces them.
  const routedTags = targets.flatMap((r) =>
    r.scope.kind === 'tag' && allTags.includes(r.scope.tag) ? [r.scope.tag] : [])
  return (
    <div className="mb-4">
      <p className="text-[11px] text-zinc-500 mb-2">Targets:</p>
      {options.length === 0
        ? <p className="text-[11px] text-zinc-600">No objects to target</p>
        : <TargetSelect options={options} selected={selected} onToggle={toggle} />}
      {routedTags.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {routedTags.map((tag) => {
            const names = tracksWithTag(tracks, tag).map((t) => t.name)
            const shown = names.slice(0, 6).join(', ')
            const extra = names.length - 6
            return (
              <p
                key={tag}
                className="text-[10px] text-[var(--text-muted)] truncate"
                title={`#${tag} → ${names.join(', ')}`}
              >
                #{tag} → {shown}{extra > 0 ? ` +${extra} more` : ''}
              </p>
            )
          })}
        </div>
      )}
      {options.length > 0 && targets.length === 0 && (cropMode ? (
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
          No targets checked — this Crop masks its whole scene. Check targets to mask only those instruments.
        </p>
      ) : (
        <p className="text-[11px] text-[var(--warn)] mt-1.5">
          No targets checked — a global mover affects nothing until it targets a track, branch, or #tag.
        </p>
      ))}
      {deadTargets.length > 0 && (
        <p className="text-[11px] text-[var(--warn)] mt-1.5">
          {deadTargets.length} checked target{deadTargets.length === 1 ? '' : 's'} no longer
          match{deadTargets.length === 1 ? 'es' : ''} anything (deleted track or unused tag).
        </p>
      )}
    </div>
  )
}

export function TrackEditor() {
  const [tab, setTab] = useState<Tab>('instrument')
  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const editingBlock = useUIStore((s) => s.editingBlock)
  // Opening an automation roll brings its controls alongside the notes. React
  // only to opening/switching blocks, so later manual inspector choices stick.
  useEffect(() => {
    if (!editingBlock) return
    const editedTrack = useProjectStore.getState().tracks[editingBlock.trackId]
    if (editedTrack?.type !== 'automation') return
    useUIStore.getState().setSelectedTrackId(editedTrack.id)
    setTab('instrument')
  }, [editingBlock])
  // The inspector subscribes to the SELECTED track and its parent, never the
  // whole tracks record - a whole-record selector here re-renders every bespoke
  // settings panel (some carrying canvases) on every pointermove of a timeline
  // drag.
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const track = useProjectStore((s) => (selectedTrackId ? s.tracks[selectedTrackId] ?? null : null))
  const parent = useProjectStore((s) => (track?.parentId ? s.tracks[track.parentId] : undefined))
  // With a track selected the scene object is unused (the track wins every
  // branch below), so skip the subscription: the active scene's identity
  // changes on every edit to any of its tracks. The SCENE INSTRUMENT is the
  // exception - it IS the scene, wearing a track's clothes, and its panel is
  // the scene console - so it opts back in and accepts the same re-render cost
  // the no-selection state already pays.
  const activeScene = useProjectStore((s) => (
    !track || isSceneTrackId(track.id) ? s.scenes[s.activeSceneId] ?? null : null
  ))
  // Composition-vs-object dispatch for dual-surface ids (crop) hangs on which
  // scene the track lives in; a primitive selector keeps the render budget.
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  const setTrackStringParam = useProjectStore((s) => s.setTrackStringParam)
  const setMoverInput = useProjectStore((s) => s.setMoverInput)
  const setEnvelopeAdsr = useProjectStore((s) => s.setEnvelopeAdsr)
  const setEnvelopeDepth = useProjectStore((s) => s.setEnvelopeDepth)
  const setEnvelopeTarget = useProjectStore((s) => s.setEnvelopeTarget)
  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const setTrackSplineTension = useProjectStore((s) => s.setTrackSplineTension)
  const setTrackNoise = useProjectStore((s) => s.setTrackNoise)
  const setTrackBurst = useProjectStore((s) => s.setTrackBurst)
  const setTrackCycle = useProjectStore((s) => s.setTrackCycle)
  const setTrackForce = useProjectStore((s) => s.setTrackForce)
  const setAutomationTarget = useProjectStore((s) => s.setAutomationTarget)
  const setTrackAutomationRange = useProjectStore((s) => s.setTrackAutomationRange)
  const setAutomationMode = useProjectStore((s) => s.setAutomationMode)
  const setTrackAutomationAmount = useProjectStore((s) => s.setTrackAutomationAmount)
  const setEffectSetting = useProjectStore((s) => s.setEffectSetting)
  const removeEffect = useProjectStore((s) => s.removeEffect)
  const toggleEffect = useProjectStore((s) => s.toggleEffect)
  const reorderEffect = useProjectStore((s) => s.reorderEffect)
  const addEffect = useProjectStore((s) => s.addEffect)
  const setSceneEffectSetting = useProjectStore((s) => s.setSceneEffectSetting)
  const removeSceneEffect = useProjectStore((s) => s.removeSceneEffect)
  const toggleSceneEffect = useProjectStore((s) => s.toggleSceneEffect)
  const reorderSceneEffect = useProjectStore((s) => s.reorderSceneEffect)
  const addSceneEffect = useProjectStore((s) => s.addSceneEffect)
  // Effects picker menu anchor (viewport coords); null = closed.
  const [fxMenu, setFxMenu] = useState<{ x: number; y: number } | null>(null)
  const identity = panelIdentity(track, activeScene)

  useEffect(() => { if (!selectedTrackId) setTab('instrument') }, [activeSceneId, selectedTrackId])
  // Targets is a CONDITIONAL tab, so selecting a track that has none while it is
  // open would leave the panel showing a body with no tab lit.
  const channels = targetChannels(track, parent)
  useEffect(() => { if (tab === 'targets' && !channels) setTab('instrument') }, [tab, channels])

  // An audio track has no instrument and no effects - the inspector's usual
  // chrome would be two empty tabs. It gets the whole surface instead: scope on
  // top, the waveform running through the playhead below.
  if (track?.type === 'audio') {
    return (
      <div className="visualizer-glass-surface h-full border-r border-[var(--border)] bg-[var(--bg-panel)]">
        <AudioTrackDetail track={track} />
      </div>
    )
  }

  return (
    <div className="visualizer-glass-surface flex flex-col h-full border-r border-[var(--border)] bg-[var(--bg-panel)]">
      {/* Identity masthead: the subject's name in display serif at the top. The
          kind (instrument / mover / scene) lives in its tooltip - the row has
          one line to give.

          It draws NO rule of its own; the size gap between it and the tab rail
          is what separates them, and the rail's own hairline closes the header.
          Two stacked rules read as two toolbars stapled together. */}
      {identity && (
        <div className="flex flex-shrink-0 items-center px-3 pt-1.5 pb-0.5">
          {/* `truncate` is overflow:hidden, so the LINE BOX is the clip box - at
              22px Instrument Serif a tight line-height crops every descender
              (the y in "Poly Gyre" loses its tail), which reads as a broken
              font rather than a CSS bug. 1.3 clears them. */}
          <span
            className="min-w-0 truncate text-[22px] italic leading-[1.3] [font-family:var(--font-display)] text-[var(--text)]"
            title={`${identity.name} · ${identity.kind}`}
          >
            {identity.name}
          </span>
        </div>
      )}

      <div className="@container flex flex-shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
        {(track || activeScene) ? tabsFor(targetChannels(track, parent)).map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex h-6 flex-1 min-w-0 items-center justify-center rounded-full px-2.5 text-[11px] cursor-pointer ${
                active
                  ? 'font-semibold'
                  : 'bg-transparent text-[var(--text-muted)] font-medium hover:bg-white/[0.05] hover:text-[var(--text-2)]'
              }`}
              style={active && identity
                ? {
                  background: `color-mix(in srgb, ${identity.color} 18%, transparent)`,
                  color: identity.color,
                }
                : undefined}
            >
              {/* Scene mode reuses the tab pair; the first slot holds scene settings. */}
              <span className="hidden @[300px]:inline">{track ? t.label : t.sceneLabel}</span>
              <span className="@[300px]:hidden">{track ? t.short : t.sceneShort}</span>
            </button>
          )
        }) : (
          <div className="h-6 flex-1 flex items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[11px] font-semibold text-[var(--text)]">
            Settings
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar p-3 pb-12">
        {tab === 'instrument' && (
          <>
            {track ? (
              <>
                {(() => {
                  // New-registry (VisualCopy) mover or splitter: its params render
                  // straight from the definition schema; the legacy runtime controls
                  // (depth, MIDI mode, weight, op mode) don't exist for it - the
                  // definition owns its own MIDI grammar, shown as labelled rows.
                  const newMoverDef = track.type === 'mover' || track.type === 'splitter'
                    ? getMoverOrSplitterDefinition(track.type === 'splitter' ? track.splitterId : track.moverId)
                    : undefined
                  if (newMoverDef) {
                    // Bespoke definition UIs plug in exactly like object ones:
                    // params come bound as UserInterfaceParameters; anything
                    // unregistered keeps the plain control list.
                    const BespokeMover = getMoverUserInterface(newMoverDef.id)
                    // Numeric params live in inputValues, string-valued ones
                    // (color / string) in the shared stringParams field - the
                    // same split instruments use, so the engine's numeric paths
                    // never see a string.
                    const moverParameters: UserInterfaceParameter[] = newMoverDef.params.map((p) =>
                      isStringParam(p)
                        ? {
                          definition: p,
                          value: track.stringParams?.[p.key] ?? p.default,
                          setValue: (v) => { if (typeof v === 'string') setTrackStringParam(track.id, p.key, v) },
                        }
                        : {
                          definition: p,
                          value: track.inputValues?.[p.key] ?? (p.default as number),
                          setValue: (v) => { if (typeof v === 'number') setMoverInput(track.id, p.key, v) },
                        })
                    return (
                      <>
                        {BespokeMover ? (
                          <Suspense fallback={null}>
                            <BespokeMover targetId={track.id} parameters={moverParameters} />
                          </Suspense>
                        ) : (
                          <>
                            <p className="text-[11px] text-zinc-500 mb-3">{
                              newMoverDef.kind === 'splitter'
                                ? 'Splitter:'
                                : newMoverDef.kind === 'colorizer'
                                  ? 'Colorizer:'
                                  : 'Mover:'
                            }</p>
                            {newMoverDef.params.map((p) => (
                              <ParamControl
                                key={p.key}
                                param={p}
                                numValue={isStringParam(p) ? undefined : track.inputValues?.[p.key] ?? (p.default as number)}
                                strValue={isStringParam(p) ? track.stringParams?.[p.key] ?? p.default : undefined}
                                onNum={(v) => setMoverInput(track.id, p.key, v)}
                                onStr={(v) => setTrackStringParam(track.id, p.key, v)}
                              />
                            ))}
                          </>
                        )}
                        {/* Object routing and copy targeting both live on the
                            Targets tab now - see TARGET_TABS. */}
                      </>
                    )
                  }
                  // Envelope child track → ADSR + depth (+ the value reached at
                  // full gain, except for the reserved Opacity target, which is a
                  // pure multiplier). Its notes are the gates - drawn in the MIDI
                  // editor like any lane; pitch is ignored, velocity scales peak.
                  if (track.type === 'envelope') {
                    const target = track.targetParam
                    const isOpacity = target === ENVELOPE_OPACITY_TARGET
                    let targetLabel = 'Opacity'
                    let bounds: { min: number; max: number; step: number } | null = null
                    if (!isOpacity && target) {
                      const fx = parseFxTarget(target)
                      if (fx) {
                        const inst = (parent?.effects ?? []).find((e) => e.id === fx.instanceId)
                        const plugin = inst ? getEffect(inst.pluginId) : undefined
                        const pd = plugin?.params.find((p) => p.key === fx.key)
                        targetLabel = pd ? `${plugin?.name} · ${pd.label}` : target
                        if (pd && isNumberParam(pd)) bounds = { min: pd.min, max: pd.max, step: pd.step || 0.01 }
                      } else {
                        const pdef = parent ? getInstrument(parent.instrumentId)?.params.find((p) => p.key === target) : undefined
                        targetLabel = pdef?.label ?? target
                        if (pdef && isNumberParam(pdef)) bounds = { min: pdef.min, max: pdef.max, step: pdef.step || 0.01 }
                      }
                    }
                    const adsr = { ...DEFAULT_ADSR, ...track.adsr }
                    return (
                      <EnvelopeUserInterface
                        targetLabel={targetLabel}
                        isOpacity={isOpacity}
                        adsr={adsr}
                        depth={track.envDepth ?? 1}
                        peak={!isOpacity && bounds
                          ? { value: track.envTarget ?? bounds.max, min: bounds.min, max: bounds.max, step: bounds.step }
                          : null}
                        onAdsr={(next) => setEnvelopeAdsr(track.id, next)}
                        onDepth={(v) => setEnvelopeDepth(track.id, v)}
                        onPeak={(v) => setEnvelopeTarget(track.id, v)}
                      />
                    )
                  }

                  // Automation child track → its MODE (value keyframes on a
                  // curve / seeded noise / ADSR bursts) and that mode's shape,
                  // drawn as the lane's own console. The MIDI editor's toolbar
                  // carries the same controls in compact form; they live here too
                  // so the modes are discoverable without opening the lane.
                  if (track.type === 'automation') {
                    const targets = parent ? automationTargetsForParent(parent, activeIsMain) : []
                    const currentTarget = targets.find((option) => option.key === track.targetParam)
                    const targetLabel = currentTarget?.label ?? track.targetParam ?? 'value'
                    const laneBounds = currentTarget?.bounds ?? null
                    // getState, not a subscription: the disabled flags are
                    // cosmetic and refresh with this panel's own re-renders
                    // (same accepted staleness as the guide's other getState reads).
                    const siblingTracks = useProjectStore.getState().tracks
                    const siblingTargets = new Set((parent?.childIds ?? [])
                      .map((cid) => siblingTracks[cid])
                      .filter((c) => !!c && c.id !== track.id && c.type === 'automation')
                      .map((c) => c!.targetParam))
                    const targetOptions = targets.map((o) => ({ ...o, disabled: siblingTargets.has(o.key) }))
                    return (
                      <AutomationUserInterface
                        targetLabel={targetLabel}
                        targetKey={track.targetParam}
                        targetOptions={targetOptions}
                        onTarget={(key, label) => {
                          // A count target starts the reset range on the whole-number grid.
                          const option = targetOptions.find((o) => o.key === key)
                          setAutomationTarget(track.id, key, label, track.name === targetLabel, {
                            integer: option?.integer,
                          })
                        }}
                        color={resolveTrackDisplayColor(track)}
                        mode={automationMode(track)}
                        interpolation={track.interpolation ?? 'linear'}
                        tension={track.splineTension ?? DEFAULT_SPLINE_TENSION}
                        noise={track.noise}
                        burst={track.burst}
                        cycle={track.cycle}
                        force={track.force}
                        amount={track.automationAmount ?? 1}
                        onMode={(mode) => setAutomationMode(track.id, mode)}
                        onInterpolation={(mode) => setTrackInterpolation(track.id, mode)}
                        onTension={(tension) => setTrackSplineTension(track.id, tension)}
                        onNoise={(noise) => setTrackNoise(track.id, noise)}
                        onBurst={(burst) => setTrackBurst(track.id, burst)}
                        onCycle={(cycle) => setTrackCycle(track.id, cycle)}
                        onForce={(force) => setTrackForce(track.id, force)}
                        onAmount={(amount) => setTrackAutomationAmount(track.id, amount)}
                        paramBounds={laneBounds}
                        range={track.automationRange}
                        onRange={(range) => setTrackAutomationRange(track.id, range)}
                      />
                    )
                  }

                  // Switcher track → the rack's console: which devices its lane
                  // is allowed to run. It has no params of its own beyond the
                  // mode, so the whole panel is that one decision.
                  if (track.type === 'switcher') {
                    return <SwitcherUserInterface trackId={track.id} />
                  }
                  // The SCENE INSTRUMENT (core/sceneTrack.ts) is a group track
                  // by materialization, so it must be caught before the group
                  // branch below. Its "instrument" is the backdrop - the same
                  // console the scene wears when nothing is selected - with the
                  // scene-wide transform under it.
                  if (isSceneTrackId(track.id) && activeScene) {
                    return (
                      <>
                        <SceneSettingsPanel scene={activeScene} />
                        <div className="mt-12">
                          <p className="text-[11px] text-zinc-500 mb-3">
                            Scene transform: moves every track in the scene as one.
                            Movers and splitters added below apply to all of them;
                            a colorizer here paints the backdrop above.
                          </p>
                          {TRANSFORM_PARAM_DEFS.map((p) => (
                            <ParamControl
                              key={p.key}
                              param={p}
                              numValue={track.params?.[p.key] ?? p.default}
                              strValue={undefined}
                              onNum={(v) => setTrackParam(track.id, p.key, v)}
                            />
                          ))}
                        </div>
                      </>
                    )
                  }

                  // Group track → the canonical transform knobs, applied to the
                  // whole subtree (world-matrix inheritance; tfOpacity cascades
                  // onto member objects). Movers/effects on the group live in
                  // their own rows / the Effects tab.
                  if (track.type === 'group') {
                    return (
                      <>
                        <p className="text-[11px] text-zinc-500 mb-3">
                          Group: transform applies to every track inside. Mover and
                          splitter rows added below the members apply to the members
                          above them; effects broadcast to every member object.
                        </p>
                        {TRANSFORM_PARAM_DEFS.map((p) => (
                          <ParamControl
                            key={p.key}
                            param={p}
                            numValue={track.params?.[p.key] ?? p.default}
                            strValue={undefined}
                            onNum={(v) => setTrackParam(track.id, p.key, v)}
                          />
                        ))}
                      </>
                    )
                  }

                  // Composition tracks ON MAIN get the scene-binding panel; a
                  // crop track in a visual scene falls through to the object
                  // path below (its dual surface: compose on Main, mask in a
                  // scene).
                  if (isCompositionTrack(track) && activeIsMain) {
                    return <CompositionSettingsPanel track={track} />
                  }

                  // Object track → its settings UI: a declarative panelSpec on
                  // the def wins (no registration needed - see console/spec.tsx),
                  // else its registered renderer.
                  const def = getInstrument(track.instrumentId)
                  const UserInterfaceRenderer = def
                    ? (def.panelSpec ? consolePanel(def.panelSpec) : getUserInterfaceRenderer(def.userInterfaceRenderer))
                    : null
                  // Params gated behind a toggle (showIf) only appear while
                  // that toggle is on - a flight-speed slider means nothing
                  // with flight mode off. 'key' alone means "key >= 0.5";
                  // 'key=2' pins to one select value ("scatter spread" has no
                  // business showing while the layout is Stack), and
                  // 'key=0|1' pins to any of several (the Light's REACH knob
                  // belongs to both the point and spot types).
                  const numericValue = (key: string) =>
                    track.params?.[key] ?? Number(def?.params.find((p) => p.key === key)?.default ?? 0)
                  const showIfSatisfied = (condition: string) => {
                    const [key, expected] = condition.split('=')
                    return expected !== undefined
                      ? expected.split('|').some((v) => Math.round(numericValue(key)) === Number(v))
                      : numericValue(key) >= 0.5
                  }
                  const visibleParameters = def?.params.filter(
                    (p) => !p.showIf || showIfSatisfied(p.showIf),
                  )
                  const userInterfaceParameters: UserInterfaceParameter[] = visibleParameters?.map((parameter) => {
                    const stringParameter = isStringParam(parameter)
                    return {
                      definition: parameter,
                      value: stringParameter
                        ? track.stringParams?.[parameter.key] ?? parameter.default
                        : track.params?.[parameter.key] ?? parameter.default,
                      setValue: (value) => {
                        if (stringParameter) setTrackStringParam(track.id, parameter.key, String(value))
                        else setTrackParam(track.id, parameter.key, Number(value))
                      },
                    }
                  }) ?? []
                  const accent = instrumentAccent(track)
                  return (
                    <>
                      {/* The IN FRONT toggle is deprecated from this panel (design
                          guide: docs/instrument-panel-design-guide.md). track.onTop
                          and defaultOnTop still drive the engine; only the switch
                          is gone until a better layering story exists. */}
                      {/* The chassis: the instrument is a device in the panel, not
                          the panel itself - a rounded frame whose border is lit by
                          the instrument's own color param. No overflow-hidden here:
                          the color wheel popover must escape the frame, so inner
                          surfaces carry their own radius instead. */}
                      <div
                        // Text Display runs FLUSH: its panel is a workspace
                        // (style lanes, clips), not a framed device, so the
                        // chassis border+padding drop and the negative margin
                        // cancels the scroll container's inset.
                        className={track.instrumentId === 'textDisplay' ? '-mx-3' : 'rounded-[10px] border p-3'}
                        style={track.instrumentId === 'textDisplay' ? undefined : accent ? {
                          borderColor: withAlpha(accent, 0.22),
                          boxShadow: `0 0 20px ${withAlpha(accent, 0.07)}, 0 4px 18px rgba(0,0,0,0.4)`,
                        } : {
                          borderColor: 'var(--border-strong)',
                          boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
                        }}
                      >
                        {!UserInterfaceRenderer ? (
                          <p className="text-[11px] text-[var(--text-muted)]">No parameters</p>
                        ) : (
                          <Suspense fallback={null}>
                            <UserInterfaceRenderer
                              targetId={track.id}
                              parameters={userInterfaceParameters}
                            />
                          </Suspense>
                        )}
                      </div>
                    </>
                  )
                })()}
              </>
            ) : activeScene ? (
              <SceneSettingsPanel scene={activeScene} />
            ) : null}
          </>
        )}
        {tab === 'targets' && track && channels && (
          <>
            {/* Objects first: a global mover picks WHICH objects before there is
                any question of which of their copies. */}
            {channels.objects && <MoverTargets track={track} cropMode={track.instrumentId === 'crop'} />}
            {channels.copies && <CopyTargetsUserInterface track={track} />}
          </>
        )}
        {tab === 'effects' && (() => {
          // One chain UI, two owners: the selected track's per-object chain, or -
          // with no track selected - the active scene's chain (Scene.effects,
          // applied by VisualScene's compositor as full-frame passes). The
          // SCENE INSTRUMENT (⌘⇧S, core/sceneTrack.ts) is the same chain
          // reached through the track arm: its synthetic track carries
          // Scene.effects as `track.effects`, and the ordinary track actions
          // fold edits back onto the scene - so both arms offer only the
          // scene-category devices for it.
          const isSceneChain = track ? isSceneTrackId(track.id) : true
          const fx = track
            ? {
                effects: track.effects ?? [],
                // The picker only offers effects where they render: object
                // tracks, plus GROUP tracks - a group's chain broadcasts to
                // every member object (ObjectRenderer merges it in).
                canAdd: !!getInstrument(track.instrumentId) || track.type === 'group',
                groups: isSceneChain ? SCENE_EFFECT_MENU_GROUPS : EFFECT_MENU_GROUPS,
                add: (pluginId: string) => addEffect(track.id, pluginId),
                toggle: (instanceId: string) => toggleEffect(track.id, instanceId),
                remove: (instanceId: string) => removeEffect(track.id, instanceId),
                move: (instanceId: string, direction: -1 | 1) => reorderEffect(track.id, instanceId, direction),
                setSetting: (instanceId: string, key: string, value: number) => setEffectSetting(track.id, instanceId, key, value),
              }
            : activeScene
              ? {
                  effects: activeScene.effects ?? [],
                  canAdd: true,
                  groups: SCENE_EFFECT_MENU_GROUPS,
                  add: (pluginId: string) => addSceneEffect(activeScene.id, pluginId),
                  toggle: (instanceId: string) => toggleSceneEffect(activeScene.id, instanceId),
                  remove: (instanceId: string) => removeSceneEffect(activeScene.id, instanceId),
                  move: (instanceId: string, direction: -1 | 1) => reorderSceneEffect(activeScene.id, instanceId, direction),
                  setSetting: (instanceId: string, key: string, value: number) => setSceneEffectSetting(activeScene.id, instanceId, key, value),
                }
              : null
          if (!fx) return <p className="text-xs text-[var(--text-muted)] text-center mt-8">No track selected</p>
          // Device LEDs glow in the owner's color: the parent instrument's for
          // a track chain (the chain is lit by the instrument it processes),
          // the app accent for scene chains and colorless instruments.
          const fxAccent = (track ? instrumentAccent(track) : null) ?? 'var(--accent)'
          return (
            <div
              onContextMenu={fx.canAdd ? (e) => { e.preventDefault(); setFxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
              className="min-h-full rounded "
            >
              {fx.effects.map((inst, i) => {
                const plugin = getEffect(inst.pluginId)
                if (!plugin) return null
                return (
                  <EffectItem
                    key={inst.id}
                    plugin={plugin}
                    inst={inst}
                    index={i}
                    count={fx.effects.length}
                    accent={fxAccent}
                    onToggle={() => fx.toggle(inst.id)}
                    onRemove={() => fx.remove(inst.id)}
                    onMove={(direction) => fx.move(inst.id, direction)}
                    onSetSetting={(key, value) => fx.setSetting(inst.id, key, value)}
                  />
                )
              })}
              {fx.canAdd && (
                <button
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setFxMenu({ x: r.left, y: r.bottom + 4 })
                  }}
                  className="mt-1 flex h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
                >
                  <Plus size={11} />
                  Add effect
                </button>
              )}
              {fxMenu && (
                <NestedMenu
                  x={fxMenu.x}
                  y={fxMenu.y}
                  groups={fx.groups}
                  onPick={(_, pluginId) => fx.add(pluginId)}
                  onClose={() => setFxMenu(null)}
                />
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
