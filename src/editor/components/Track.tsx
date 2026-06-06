import { useTimeStore } from '../store/timeStore'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { Block } from './Block'
import { TRACK_LABEL_WIDTH } from '../constants'
import type { Track as TrackType } from '../types'

interface TrackProps {
  track: TrackType
}

export function Track({ track }: TrackProps) {
  const totalBars = useTimeStore((s) => s.totalBars)
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)
  const currentBeat = useTimeStore((s) => s.currentBeat)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)

  const isSelected = selectedTrackId === track.id
  const maxBeat = totalBars * beatsPerBar
  const playheadPct = maxBeat > 0 ? (currentBeat / maxBeat) * 100 : 0

  return (
    <div
      className={`flex items-stretch h-12 border-b border-zinc-800/60 last:border-b-0 cursor-pointer transition-colors ${
        isSelected ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/40'
      }`}
      onClick={() => setSelectedTrackId(isSelected ? null : track.id)}
    >
      <div
        style={{ width: TRACK_LABEL_WIDTH }}
        className="flex-shrink-0 flex items-center gap-2 px-3 border-r border-zinc-800/60"
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: track.color }}>
            {track.name}
          </div>
          {track.targets && track.targets.length > 0 && (
            <div className="text-[10px] text-zinc-500 truncate mt-0.5">
              → {track.targets.map((t) => t.targetPort).join(', ')}
            </div>
          )}
        </div>

        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => toggleMute(track.id)}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              track.muted
                ? 'bg-amber-500 text-black'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            M
          </button>
          <button
            onClick={() => toggleSolo(track.id)}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              track.solo
                ? 'bg-green-500 text-black'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            S
          </button>
        </div>
      </div>

      <div className="flex-1 relative">
        <div
          className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
          style={{ left: `${playheadPct}%`, backgroundColor: '#818cf8aa' }}
        />
        {track.blocks.map((block) => (
          <Block
            key={block.id}
            block={block}
            totalBars={totalBars}
            beatsPerBar={beatsPerBar}
            color={track.color}
          />
        ))}
      </div>
    </div>
  )
}
