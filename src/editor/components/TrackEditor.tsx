'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Music2, Sparkles, ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { getModulator } from '../instruments/modulators'
import { getEffect, type VisualEffect } from '../effects'
import type { ParamDef } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import type { Routing, EffectInstance } from '../types'

type Tab = 'instrument' | 'effects'

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
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-zinc-300">{label}</span>
        <span className="text-xs text-zinc-500 tabular-nums">{value.toFixed(2)}</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        className="relative h-1 bg-zinc-800 rounded-full cursor-pointer select-none"
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-cyan-500"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-zinc-900"
          style={{ left: `calc(${pct}% - 5px)` }}
        />
      </div>
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
      <div className="mb-4">
        <div className="text-xs text-zinc-300 mb-1.5">{param.label}</div>
        <select
          value={numValue ?? param.default}
          onChange={(e) => onNum(Number(e.target.value))}
          className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
        >
          {param.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
  }
  if (param.type === 'boolean') {
    const on = (numValue ?? param.default) >= 0.5
    return (
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-zinc-300">{param.label}</span>
        <button
          onClick={() => onNum(on ? 0 : 1)}
          className={`w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ${on ? 'bg-cyan-600' : 'bg-zinc-700'}`}
          aria-label={param.label}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
    )
  }
  if (param.type === 'color') {
    return (
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-zinc-300">{param.label}</span>
        <input
          type="color"
          value={strValue ?? param.default}
          onChange={(e) => onStr?.(e.target.value)}
          className="w-8 h-6 rounded bg-transparent border border-zinc-700 cursor-pointer flex-shrink-0"
        />
      </div>
    )
  }
  if (param.type === 'string') {
    const value = strValue ?? param.default
    return (
      <div className="mb-4">
        <div className="text-xs text-zinc-300 mb-1.5">{param.label}</div>
        {param.multiline
          ? <textarea value={value} onChange={(e) => onStr?.(e.target.value)} rows={3} className="w-full px-2 py-1 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none resize-y" />
          : <input type="text" value={value} onChange={(e) => onStr?.(e.target.value)} className="w-full h-7 px-2 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none" />}
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
        className="w-full h-7 px-2 flex items-center justify-between gap-2 rounded bg-zinc-800 text-[11px] border border-zinc-700 outline-none hover:border-zinc-600"
      >
        <span className={`truncate ${chosen.length === 0 ? 'text-zinc-500' : 'text-zinc-300'}`}>{summary}</span>
        <ChevronDown size={13} className="flex-shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-zinc-800 border border-zinc-700 shadow-lg shadow-black/40 py-1">
          {options.map((o) => {
            const isChecked = selected.has(o.key)
            return (
              <button
                key={o.key}
                onClick={() => onToggle(o.key)}
                className="w-full px-2 h-7 flex items-center gap-2 text-[11px] text-zinc-300 hover:bg-zinc-700"
              >
                <span
                  className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center ${
                    isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
                  }`}
                >
                  {isChecked && <Check size={11} className="text-white" strokeWidth={3} />}
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
 *  The add box is a combobox: type a new tag, or pick an existing project tag from
 *  the dropdown (`suggestions` = every tag used elsewhere in the project). */
function TagEditor({
  tags, suggestions, onChange,
}: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
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

  const addTag = (value: string) => {
    const t = value.trim()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
    setOpen(false)
  }

  // Existing project tags not already on this track, narrowed by what's typed.
  const q = draft.trim().toLowerCase()
  const matches = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(q))

  return (
    <div className="mt-5">
      <p className="text-[11px] text-zinc-500 mb-2">Tags:</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.length === 0 && <span className="text-[11px] text-zinc-600">No tags</span>}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300"
          >
            {t}
            <button
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label={`Remove tag ${t}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div ref={ref} className="relative">
        <div className="flex items-center gap-1 h-7 pl-2 pr-1 rounded bg-zinc-800 border border-zinc-700 focus-within:border-zinc-600">
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(draft) } }}
            placeholder="Add a tag…"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-zinc-300 outline-none placeholder:text-zinc-600"
          />
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex-shrink-0 text-zinc-500 hover:text-zinc-300"
            aria-label="Show existing tags"
          >
            <ChevronDown size={13} />
          </button>
        </div>
        {open && matches.length > 0 && (
          <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-zinc-800 border border-zinc-700 shadow-lg shadow-black/40 py-1">
            {matches.map((s) => (
              <button
                key={s}
                onClick={() => addTag(s)}
                className="w-full px-2 h-7 flex items-center text-[11px] text-zinc-300 hover:bg-zinc-700 truncate"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* While open, reserve flow space below the input so the absolutely-positioned
          list isn't clipped against the panel's bottom edge and can scroll into view
          (the panel's pb keeps a gap beneath it). */}
      {open && matches.length > 0 && <div aria-hidden className="h-36" />}
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
            className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center ${
              inst.enabled ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
            }`}
            aria-label={inst.enabled ? 'Disable effect' : 'Enable effect'}
          >
            {inst.enabled && <Check size={11} className="text-white" strokeWidth={3} />}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center gap-1 min-w-0"
            aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
          >
            <span className={`text-xs font-semibold truncate ${inst.enabled ? 'text-zinc-200' : 'text-zinc-500'}`}>
              {plugin.name}
            </span>
            {collapsed ? <ChevronRight size={12} className="flex-shrink-0 text-zinc-500" /> : <ChevronDown size={12} className="flex-shrink-0 text-zinc-500" />}
          </button>
        </div>
        <button onClick={onRemove} className="flex-shrink-0 text-zinc-500 hover:text-zinc-200" aria-label="Remove effect">
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

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'instrument', label: 'Instrument', icon: <Music2 size={11} /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles size={11} /> },
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
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800">
        <div className="px-3 pt-2 pb-1">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
            Track Editor
          </span>
        </div>
        <div className="flex px-1 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 flex-1 justify-center py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
                tab === t.id
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-zinc-500 hover:text-zinc-300 border-transparent'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-3 pb-12">
        {tab === 'instrument' && (
          <>
            {track ? (
              <>
                <p className="text-sm font-semibold text-zinc-200 mb-0.5">{track.name}</p>
                <p className="text-[11px] text-zinc-600 mb-4 capitalize">
                  {track.type} · {track.instrumentId}
                </p>
                {(() => {
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
                    // A target can be a tag (a group), a whole branch (subtree), or a
                    // single track. Each maps to a routing; we key options so selection
                    // survives the mix.
                    const keyOf = (r: Routing) =>
                      r.scope.kind === 'tag' ? `tag:${r.scope.tag}`
                      : r.scope.kind === 'track' ? `track:${r.scope.id}`
                      : `subtree:${r.scope.id}`
                    const options = [
                      ...allTags.map((tag) => ({
                        key: `tag:${tag}`,
                        label: `#${tag}`,
                        routing: { port: modDef.port, scope: { kind: 'tag' as const, tag }, amount: 1 },
                      })),
                      ...branchTracks.map((t) => ({
                        key: `subtree:${t.id}`,
                        label: `${t.name} (branch)`,
                        routing: { port: modDef.port, scope: { kind: 'subtree' as const, id: t.id }, amount: 1 },
                      })),
                      ...objectTracks.map((t) => ({
                        key: `track:${t.id}`,
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
                        <p className="text-[11px] text-zinc-500 mb-2">Targets:</p>
                        {options.length === 0 ? (
                          <p className="text-[11px] text-zinc-600">No objects to target</p>
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
                        <p className="text-[11px] text-zinc-600">No parameters</p>
                      ) : (
                        <>
                          <p className="text-[11px] text-zinc-500 mb-3">Parameters:</p>
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
              <p className="text-xs text-zinc-600 text-center mt-8">No track selected</p>
            )}
          </>
        )}
        {tab === 'effects' && (
          track ? (
            <div
              data-effects-drop
              className={`min-h-full rounded transition-colors ${effectDragging ? 'ring-2 ring-inset ring-indigo-500/60 bg-indigo-500/5' : ''}`}
            >
              {(track.effects ?? []).length === 0 ? (
                <p className="text-xs text-zinc-600 text-center mt-8">
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
            <p className="text-xs text-zinc-600 text-center mt-8">No track selected</p>
          )
        )}
      </div>
    </div>
  )
}
