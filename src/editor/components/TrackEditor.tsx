'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Check, Plus, X } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { tracksWithTag } from '../utils/trackTags'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { getDirector } from '../core/directors'
import { DIRECTOR_OPACITY_PARAM } from '../core/directors/types'
import { orderedSceneBindings } from '../core/directors/sceneBindings'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import { ENVELOPE_OPACITY_TARGET } from '../core/visual/resolve'
import { automationMode } from '../core/visual/automation'
import { getEffect, PLUGIN_LIST, type VisualEffect, type EffectCategory } from '../effects'
import { parseFxTarget } from '../effects/automation'
import { NestedMenu, type NestedMenuGroup } from './NestedMenu'
import { AudioTrackDetail } from './AudioTrackDetail'
import { SceneSettingsPanel } from './SceneSettingsPanel'
import { isNumberParam, isStringParam } from '../instruments/types'
import { getUserInterfaceRenderer, ParamControl, type UserInterfaceParameter } from '../userInterfaceRenderers'
import { getEffectUserInterface, getMoverUserInterface } from '../userInterfaceRenderers/bespokeRegistries'
import { EnvelopeUserInterface } from '../userInterfaceRenderers/EnvelopeUserInterface'
import { AutomationUserInterface } from '../userInterfaceRenderers/AutomationUserInterface'
import { resolveTrackDisplayColor } from '../utils/trackDisplayColor'
import { withAlpha } from '../userInterfaceRenderers/colorWheel'
import type { Routing, EffectInstance, Scene, Track } from '../types'

type Tab = 'instrument' | 'effects'

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
// here with no extra wiring. Category order is fixed: transform, clone, shader.
const EFFECT_CATEGORIES: { key: EffectCategory; label: string }[] = [
  { key: 'transform', label: 'Transform' },
  // 'Surface' rather than 'Material': these GENERATE the object's surface (the
  // pattern is bolted to the mesh and travels with it), which is what the user is
  // choosing between - not the fact that a three material is what gets patched.
  { key: 'material', label: 'Surface' },
  { key: 'shader', label: 'Shader' },
]
const EFFECT_MENU_GROUPS: NestedMenuGroup[] = EFFECT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  items: PLUGIN_LIST.filter((p) => p.category === c.key && !p.deprecated).map((p) => ({ id: p.id, label: p.name })),
}))

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
            className="h-1.5 w-1.5 rounded-full transition-all group-active:scale-75"
            style={inst.enabled
              ? { background: accent, boxShadow: `0 0 5px ${accent}` }
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
]

/** What the panel is pointed at, for the identity that shares the tab rail:
 *  the NAME it wears, the KIND behind that name (a tooltip, not a second line -
 *  the rail has one line to give), and the COLOR that lights the active tab.
 *  Scenes have no identity color of their own, so they borrow the theme accent. */
function panelIdentity(
  track: Track | null,
  tracks: Record<string, Track>,
  scene: Scene | undefined,
): { name: string; kind: string; color: string } | null {
  if (track) {
    const kind =
      track.type === 'base' ? getInstrument(track.instrumentId)?.name ?? 'Instrument'
      : track.type === 'mover' || track.type === 'splitter'
        ? getMoverOrSplitterDefinition(track.type === 'splitter' ? track.splitterId : track.moverId)?.label
          ?? (track.type === 'splitter' ? 'Splitter' : 'Mover')
      : track.type === 'director' ? getDirector(track.directorId)?.name ?? 'Director'
      : track.type === 'automation' ? 'Automation'
      : track.type === 'envelope' ? 'Envelope'
      : track.type === 'ability' ? 'Ability'
      : 'Track'
    return { name: track.name, kind, color: resolveTrackDisplayColor(track, tracks) }
  }
  if (scene) return { name: scene.name, kind: scene.isMain ? 'Main scene' : 'Scene', color: 'var(--accent)' }
  return null
}

/** The top-level mover targets picker (#tag / branch / track scopes), shared by
 *  legacy movers and new-registry (VisualCopy) movers and splitters. */
function MoverTargets({ track }: { track: Track }) {
  const tracks = useProjectStore((s) => s.tracks)
  const setTrackTargets = useProjectStore((s) => s.setTrackTargets)
  const objectTracks = Object.values(tracks).filter((t) => getInstrument(t.instrumentId) && t.id !== track.id)
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
      {options.length > 0 && targets.length === 0 && (
        <p className="text-[11px] text-[var(--warn)] mt-1.5">
          No targets checked — a global mover affects nothing until it targets a track, branch, or #tag.
        </p>
      )}
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
  const tracks = useProjectStore((s) => s.tracks)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const activeScene = useProjectStore((s) => s.scenes[s.activeSceneId])
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  const setTrackStringParam = useProjectStore((s) => s.setTrackStringParam)
  const setMoverInput = useProjectStore((s) => s.setMoverInput)
  const setDirectorSceneBindings = useProjectStore((s) => s.setDirectorSceneBindings)
  const setEnvelopeAdsr = useProjectStore((s) => s.setEnvelopeAdsr)
  const setEnvelopeDepth = useProjectStore((s) => s.setEnvelopeDepth)
  const setEnvelopeTarget = useProjectStore((s) => s.setEnvelopeTarget)
  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const setTrackNoise = useProjectStore((s) => s.setTrackNoise)
  const setTrackBurst = useProjectStore((s) => s.setTrackBurst)
  const setAutomationMode = useProjectStore((s) => s.setAutomationMode)
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
  const effectDragging = useUIStore((s) => s.effectDragging)
  // Effects picker menu anchor (viewport coords); null = closed.
  const [fxMenu, setFxMenu] = useState<{ x: number; y: number } | null>(null)
  const track = selectedTrackId ? tracks[selectedTrackId] ?? null : null
  const identity = panelIdentity(track, tracks, activeScene)

  // Dragging an effect from the library flips this panel to its Effects tab so the
  // drop zone is visible - the scene's chain when no track is selected.
  useEffect(() => { if (effectDragging && (track || activeScene)) setTab('effects') }, [effectDragging, track, activeScene])
  useEffect(() => { if (!selectedTrackId) setTab('instrument') }, [activeSceneId, selectedTrackId])

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
      {/* Identity rides ON the tab rail: the name takes the left, the tabs shrink
          to the right, and the subject's own color lights the ACTIVE tab instead
          of the neutral elevated fill. Costs no vertical space, so the panel still
          starts at its controls - which is why the standalone name header this
          replaced was dropped. The name truncates before the tabs do; the kind
          (instrument / mover / scene) lives in its tooltip, the rail having only
          one line to give. */}
      <div className="@container flex flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
        {identity && (
          <span
            className="min-w-0 truncate text-[11.5px] font-semibold text-[var(--text)]"
            title={`${identity.name} · ${identity.kind}`}
          >
            {identity.name}
          </span>
        )}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {(track || activeScene) ? TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`h-6 rounded-full px-2.5 text-[11px] transition-colors cursor-pointer ${
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
            <div className="h-6 px-2.5 flex items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[11px] font-semibold text-[var(--text)]">
              Settings
            </div>
          )}
        </div>
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
                          <BespokeMover targetId={track.id} parameters={moverParameters} />
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
                        {/* Movers without a parent instrument route globally
                            through their targets (appended to each target's
                            chain); movers under an instrument are local chain
                            entries and have no targets. */}
                        {(!track.parentId || !getInstrument(tracks[track.parentId]?.instrumentId)) && (
                          <MoverTargets track={track} />
                        )}
                      </>
                    )
                  }
                  // Envelope child track → ADSR + depth (+ the value reached at
                  // full gain, except for the reserved Opacity target, which is a
                  // pure multiplier). Its notes are the gates - drawn in the MIDI
                  // editor like any lane; pitch is ignored, velocity scales peak.
                  if (track.type === 'envelope') {
                    const parent = track.parentId ? tracks[track.parentId] : undefined
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
                    const parent = track.parentId ? tracks[track.parentId] : undefined
                    const fx = track.targetParam ? parseFxTarget(track.targetParam) : null
                    let targetLabel = track.targetParam ?? 'value'
                    if (fx) {
                      const inst = (parent?.effects ?? []).find((e) => e.id === fx.instanceId)
                      const plugin = inst ? getEffect(inst.pluginId) : undefined
                      const pd = plugin?.params.find((p) => p.key === fx.key)
                      if (pd) targetLabel = `${plugin?.name} · ${pd.label}`
                    } else if (parent && track.targetParam) {
                      const pdef = getInstrument(parent.instrumentId)?.params.find((p) => p.key === track.targetParam)
                        ?? (parent.type === 'mover' || parent.type === 'splitter'
                          ? getMoverOrSplitterDefinition(parent.type === 'splitter' ? parent.splitterId : parent.moverId)
                              ?.params.find((p) => p.key === track.targetParam)
                          : undefined)
                      if (pdef) targetLabel = pdef.label
                    }
                    return (
                      <AutomationUserInterface
                        targetLabel={targetLabel}
                        color={resolveTrackDisplayColor(track, tracks)}
                        mode={automationMode(track)}
                        interpolation={track.interpolation ?? 'linear'}
                        noise={track.noise}
                        burst={track.burst}
                        onMode={(mode) => setAutomationMode(track.id, mode)}
                        onInterpolation={(mode) => setTrackInterpolation(track.id, mode)}
                        onNoise={(noise) => setTrackNoise(track.id, noise)}
                        onBurst={(burst) => setTrackBurst(track.id, burst)}
                      />
                    )
                  }

                  if (track.type === 'director') {
                    const director = getDirector(track.directorId)
                    const scenes = useProjectStore.getState().scenes
                    const rows = director?.midiRows(track, scenes, useProjectStore.getState().sceneOrder) ?? []
                    const bindings = orderedSceneBindings(track, scenes, useProjectStore.getState().sceneOrder)
                    const cutCount = Math.min(bindings.length, Math.max(1, Math.round(track.params?.sceneCount ?? 3)))
                    const isPartitionDirector = track.directorId === 'cut' || track.directorId === 'radialCut'
                    const partitionLabel = track.directorId === 'radialCut' ? 'Ring' : 'Cut'
                    const moveBinding = (index: number, direction: -1 | 1) => {
                      const nextIndex = index + direction
                      if (nextIndex < 0 || nextIndex >= bindings.length) return
                      const ordered = bindings.slice()
                      ;[ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]]
                      setDirectorSceneBindings(track.id, ordered)
                    }
                    return (
                      <>
                        <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">DIRECTOR</p>
                        <p className="mb-4 text-[11px] leading-relaxed text-[var(--text-2)]">
                          {director?.targetsSingleScene
                            ? `${director?.name ?? 'This director'} renders one scene into Main. Its MIDI rows choose which pieces of that scene are visible.`
                            : `${director?.name ?? 'Unknown director'} renders scene sources into Main. Its MIDI rows choose the scene inputs.`}
                        </p>
                        <ParamControl
                          param={DIRECTOR_OPACITY_PARAM}
                          numValue={track.params?.opacity}
                          strValue={undefined}
                          onNum={(v) => setTrackParam(track.id, 'opacity', v)}
                        />
                        {(director?.params.length ?? 0) > 0 && director!.params.map((p) => (
                          <ParamControl
                            key={p.key}
                            param={p}
                            numValue={track.params?.[p.key]}
                            strValue={track.stringParams?.[p.key]}
                            onNum={(v) => setTrackParam(track.id, p.key, v)}
                            onStr={(v) => setTrackStringParam(track.id, p.key, v)}
                          />
                        ))}
                        {director?.targetsSingleScene && (() => {
                          const visualSceneIds = useProjectStore.getState().sceneOrder
                            .filter((id) => scenes[id] && !scenes[id].isMain)
                          const targetSceneId = bindings[0]?.sceneId
                          return (
                            <>
                              <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">SCENE</p>
                              <div className="space-y-1">
                                {visualSceneIds.map((sceneId) => (
                                  <button
                                    key={sceneId}
                                    onClick={() => setDirectorSceneBindings(track.id, [{ pitch: bindings[0]?.pitch ?? 60, sceneId }])}
                                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] cursor-pointer ${sceneId === targetSceneId ? 'bg-[var(--bg-elevated)] text-[var(--text)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-elevated)]'}`}
                                  >
                                    <span className="min-w-0 flex-1 truncate">{scenes[sceneId]?.name}</span>
                                    {sceneId === targetSceneId && <Check size={11} />}
                                  </button>
                                ))}
                              </div>
                              {visualSceneIds.length === 0 && (
                                <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">No visual scenes yet - add one to mask.</p>
                              )}
                              <p className="mt-3 mb-4 text-[10px] leading-relaxed text-[var(--text-muted)]">Every piece shows this scene, cropped. The MIDI rows choose which pieces are visible, not which scene.</p>
                            </>
                          )
                        })()}
                        {isPartitionDirector ? (
                          <>
                            <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">SCENE ORDER</p>
                            <div className="space-y-1">
                              {bindings.map((binding, index) => (
                                <div key={binding.sceneId} className={`flex items-center gap-2 rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px] ${index >= cutCount ? 'opacity-45' : ''}`}>
                                  <span className="w-10 flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{index < cutCount ? `${partitionLabel} ${index + 1}` : 'Unused'}</span>
                                  <span className="min-w-0 flex-1 truncate text-[var(--text-2)]">{scenes[binding.sceneId]?.name}</span>
                                  <span className="font-mono text-[var(--text-muted)]">{binding.pitch}</span>
                                  <button onClick={() => moveBinding(index, -1)} disabled={index === 0} aria-label={`Move ${scenes[binding.sceneId]?.name} earlier`} className="disabled:opacity-25 hover:text-[var(--text)] cursor-pointer disabled:cursor-default"><ArrowUp size={11} /></button>
                                  <button onClick={() => moveBinding(index, 1)} disabled={index === bindings.length - 1} aria-label={`Move ${scenes[binding.sceneId]?.name} later`} className="disabled:opacity-25 hover:text-[var(--text)] cursor-pointer disabled:cursor-default"><ArrowDown size={11} /></button>
                                </div>
                              ))}
                            </div>
                            <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-muted)]">Each active {partitionLabel.toLowerCase()} has one MIDI row. The scene exists in its partition only while that row’s note is held.</p>
                          </>
                        ) : director?.hideMidiRowsInSettings ? null : (
                          <>
                            <p className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">MIDI ROWS</p>
                            <div className="space-y-1">
                              {rows.map((row) => (
                                <div key={row.pitch} className="flex items-center justify-between rounded bg-[var(--bg-elevated)] px-2 py-1 text-[11px]">
                                  <span className="text-[var(--text-2)]">{row.label}</span>
                                  <span className="font-mono text-[var(--text-muted)]">{row.pitch}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )
                  }

                  // Object track → its registered settings UI, then its common track controls.
                  const def = getInstrument(track.instrumentId)
                  const UserInterfaceRenderer = def ? getUserInterfaceRenderer(def.userInterfaceRenderer) : null
                  // Params gated behind a toggle (showIf) only appear while
                  // that toggle is on - a flight-speed slider means nothing
                  // with flight mode off. 'key' alone means "key >= 0.5";
                  // 'key=2' pins to one select value ("scatter spread" has no
                  // business showing while the layout is Stack).
                  const numericValue = (key: string) =>
                    track.params?.[key] ?? Number(def?.params.find((p) => p.key === key)?.default ?? 0)
                  const showIfSatisfied = (condition: string) => {
                    const [key, expected] = condition.split('=')
                    return expected !== undefined
                      ? Math.round(numericValue(key)) === Number(expected)
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
                        className="rounded-[10px] border p-3"
                        style={accent ? {
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
                          <UserInterfaceRenderer
                            targetId={track.id}
                            parameters={userInterfaceParameters}
                          />
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
        {tab === 'effects' && (() => {
          // One chain UI, two owners: the selected track's per-object chain, or -
          // with no track selected - the active scene's chain (document-only for
          // now, the engine does not yet apply it; see Scene.effects in types.ts).
          const fx = track
            ? {
                effects: track.effects ?? [],
                // The picker only offers effects where they render: object tracks.
                canAdd: !!getInstrument(track.instrumentId),
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
              data-effects-drop
              onContextMenu={fx.canAdd ? (e) => { e.preventDefault(); setFxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
              className={`min-h-full rounded transition-colors ${effectDragging ? 'ring-2 ring-inset ring-[rgba(53,167,230,0.6)] bg-[rgba(53,167,230,0.05)]' : ''}`}
            >
              {fx.effects.length === 0 && effectDragging && (
                <p className="text-xs text-[var(--text-muted)] text-center mt-8 mb-4">
                  Drop to add effect
                </p>
              )}
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
                  className="mt-1 flex h-[30px] w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
                >
                  <Plus size={11} />
                  Add effect
                </button>
              )}
              {fxMenu && (
                <NestedMenu
                  x={fxMenu.x}
                  y={fxMenu.y}
                  groups={EFFECT_MENU_GROUPS}
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
