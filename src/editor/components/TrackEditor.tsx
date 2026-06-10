'use client'

import { useState } from 'react'
import { Music2, Sliders, Sparkles } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

type Tab = 'instrument' | 'midi' | 'effects'

function ParamSlider({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-zinc-300">{label}</span>
        <span className="text-xs text-zinc-500 tabular-nums">{value}%</span>
      </div>
      <div className="relative h-1 bg-zinc-800 rounded-full">
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-cyan-500"
          style={{ width: `${value}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-zinc-900"
          style={{ left: `calc(${value}% - 5px)` }}
        />
      </div>
    </div>
  )
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'instrument', label: 'Instrument', icon: <Music2 size={11} /> },
  { id: 'midi', label: 'MIDI', icon: <Sliders size={11} /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles size={11} /> },
]

export function TrackEditor() {
  const [tab, setTab] = useState<Tab>('instrument')
  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const track =
    (selectedTrackId ? tracks[selectedTrackId] : undefined) ??
    (rootTrackIds[0] ? tracks[rootTrackIds[0]] : undefined) ??
    null

  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-950">
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

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'instrument' && (
          <>
            {track ? (
              <>
                <p className="text-sm font-semibold text-zinc-200 mb-0.5">{track.name}</p>
                <p className="text-[11px] text-zinc-600 mb-4 capitalize">
                  {track.type} · {track.instrumentId}
                </p>
                <p className="text-[11px] text-zinc-500 mb-3">Parameters:</p>
                <ParamSlider label="Base Size" value={59} />
                <ParamSlider label="Compression Amount" value={25} />
                <ParamSlider label="Min Size Factor" value={18} />
                <ParamSlider label="X Position" value={50} />
              </>
            ) : (
              <p className="text-xs text-zinc-600 text-center mt-8">No track selected</p>
            )}
          </>
        )}
        {tab === 'midi' && (
          <p className="text-xs text-zinc-600 text-center mt-8">No MIDI data</p>
        )}
        {tab === 'effects' && (
          <p className="text-xs text-zinc-600 text-center mt-8">No effects</p>
        )}
      </div>
    </div>
  )
}
