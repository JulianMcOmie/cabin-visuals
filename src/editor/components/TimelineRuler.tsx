import { useRef } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { TRACK_LABEL_WIDTH } from '../constants'

export function TimelineRuler() {
  const totalBars = useTimeStore((s) => s.totalBars)
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const setCurrentBeat = useTimeStore((s) => s.setCurrentBeat)

  const rulerRef = useRef<HTMLDivElement>(null)

  const maxBeat = totalBars * beatsPerBar
  const playheadPct = maxBeat > 0 ? (currentBeat / maxBeat) * 100 : 0
  const interval = totalBars <= 16 ? 1 : totalBars <= 64 ? 2 : 4

  const handleClick = (e: React.MouseEvent) => {
    if (!rulerRef.current) return
    const rect = rulerRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setCurrentBeat(pct * maxBeat)
  }

  return (
    <div className="flex flex-shrink-0 h-7 border-b border-zinc-800 bg-zinc-900 select-none">
      <div style={{ width: TRACK_LABEL_WIDTH }} className="flex-shrink-0 border-r border-zinc-800" />
      <div ref={rulerRef} className="flex-1 relative cursor-pointer" onClick={handleClick}>
        {Array.from({ length: totalBars }, (_, i) => i)
          .filter((i) => i % interval === 0)
          .map((bar) => (
            <div
              key={bar}
              className="absolute top-0 bottom-0 flex flex-col justify-end"
              style={{ left: `${(bar / totalBars) * 100}%` }}
            >
              <div className="absolute top-0 bottom-0 w-px bg-zinc-800" />
              <span className="relative text-[10px] text-zinc-500 pl-1 pb-0.5 z-10 leading-none">
                {bar + 1}
              </span>
            </div>
          ))}
        <div
          className="absolute top-0 bottom-0 w-px bg-indigo-400 z-20 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        >
          <div
            className="absolute -top-0 -translate-x-[4.5px] w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '7px solid #818cf8',
            }}
          />
        </div>
      </div>
    </div>
  )
}
