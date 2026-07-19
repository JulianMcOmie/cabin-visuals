'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Check, Plus, X, Pencil } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { getDirector } from '../core/directors'
import { DIRECTOR_OPACITY_PARAM } from '../core/directors/types'
import { orderedSceneBindings } from '../core/directors/sceneBindings'
import { DEFAULT_ADSR } from '../core/visual/adsr'
import { ENVELOPE_OPACITY_TARGET } from '../core/visual/resolve'
import { getEffect, PLUGIN_LIST, type VisualEffect, type EffectCategory } from '../effects'
import { parseFxTarget } from '../effects/automation'
import { NestedMenu, type NestedMenuGroup } from './NestedMenu'
import { isNumberParam, isStringParam } from '../instruments/types'
import { getUserInterfaceRenderer, ParamControl, ParamToggle, type UserInterfaceParameter } from '../userInterfaceRenderers'
import { getEffectUserInterface, getMoverUserInterface } from '../userInterfaceRenderers/bespokeRegistries'
import { EnvelopeUserInterface } from '../userInterfaceRenderers/EnvelopeUserInterface'
import type { InterpolationMode, Routing, EffectInstance, Track } from '../types'

type Tab = 'instrument' | 'effects'

/** The track's name in the inspector header - double-click to rename, same contract
 *  as the timeline label (Enter/blur commits, Esc cancels, empty = cancel). */
function EditableTrackName({ trackId, name }: { trackId: string; name: string }) {
  const renameTrack = useProjectStore((s) => s.renameTrack)
  const [renaming, setRenaming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  if (renaming) {
    return (
      <input
        ref={inputRef}
        defaultValue={name}
        onBlur={(e) => { renameTrack(trackId, e.currentTarget.value); setRenaming(false) }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') { e.currentTarget.value = name; e.currentTarget.blur() }
        }}
        className="w-32 text-[11px] font-semibold text-right text-[var(--text)] bg-[var(--bg-app)] border border-[var(--border-strong)] rounded px-1 py-0 outline-none focus:border-[var(--accent)]"
      />
    )
  }
  // The pencil only surfaces on hover - present when you look, absent when you don't.
  return (
    <div
      title="Double-click to rename"
      onDoubleClick={() => setRenaming(true)}
      className="group flex items-center gap-1.5 min-w-0 cursor-text select-none"
    >
      <span className="text-[11px] font-semibold text-[var(--accent)] truncate">{name}</span>
      <button
        onClick={() => setRenaming(true)}
        aria-label="Rename track"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] transition-opacity cursor-pointer"
      >
        <Pencil size={10} />
      </button>
    </div>
  )
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

/** Add/remove a track's tags. Tags are the group labels a modulator can route to.
 *  Chips on --bg-elevated plus a dashed "+ add" chip; clicking it opens the same
 *  combobox as before (type a new tag, or pick an existing project tag). */
function TagEditor({
  tags, suggestions, onChange,
}: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!adding) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAdding(false)
        setOpen(false)
        setDraft('')
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [adding])

  const addTag = (value: string) => {
    const t = value.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
    setOpen(false)
    setAdding(false)
  }

  // Existing project tags not already on this track, narrowed by what's typed.
  const q = draft.trim().toLowerCase()
  const matches = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(q))

  return (
    <div className="mt-[18px] pt-3.5 border-t border-[var(--border)]">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">TAGS</span>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-[3px] bg-[var(--bg-elevated)] border border-[var(--border)] text-[11px] text-[var(--text-3)]"
          >
            {t}
            <button
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              aria-label={`Remove tag ${t}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-2 py-0.5 rounded-[3px] border border-dashed border-[var(--border)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-3)] hover:border-[var(--border-strong)] transition-colors cursor-pointer"
          >
            + add
          </button>
        )}
      </div>
      {adding && (
        <div ref={ref} className="relative mt-2">
          <div className="flex items-center gap-1 h-7 pl-2 pr-1 rounded bg-[var(--bg-app)] border border-[var(--border)] focus-within:border-[var(--accent)]">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(draft) }
                else if (e.key === 'Escape') { setAdding(false); setOpen(false); setDraft('') }
              }}
              placeholder="Add a tag…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-[var(--text-2)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-2)] cursor-pointer"
              aria-label="Show existing tags"
            >
              <ChevronDown size={13} />
            </button>
          </div>
          {open && matches.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-[var(--bg-elevated)] border border-[var(--border)] shadow-lg shadow-black/40 py-1">
              {matches.map((s) => (
                <button
                  key={s}
                  onClick={() => addTag(s)}
                  className="w-full px-2 h-7 flex items-center text-[11px] text-[var(--text-2)] hover:bg-[var(--border)] truncate cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* While open, reserve flow space below the input so the absolutely-positioned
              list isn't clipped against the panel's bottom edge and can scroll into view
              (the panel's pb keeps a gap beneath it). */}
          {open && matches.length > 0 && <div aria-hidden className="h-36" />}
        </div>
      )}
    </div>
  )
}

// The picker menu's groups, generated from the registry so a new plugin shows up
// here with no extra wiring. Category order is fixed: transform, clone, shader.
const EFFECT_CATEGORIES: { key: EffectCategory; label: string }[] = [
  { key: 'transform', label: 'Transform' },
  { key: 'shader', label: 'Shader' },
]
const EFFECT_MENU_GROUPS: NestedMenuGroup[] = EFFECT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  items: PLUGIN_LIST.filter((p) => p.category === c.key).map((p) => ({ id: p.id, label: p.name })),
}))

/** One effect in the Effects tab: header (enable / name / reorder / remove) with
 *  collapsible param sliders. Collapse is local per instance, so it persists across
 *  re-renders. Reordering is meaningful: the render chain follows array order. */
function EffectItem({
  plugin, inst, index, count, onToggle, onRemove, onMove, onSetSetting,
}: {
  plugin: VisualEffect
  inst: EffectInstance
  index: number
  count: number
  onToggle: () => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  onSetSetting: (key: string, value: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const BespokeEffect = getEffectUserInterface(plugin.id)
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onToggle}
            className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center cursor-pointer transition-all active:scale-75 ${
              inst.enabled ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-strong)]'
            }`}
            aria-label={inst.enabled ? 'Disable effect' : 'Enable effect'}
          >
            {inst.enabled && <Check size={11} className="text-[var(--on-accent)]" strokeWidth={3} />}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1 min-w-0 cursor-pointer"
            aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
          >
            <span className={`text-[11px] font-semibold truncate ${inst.enabled ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
              {plugin.name}
            </span>
            {collapsed ? <ChevronRight size={12} className="flex-shrink-0 text-[var(--text-muted)]" /> : <ChevronDown size={12} className="flex-shrink-0 text-[var(--text-muted)]" />}
          </button>
        </div>
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
      {!collapsed && (BespokeEffect ? (
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
      )))}
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'instrument', label: 'Instrument' },
  { id: 'effects', label: 'Effects' },
]

const INTERP_OPTIONS: { value: InterpolationMode; label: string }[] = [
  { value: 'step', label: 'Step' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'smooth-step', label: 'Smooth Step' },
]


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
  return (
    <div className="mb-4">
      <p className="text-[11px] text-zinc-500 mb-2">Targets:</p>
      {options.length === 0
        ? <p className="text-[11px] text-zinc-600">No objects to target</p>
        : <TargetSelect options={options} selected={selected} onToggle={toggle} />}
    </div>
  )
}

export function TrackEditor() {
  const [tab, setTab] = useState<Tab>('instrument')
  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const tracks = useProjectStore((s) => s.tracks)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const activeScene = useProjectStore((s) => s.scenes[s.activeSceneId])
  const setSceneBackgroundColor = useProjectStore((s) => s.setSceneBackgroundColor)
  const setSceneBackgroundTransparent = useProjectStore((s) => s.setSceneBackgroundTransparent)
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  const setTrackStringParam = useProjectStore((s) => s.setTrackStringParam)
  const setTrackTags = useProjectStore((s) => s.setTrackTags)
  const setTrackOnTop = useProjectStore((s) => s.setTrackOnTop)
  const setMoverInput = useProjectStore((s) => s.setMoverInput)
  const setDirectorSceneBindings = useProjectStore((s) => s.setDirectorSceneBindings)
  const setEnvelopeAdsr = useProjectStore((s) => s.setEnvelopeAdsr)
  const setEnvelopeDepth = useProjectStore((s) => s.setEnvelopeDepth)
  const setEnvelopeTarget = useProjectStore((s) => s.setEnvelopeTarget)
  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const setEffectSetting = useProjectStore((s) => s.setEffectSetting)
  const removeEffect = useProjectStore((s) => s.removeEffect)
  const toggleEffect = useProjectStore((s) => s.toggleEffect)
  const reorderEffect = useProjectStore((s) => s.reorderEffect)
  const addEffect = useProjectStore((s) => s.addEffect)
  const effectDragging = useUIStore((s) => s.effectDragging)
  // Effects picker menu anchor (viewport coords); null = closed.
  const [fxMenu, setFxMenu] = useState<{ x: number; y: number } | null>(null)
  const track = selectedTrackId ? tracks[selectedTrackId] ?? null : null

  // Dragging an effect from the library flips this panel to its Effects tab so the
  // drop zone is visible.
  useEffect(() => { if (effectDragging && track) setTab('effects') }, [effectDragging, track])
  useEffect(() => { if (!selectedTrackId) setTab('instrument') }, [activeSceneId, selectedTrackId])

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] bg-[var(--bg-panel)]">
      {/* A scene tab selects the scene inspector; selecting a timeline row swaps
          this same surface back to the track inspector. */}
      <div className="h-8 flex-shrink-0 flex items-center justify-between gap-2 px-3 border-b border-[var(--border)]">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">{track ? 'TRACK' : 'SCENE'}</span>
        {track
          ? <EditableTrackName trackId={track.id} name={track.name} />
          : <span className="text-[11px] font-semibold text-[var(--accent)] select-none">{activeScene?.name ?? '-'}</span>}
      </div>

      {/* Tabs - flat segmented row, inset accent underline on the active tab. */}
      <div className="flex flex-shrink-0 border-b border-[var(--border)]">
        {track ? TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 h-7 text-[11px] transition-colors cursor-pointer ${
              i < TABS.length - 1 ? 'border-r border-[var(--border)]' : ''
            } ${
              tab === t.id
                ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
                : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            {t.label}
          </button>
        )) : (
          <div className="flex-1 h-7 flex items-center justify-center bg-[var(--bg-app)] text-[11px] font-semibold text-[var(--text)] shadow-[inset_0_-2px_0_var(--accent)]">
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
                    const moverParameters: UserInterfaceParameter[] = newMoverDef.params
                      .filter((p) => typeof p.default === 'number')
                      .map((p) => ({
                        definition: p,
                        value: track.inputValues?.[p.key] ?? (p.default as number),
                        setValue: (v) => { if (typeof v === 'number') setMoverInput(track.id, p.key, v) },
                      }))
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
                                numValue={typeof p.default === 'number' ? track.inputValues?.[p.key] ?? p.default : undefined}
                                strValue={undefined}
                                onNum={(v) => setMoverInput(track.id, p.key, v)}
                              />
                            ))}
                          </>
                        )}
                        {!track.parentId && <MoverTargets track={track} />}
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
                          {director?.name ?? 'Unknown director'} renders scene sources into Main. Its MIDI rows choose the scene inputs.
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
                        ) : (
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
                  const projectTags = [...new Set(Object.values(tracks).flatMap((t) => t.tags ?? []))].sort()
                  const onTop = track.onTop ?? def?.defaultOnTop ?? false
                  const UserInterfaceRenderer = def ? getUserInterfaceRenderer(def.userInterfaceRenderer) : null
                  // Params gated behind a toggle (showIf) only appear while
                  // that toggle is on - a flight-speed slider means nothing
                  // with flight mode off.
                  const numericValue = (key: string) =>
                    track.params?.[key] ?? Number(def?.params.find((p) => p.key === key)?.default ?? 0)
                  const visibleParameters = def?.params.filter(
                    (p) => !p.showIf || numericValue(p.showIf) >= 0.5,
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
                  return (
                    <>
                      {/* Layering: every object gets the switch; Text defaults on. */}
                      <div className="mb-4 flex items-center justify-between">
                        <span
                          className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none"
                          title="Draw this instrument on top of everything else in the scene"
                        >
                          IN FRONT
                        </span>
                        <ParamToggle
                          on={onTop}
                          onChange={(v) => setTrackOnTop(track.id, v)}
                          label="Draw in front of everything"
                        />
                      </div>
                      {!UserInterfaceRenderer ? (
                        <p className="text-[11px] text-[var(--text-muted)]">No parameters</p>
                      ) : (
                        <UserInterfaceRenderer
                          targetId={track.id}
                          parameters={userInterfaceParameters}
                        />
                      )}
                      <TagEditor
                        tags={track.tags ?? []}
                        suggestions={projectTags}
                        onChange={(tags) => setTrackTags(track.id, tags)}
                      />
                    </>
                  )
                })()}
              </>
            ) : activeScene ? (
              <>
                <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PARAMETERS</p>
                <ParamControl
                  param={{ key: 'backgroundColor', label: 'Background', type: 'color', default: '#000000' }}
                  numValue={undefined}
                  strValue={activeScene.backgroundColor}
                  onNum={() => {}}
                  onStr={(color) => setSceneBackgroundColor(activeScene.id, color)}
                />
                <ParamControl
                  param={{ key: 'backgroundTransparent', label: 'Transparent background', type: 'boolean', default: 0 }}
                  numValue={activeScene.backgroundTransparent ? 1 : 0}
                  strValue={undefined}
                  onNum={(value) => setSceneBackgroundTransparent(activeScene.id, value >= 0.5)}
                />
              </>
            ) : null}
          </>
        )}
        {tab === 'effects' && (
          track ? (() => {
            const effects = track.effects ?? []
            // The picker only offers effects where they render: object tracks.
            const isObject = !!getInstrument(track.instrumentId)
            return (
              <div
                data-effects-drop
                onContextMenu={isObject ? (e) => { e.preventDefault(); setFxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
                className={`min-h-full rounded transition-colors ${effectDragging ? 'ring-2 ring-inset ring-[rgba(53,167,230,0.6)] bg-[rgba(53,167,230,0.05)]' : ''}`}
              >
                {effects.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)] text-center mt-8 mb-4">
                    {effectDragging ? 'Drop to add effect' : 'Drag an effect from the library here'}
                  </p>
                )}
                {effects.map((inst, i) => {
                  const plugin = getEffect(inst.pluginId)
                  if (!plugin) return null
                  return (
                    <EffectItem
                      key={inst.id}
                      plugin={plugin}
                      inst={inst}
                      index={i}
                      count={effects.length}
                      onToggle={() => toggleEffect(track.id, inst.id)}
                      onRemove={() => removeEffect(track.id, inst.id)}
                      onMove={(direction) => reorderEffect(track.id, inst.id, direction)}
                      onSetSetting={(key, value) => setEffectSetting(track.id, inst.id, key, value)}
                    />
                  )
                })}
                {isObject && (
                  <button
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setFxMenu({ x: r.left, y: r.bottom + 4 })
                    }}
                    className="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-dashed border-[var(--border)] text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
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
                    onPick={(_, pluginId) => addEffect(track.id, pluginId)}
                    onClose={() => setFxMenu(null)}
                  />
                )}
              </div>
            )
          })() : (
            <p className="text-xs text-[var(--text-muted)] text-center mt-8">No track selected</p>
          )
        )}
      </div>
    </div>
  )
}
