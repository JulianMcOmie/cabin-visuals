'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Music2, Sparkles } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { getInstrument } from '../instruments'

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
                <p className="text-[11px] text-zinc-500 mb-3">Parameters:</p>
                {(() => {
                  const def = getInstrument(track.instrumentId)
                  if (!def || def.params.length === 0) {
                    return <p className="text-[11px] text-zinc-600">No parameters</p>
                  }
                  return def.params.map((p) => (
                    <ParamSlider
                      key={p.key}
                      label={p.label}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={track.params?.[p.key] ?? p.default}
                      onChange={(v) => setTrackParam(track.id, p.key, v)}
                    />
                  ))
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
