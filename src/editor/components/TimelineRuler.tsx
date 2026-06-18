import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useTimeStore } from '../store/TimeStore'
import { TRACK_LABEL_WIDTH } from '../constants'

interface TimelineRulerProps {
  /** Begin a scrub gesture (provided by TimelineArea via useScrub). */
  onScrubStart: (e: ReactPointerEvent) => void
  /** Width of one bar in pixels (beatsPerBar * pixelsPerBeat). */
  barWidthPx: number
  /** Full timeline width in pixels (totalBars * barWidthPx). */
  timelineWidthPx: number
  /** Trailing gutter (px) so the strip ends where the lanes' vertical scrollbar starts. */
  gutterPx: number
  /** Inner content element — translated horizontally to mirror the lane scroll. */
  contentRef: RefObject<HTMLDivElement | null>
  /** Playhead triangle element (the head), positioned by the RAF loop. */
  playheadHeadRef: RefObject<HTMLDivElement | null>
}

/**
 * Logic-style ruler: lighter top half with bar numbers, darker bottom half with
 * tick lines and the playhead triangle. The strip is a clipped viewport whose
 * inner content (contentRef) is translated to mirror the lane horizontal scroll —
 * transform-based so it never clamps short or drifts out of alignment, and the
 * triangle is clipped to the strip (never drawn over the corner). The playhead
 * line itself lives in the lanes (TimelineArea).
 */
export function TimelineRuler({ onScrubStart, barWidthPx, timelineWidthPx, gutterPx, contentRef, playheadHeadRef }: TimelineRulerProps) {
  const totalBars = useTimeStore((s) => s.totalBars)
  const interval = totalBars <= 16 ? 1 : totalBars <= 64 ? 2 : 4
  const bars = Array.from({ length: totalBars }, (_, i) => i).filter((i) => i % interval === 0)

  return (
    <div className="flex h-10 border-b border-zinc-800 bg-zinc-900 select-none" style={{ paddingRight: gutterPx }}>
      <div style={{ width: TRACK_LABEL_WIDTH }} className="flex-shrink-0 border-r border-zinc-800 bg-zinc-900" />
      <div className="relative flex-1 overflow-hidden cursor-col-resize bg-zinc-900" onPointerDown={onScrubStart}>
        <div ref={contentRef} className="absolute top-0 bottom-0 left-0" style={{ width: timelineWidthPx }}>
          {/* Darker bottom half */}
          <div className="absolute left-0 right-0 bg-zinc-950/60 border-t border-zinc-800/80" style={{ top: '50%', bottom: 0 }} />

          {bars.map((bar) => (
            <div key={bar} className="absolute top-0 bottom-0" style={{ left: bar * barWidthPx }}>
              {/* Top half: bar number */}
              <span className="absolute top-0 left-1 text-[10px] text-zinc-400 leading-none pt-1">
                {bar + 1}
              </span>
              {/* Bottom half: tick line */}
              <div className="absolute bottom-0 w-px bg-zinc-600" style={{ top: '50%' }} />
            </div>
          ))}

          {/* Playhead head: a downward triangle filling the bottom half (RAF-positioned).
              Clipped to the strip, so at beat 0 it sits flush at the lane edge rather
              than spilling over the corner box. */}
          <div
            ref={playheadHeadRef}
            className="absolute pointer-events-none"
            style={{ top: '50%', bottom: 0, left: 0, width: 0 }}
          >
            <div
              className="absolute top-0"
              style={{
                left: -10,
                width: 0,
                height: 0,
                borderLeft: '10px solid transparent',
                borderRight: '10px solid transparent',
                borderTop: '20px solid #ffffff',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
