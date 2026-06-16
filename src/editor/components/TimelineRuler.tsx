import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { TRACK_LABEL_WIDTH } from '../constants'

interface TimelineRulerProps {
  /** Begin a scrub gesture (provided by TimelineArea via useScrub). */
  onScrubStart: (e: ReactPointerEvent) => void
}

export function TimelineRuler({ onScrubStart }: TimelineRulerProps) {
  const totalBars = useTimeStore((s) => s.totalBars)
  const interval = totalBars <= 16 ? 1 : totalBars <= 64 ? 2 : 4

  return (
    <div className="flex flex-shrink-0 h-7 border-b border-zinc-800 bg-zinc-900 select-none">
      <div style={{ width: TRACK_LABEL_WIDTH }} className="flex-shrink-0 border-r border-zinc-800" />
      <div className="flex-1 relative cursor-col-resize" onPointerDown={onScrubStart}>
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
      </div>
    </div>
  )
}
