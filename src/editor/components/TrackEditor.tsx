'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Music2, Sparkles, ChevronDown, Check } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'
import { getModulator } from '../instruments/modulators'

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
    setFromClientX(e.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => controller.abort(), { signal: controller.signal })
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

/** A select-styled dropdown that allows checking multiple object tracks. */
function TargetSelect({
  options, selected, onToggle,
}: {
  options: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
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

  const chosen = options.filter((o) => selected.has(o.id))
  const label = chosen.length === 0 ? '— none —' : chosen.map((o) => o.name).join(', ')

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full h-7 px-2 flex items-center justify-between gap-2 rounded bg-zinc-800 text-[11px] border border-zinc-700 outline-none hover:border-zinc-600"
      >
        <span className={`truncate ${chosen.length === 0 ? 'text-zinc-500' : 'text-zinc-300'}`}>{label}</span>
        <ChevronDown size={13} className="flex-shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded bg-zinc-800 border border-zinc-700 shadow-lg shadow-black/40 py-1">
          {options.map((o) => {
            const isChecked = selected.has(o.id)
            return (
              <button
                key={o.id}
                onClick={() => onToggle(o.id)}
                className="w-full px-2 h-7 flex items-center gap-2 text-[11px] text-zinc-300 hover:bg-zinc-700"
              >
                <span
                  className={`w-3.5 h-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center ${
                    isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'
                  }`}
                >
                  {isChecked && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            )
          })}
        </div>
      )}
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
  const setTrackTargets = useProjectStore((s) => s.setTrackTargets)
  const track =
    (selectedTrackId ? tracks[selectedTrackId] : undefined) ??
    (rootTrackIds[0] ? tracks[rootTrackIds[0]] : undefined) ??
    null

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

      <div className="flex-1 overflow-y-auto no-scrollbar p-3">
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
                    const selected = new Set(
                      track.targets?.filter((r) => r.scope.kind === 'track').map((r) => (r.scope as { id: string }).id),
                    )
                    const toggle = (targetTrackId: string) => {
                      const next = new Set(selected)
                      if (next.has(targetTrackId)) next.delete(targetTrackId)
                      else next.add(targetTrackId)
                      setTrackTargets(
                        track.id,
                        [...next].map((id) => ({
                          port: modDef.port,
                          scope: { kind: 'track' as const, id },
                          amount: 1,
                        })),
                      )
                    }
                    return (
                      <>
                        <p className="text-[11px] text-zinc-500 mb-2">Targets:</p>
                        {objectTracks.length === 0 ? (
                          <p className="text-[11px] text-zinc-600">No objects to target</p>
                        ) : (
                          <TargetSelect options={objectTracks} selected={selected} onToggle={toggle} />
                        )}
                      </>
                    )
                  }

                  // Object track → its param sliders.
                  const def = getInstrument(track.instrumentId)
                  if (!def || def.params.length === 0) {
                    return <p className="text-[11px] text-zinc-600">No parameters</p>
                  }
                  return (
                    <>
                      <p className="text-[11px] text-zinc-500 mb-3">Parameters:</p>
                      {def.params.map((p) => (
                        <ParamSlider
                          key={p.key}
                          label={p.label}
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={track.params?.[p.key] ?? p.default}
                          onChange={(v) => setTrackParam(track.id, p.key, v)}
                        />
                      ))}
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
          <p className="text-xs text-zinc-600 text-center mt-8">No effects</p>
        )}
      </div>
    </div>
  )
}
