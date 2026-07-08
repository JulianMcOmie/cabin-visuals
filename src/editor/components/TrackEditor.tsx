'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, Check, X, Pencil } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { getModulator } from '../instruments/modulators'
import { MOVER_DEPTH_PARAM, moverInputParamDefs, getMover, isMoverMidiInput } from '../core/visual/movers/registry'
import { getEffect, type VisualEffect } from '../effects'
import { isNumberParam, type ParamDef } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import type { InterpolationMode, MidiMode, Routing, EffectInstance, SubsetWeightSpec } from '../types'

type Tab = 'instrument' | 'effects'

/** The track's name in the inspector header — double-click to rename, same contract
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
  // The pencil only surfaces on hover — present when you look, absent when you don't.
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

/** One param row: label | 3px accent slider | mono value — 100px / 1fr / 44px. */
function ParamSlider({
  label, value, min, max, step, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = ((value - min) / (max - min)) * 100

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = min + t * (max - min)
    const snapped = Math.max(min, Math.min(max, Math.round(raw / step) * step))
    onChange(snapped)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    lockCursor('grabbing')
    setFromClientX(e.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="grid grid-cols-[100px_1fr_44px] items-center gap-2.5 mb-[13px]">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={label}>{label}</span>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        className="relative h-[3px] bg-[var(--border)] rounded-full cursor-pointer select-none"
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-[var(--text)]"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="font-mono text-[10px] text-[var(--text-muted)] text-right tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

/** Renders the right control for any param type: slider (number), dropdown (select),
 *  toggle (boolean), colour picker (color), or text/textarea (string). Numeric values
 *  go through `onNum`; string values (color/string) through `onStr`. */
function ParamControl({ param, numValue, strValue, onNum, onStr }: {
  param: ParamDef
  numValue: number | undefined
  strValue: string | undefined
  onNum: (v: number) => void
  onStr?: (v: string) => void
}) {
  if (param.type === 'select') {
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <select
          value={numValue ?? param.default}
          onChange={(e) => onNum(Number(e.target.value))}
          className="w-full h-6 px-1.5 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none cursor-pointer"
        >
          {param.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
  }
  if (param.type === 'boolean') {
    const on = (numValue ?? param.default) >= 0.5
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <div className="flex justify-end">
          <button
            onClick={() => onNum(on ? 0 : 1)}
            className={`w-8 h-4 rounded-full relative transition-colors flex-shrink-0 cursor-pointer ${on ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}
            aria-label={param.label}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-[var(--text)] transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    )
  }
  if (param.type === 'color') {
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <div className="flex justify-end">
          <input
            type="color"
            value={strValue ?? param.default}
            onChange={(e) => onStr?.(e.target.value)}
            className="w-8 h-5 rounded bg-transparent border border-[var(--border)] cursor-pointer flex-shrink-0"
          />
        </div>
      </div>
    )
  }
  if (param.type === 'string') {
    const value = strValue ?? param.default
    return (
      <div className="mb-[13px]">
        <div className="text-[11px] text-[var(--text-3)] mb-1.5">{param.label}</div>
        {param.multiline
          ? <textarea value={value} onChange={(e) => onStr?.(e.target.value)} rows={3} className="w-full px-2 py-1 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)] resize-y" />
          : <input type="text" value={value} onChange={(e) => onStr?.(e.target.value)} className="w-full h-6 px-2 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" />}
      </div>
    )
  }
  return (
    <ParamSlider
      label={param.label}
      value={numValue ?? param.default}
      min={param.min}
      max={param.max}
      step={param.step}
      onChange={onNum}
    />
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
  const summary = chosen.length === 0 ? '— none —' : chosen.map((o) => o.label).join(', ')

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

/** One effect in the Effects tab: header (enable / name / remove) with collapsible
 *  param sliders. Collapse is local per instance, so it persists across re-renders. */
function EffectItem({
  plugin, inst, onToggle, onRemove, onSetSetting,
}: {
  plugin: VisualEffect
  inst: EffectInstance
  onToggle: () => void
  onRemove: () => void
  onSetSetting: (key: string, value: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onToggle}
            className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center cursor-pointer ${
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
        <button onClick={onRemove} className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer" aria-label="Remove effect">
          <X size={12} />
        </button>
      </div>
      {!collapsed && plugin.params.map((p) => (
        <ParamControl
          key={p.key}
          param={p}
          numValue={inst.settings[p.key]}
          strValue={undefined}
          onNum={(v) => onSetSetting(p.key, v)}
        />
      ))}
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

export function TrackEditor() {
  const [tab, setTab] = useState<Tab>('instrument')
  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const setTrackParam = useProjectStore((s) => s.setTrackParam)
  const setTrackStringParam = useProjectStore((s) => s.setTrackStringParam)
  const setTrackTargets = useProjectStore((s) => s.setTrackTargets)
  const setTrackTags = useProjectStore((s) => s.setTrackTags)
  const setMoverInput = useProjectStore((s) => s.setMoverInput)
  const setMoverDepth = useProjectStore((s) => s.setMoverDepth)
  const setMoverMidiMode = useProjectStore((s) => s.setMoverMidiMode)
  const setMoverMidiTarget = useProjectStore((s) => s.setMoverMidiTarget)
  const setMoverEnvelope = useProjectStore((s) => s.setMoverEnvelope)
  const setMoverWeight = useProjectStore((s) => s.setMoverWeight)
  const setMoverOpMode = useProjectStore((s) => s.setMoverOpMode)
  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const setEffectSetting = useProjectStore((s) => s.setEffectSetting)
  const removeEffect = useProjectStore((s) => s.removeEffect)
  const toggleEffect = useProjectStore((s) => s.toggleEffect)
  const effectDragging = useUIStore((s) => s.effectDragging)
  const track =
    (selectedTrackId ? tracks[selectedTrackId] : undefined) ??
    (rootTrackIds[0] ? tracks[rootTrackIds[0]] : undefined) ??
    null

  // Dragging an effect from the library flips this panel to its Effects tab so the
  // drop zone is visible.
  useEffect(() => { if (effectDragging) setTab('effects') }, [effectDragging])

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] bg-[var(--bg-panel)]">
      {/* Header: TRACK caps label + accent track name (double-click renames). */}
      <div className="h-8 flex-shrink-0 flex items-center justify-between gap-2 px-3 border-b border-[var(--border)]">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">TRACK</span>
        {track
          ? <EditableTrackName trackId={track.id} name={track.name} />
          : <span className="text-[11px] text-[var(--text-muted)] select-none">—</span>}
      </div>

      {/* Tabs — flat segmented row, inset accent underline on the active tab. */}
      <div className="flex flex-shrink-0 border-b border-[var(--border)]">
        {TABS.map((t, i) => (
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
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-3 pb-12">
        {tab === 'instrument' && (
          <>
            {track ? (
              <>
                {(() => {
                    const dimDef = track.type === 'mover' ? getMover(track.moverId) : undefined
                  if (dimDef) {
                    const inputs = moverInputParamDefs(dimDef)
                    const midiTargetOptions = inputs.filter(isNumberParam)
                    const inputNames = midiTargetOptions.map((p) => p.key)
                    const midiTargetInput = isMoverMidiInput(dimDef, track.midiTargetInput)
                      ? track.midiTargetInput
                      : inputNames[0]
                    const midiMode = track.midiMode ?? 'none'
                    const envelope = track.envelope ?? { attack: 0.05, decay: 0.4 }
                    const weight = track.weight ?? ({ mode: 'all' } satisfies SubsetWeightSpec)
                    const setWeightMode = (mode: SubsetWeightSpec['mode']) => {
                      if (mode === 'gradient') setMoverWeight(track.id, { mode, slope: 1, phase: 0 })
                      else setMoverWeight(track.id, { mode })
                    }
                    return (
                      <>
                        <p className="text-[11px] text-zinc-500 mb-3">Mover:</p>
                        <div className="mb-4">
                          <div className="text-xs text-zinc-300 mb-1.5">Operation</div>
                          <select
                            value={track.opMode ?? 'transform'}
                            onChange={(e) => setMoverOpMode(track.id, e.target.value as 'transform' | 'add')}
                            className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
                          >
                            <option value="transform">Transform</option>
                            <option value="add">Add</option>
                          </select>
                        </div>
                        <ParamControl
                          param={MOVER_DEPTH_PARAM}
                          numValue={track.depth ?? 1}
                          strValue={undefined}
                          onNum={(v) => setMoverDepth(track.id, v)}
                        />
                        {inputs.map((p) => (
                          <ParamControl
                            key={p.key}
                            param={p}
                            numValue={typeof p.default === 'number' ? track.inputValues?.[p.key] ?? p.default : undefined}
                            strValue={undefined}
                            onNum={(v) => setMoverInput(track.id, p.key, v)}
                          />
                        ))}

                        {!track.parentId && (() => {
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
                        })()}

                        <div className="mb-4">
                          <div className="text-xs text-zinc-300 mb-1.5">MIDI Mode</div>
                          <select
                            value={midiMode}
                            onChange={(e) => setMoverMidiMode(track.id, e.target.value as MidiMode)}
                            className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
                          >
                            <option value="none">None</option>
                            <option value="continuous">Continuous</option>
                            <option value="amount">Amount</option>
                            <option value="ballistic">Ballistic</option>
                          </select>
                        </div>

                        {(midiMode === 'continuous' || midiMode === 'amount') && (
                          <>
                            {midiMode === 'continuous' && (
                              <div className="mb-4">
                                <div className="text-xs text-zinc-300 mb-1.5">MIDI Target</div>
                                <select
                                  value={midiTargetInput}
                                  onChange={(e) => setMoverMidiTarget(track.id, e.target.value)}
                                  className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
                                >
                                  {midiTargetOptions.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                                </select>
                              </div>
                            )}
                            <div className="mb-4">
                              <div className="text-xs text-zinc-300 mb-1.5">Interpolation</div>
                              <select
                                value={track.interpolation ?? 'linear'}
                                onChange={(e) => setTrackInterpolation(track.id, e.target.value as InterpolationMode)}
                                className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
                              >
                                {INTERP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                          </>
                        )}

                        {midiMode === 'ballistic' && (
                          <>
                            <ParamSlider
                              label="Attack"
                              value={envelope.attack}
                              min={0.01}
                              max={4}
                              step={0.01}
                              onChange={(attack) => setMoverEnvelope(track.id, { ...envelope, attack })}
                            />
                            <ParamSlider
                              label="Decay"
                              value={envelope.decay}
                              min={0.01}
                              max={8}
                              step={0.01}
                              onChange={(decay) => setMoverEnvelope(track.id, { ...envelope, decay })}
                            />
                          </>
                        )}

                        <div className="mb-4">
                          <div className="text-xs text-zinc-300 mb-1.5">Weight</div>
                          <select
                            value={weight.mode}
                            onChange={(e) => setWeightMode(e.target.value as SubsetWeightSpec['mode'])}
                            className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
                          >
                            <option value="all">All</option>
                            <option value="odd">Odd</option>
                            <option value="even">Even</option>
                            <option value="firstHalf">First half</option>
                            <option value="secondHalf">Second half</option>
                            <option value="checkerWhite">Checker white</option>
                            <option value="checkerBlack">Checker black</option>
                            <option value="gradient">Gradient</option>
                          </select>
                        </div>

                        {weight.mode === 'gradient' && (
                          <>
                            <ParamSlider
                              label="Slope"
                              value={weight.slope}
                              min={-4}
                              max={4}
                              step={0.01}
                              onChange={(slope) => setMoverWeight(track.id, { ...weight, slope })}
                            />
                            <ParamSlider
                              label="Phase"
                              value={weight.phase}
                              min={-1}
                              max={2}
                              step={0.01}
                              onChange={(phase) => setMoverWeight(track.id, { ...weight, phase })}
                            />
                          </>
                        )}
                      </>
                    )
                  }

                  // Modulator track → a target picker (which object it targets).
                  // The port is internal (from the modulator's def), never shown.
                  const modDef = getModulator(track.instrumentId)
                  if (modDef) {
                    const objectTracks = Object.values(tracks).filter(
                      (t) => getInstrument(t.instrumentId) && t.id !== track.id,
                    )
                    const allTags = [...new Set(objectTracks.flatMap((t) => t.tags ?? []))].sort()
                    // Tracks with children can be targeted as a whole branch (subtree).
                    const branchTracks = objectTracks.filter((t) => (t.childIds?.length ?? 0) > 0)
                    const moverPortOptions = Object.values(tracks)
                      .filter((t) => t.type === 'mover' && !!t.parentId)
                      .flatMap((t) => {
                        const parent = t.parentId ? tracks[t.parentId] : undefined
                        const d = getMover(t.moverId)
                        if (!parent || !d) return []
                        return Object.entries(d.inputs)
                          .filter(([, input]) => !input.hidden && input.type !== 'select')
                          .map(([inputName]) => ({
                            key: `dim:${t.id}:${inputName}`,
                            label: `${parent.name} · ${t.name}.${inputName}`,
                            routing: {
                              port: `dim:${t.id}:${inputName}`,
                              scope: { kind: 'track' as const, id: parent.id },
                              amount: 1,
                            },
                          }))
                      })
                    // A target can be a tag (a group), a whole branch (subtree), or a
                    // single track. Each maps to a routing; we key options so selection
                    // survives the mix.
                    const keyOf = (r: Routing) =>
                      r.scope.kind === 'tag' ? `${r.port}@tag:${r.scope.tag}`
                      : r.scope.kind === 'track' ? `${r.port}@track:${r.scope.id}`
                      : `${r.port}@subtree:${r.scope.id}`
                    const options = [
                      ...moverPortOptions,
                      ...allTags.map((tag) => ({
                        key: `${modDef.port}@tag:${tag}`,
                        label: `#${tag}`,
                        routing: { port: modDef.port, scope: { kind: 'tag' as const, tag }, amount: 1 },
                      })),
                      ...branchTracks.map((t) => ({
                        key: `${modDef.port}@subtree:${t.id}`,
                        label: `${t.name} (branch)`,
                        routing: { port: modDef.port, scope: { kind: 'subtree' as const, id: t.id }, amount: 1 },
                      })),
                      ...objectTracks.map((t) => ({
                        key: `${modDef.port}@track:${t.id}`,
                        label: t.name,
                        routing: { port: modDef.port, scope: { kind: 'track' as const, id: t.id }, amount: 1 },
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
                      <>
                        <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">TARGETS</p>
                        {options.length === 0 ? (
                          <p className="text-[11px] text-[var(--text-muted)]">No objects to target</p>
                        ) : (
                          <TargetSelect options={options} selected={selected} onToggle={toggle} />
                        )}
                      </>
                    )
                  }

                  // Object track → its param sliders, then its tags.
                  const def = getInstrument(track.instrumentId)
                  const projectTags = [...new Set(Object.values(tracks).flatMap((t) => t.tags ?? []))].sort()
                  return (
                    <>
                      {!def || def.params.length === 0 ? (
                        <p className="text-[11px] text-[var(--text-muted)]">No parameters</p>
                      ) : (
                        <>
                          <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PARAMETERS</p>
                          {def.params.map((p) => (
                            <ParamControl
                              key={p.key}
                              param={p}
                              numValue={track.params?.[p.key]}
                              strValue={track.stringParams?.[p.key]}
                              onNum={(v) => setTrackParam(track.id, p.key, v)}
                              onStr={(v) => setTrackStringParam(track.id, p.key, v)}
                            />
                          ))}
                        </>
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
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center mt-8">No track selected</p>
            )}
          </>
        )}
        {tab === 'effects' && (
          track ? (
            <div
              data-effects-drop
              className={`min-h-full rounded transition-colors ${effectDragging ? 'ring-2 ring-inset ring-[rgba(53,167,230,0.6)] bg-[rgba(53,167,230,0.05)]' : ''}`}
            >
              {(track.effects ?? []).length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] text-center mt-8">
                  {effectDragging ? 'Drop to add effect' : 'Drag an effect from the library here'}
                </p>
              ) : (
                (track.effects ?? []).map((inst) => {
                  const plugin = getEffect(inst.pluginId)
                  if (!plugin) return null
                  return (
                    <EffectItem
                      key={inst.id}
                      plugin={plugin}
                      inst={inst}
                      onToggle={() => toggleEffect(track.id, inst.id)}
                      onRemove={() => removeEffect(track.id, inst.id)}
                      onSetSetting={(key, value) => setEffectSetting(track.id, inst.id, key, value)}
                    />
                  )
                })
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] text-center mt-8">No track selected</p>
          )
        )}
      </div>
    </div>
  )
}
