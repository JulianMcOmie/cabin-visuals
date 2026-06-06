import { useState } from 'react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

type Tab = 'settings' | 'midi' | 'effects'

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('settings')
  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const tracks = useProjectStore((s) => s.tracks)
  const track = tracks.find((t) => t.id === selectedTrackId) ?? null

  return (
    <div className="w-56 flex-shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex border-b border-zinc-800">
        {(['settings', 'midi', 'effects'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[11px] font-medium capitalize transition-colors ${
              tab === t
                ? 'text-indigo-400 border-b-2 border-indigo-500 -mb-px'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'midi' ? 'MIDI' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex-1 p-3">
        {!track ? (
          <p className="text-xs text-zinc-600 text-center mt-8">No track selected</p>
        ) : (
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-1">{track.name}</p>
            <p className="text-[11px] text-zinc-600 capitalize">{track.type} · {track.instrumentId}</p>
          </div>
        )}
      </div>
    </div>
  )
}
