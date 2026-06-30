import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF, RULER_SCRUB_TOP_INSET } from '../../constants'

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
  /** Content rendered in the frozen corner (left of the ruler) — e.g. the Tracks header. */
  corner?: ReactNode
}

/**
 * Logic-style ruler: lighter top half with bar numbers, darker bottom half with
 * tick lines and the playhead triangle. The strip is a clipped viewport whose
 * inner content (contentRef) is translated to mirror the lane horizontal scroll —
 * transform-based so it never clamps short or drifts out of alignment, and the
 * triangle is clipped to the strip (never drawn over the corner). The playhead
 * line itself lives in the lanes (TimelineArea).
 */
export function TimelineRuler({ onScrubStart, barWidthPx, timelineWidthPx, gutterPx, contentRef, playheadHeadRef, corner }: TimelineRulerProps) {
  const totalBars = useProjectStore((s) => s.totalBars)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  // Every bar gets a tick line; only every `interval`th bar is numbered.
  const interval = totalBars <= 16 ? 1 : totalBars <= 64 ? 2 : 4
  const bars = Array.from({ length: totalBars }, (_, i) => i)
  const pixelsPerBeat = beatsPerBar > 0 ? barWidthPx / beatsPerBar : barWidthPx
  // Faint sub-beat ticks (every beat that isn't a bar line).
  const beats = Array.from({ length: totalBars * beatsPerBar }, (_, i) => i).filter((i) => i % beatsPerBar !== 0)

  return (
    <div className="flex h-10 border-b border-zinc-800 bg-zinc-900 select-none" style={{ paddingRight: gutterPx }}>
      <div style={{ width: TRACK_LABEL_WIDTH }} className="flex-shrink-0 flex items-center border-r border-zinc-800 bg-[#202024]">
        {corner}
      </div>
      <div
        className="relative flex-1 overflow-hidden bg-zinc-900"
        onPointerDown={(e) => {
          // Scrub from anywhere on the ruler except the thin top strip, which is
          // reserved for the panel-resize handle so the two can't fire at once.
          const r = e.currentTarget.getBoundingClientRect()
          if (e.clientY - r.top < RULER_SCRUB_TOP_INSET) return
          onScrubStart(e)
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          e.currentTarget.style.cursor = e.clientY - r.top >= RULER_SCRUB_TOP_INSET ? 'ew-resize' : 'default'
        }}
      >
        
        

        <div ref={contentRef} className="absolute top-0 bottom-0" style={{ left: PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}>

          {/* dark divider between bottom and top half of ruler */}
          <div className="absolute left-0 right-0 h-px bg-zinc-700 opacity-40 pointer-events-none" style={{ top: '50%' }} />

          {/* Faint, short beat ticks */}
          {beats.map((beat) => (
            <div key={`b${beat}`} className="absolute bottom-0 w-px bg-zinc-700/60" style={{ left: beat * pixelsPerBeat, top: '72%' }} />
          ))}

          {bars.map((bar) => {
            const numbered = bar % interval === 0
            return (
              <div key={bar} className="absolute top-0 bottom-0" style={{ left: bar * barWidthPx }}>
                {numbered ? (
                  <>
                    {/* Top half: bar number */}
                    <span className="absolute top-0 left-1 text-[10px] text-zinc-400 leading-none pt-1">
                      {bar + 1}
                    </span>
                    {/* Full-height tick line beside the number */}
                    <div className="absolute top-0 bottom-0 w-px bg-zinc-600" />
                  </>
                ) : (
                  /* Blank bar: short grey tick, same as the beat ticks */
                  <div className="absolute bottom-0 w-px bg-zinc-700/60" style={{ top: '72%' }} />
                )}
              </div>
            )
          })}

          {/* Playhead head: a downward triangle filling the bottom half (RAF-positioned).
              Clipped to the strip, so at beat 0 it sits flush at the lane edge rather
              than spilling over the corner box. */}
          <div
            ref={playheadHeadRef}
            className="absolute pointer-events-none"
            // left: 0.5 nudges the apex to sit on the lane playhead line — the line
            // lives in a separate viewport-space overlay, so the ruler triangle
            // otherwise renders ~0.5px to its left.
            style={{ top: '50%', bottom: 0, left: 0.5, width: 0 }}
          >
            <div
              className="absolute top-0"
              style={{
                left: -PLAYHEAD_TRIANGLE_HALF,
                width: 0,
                height: 0,
                borderLeft: `${PLAYHEAD_TRIANGLE_HALF}px solid transparent`,
                borderRight: `${PLAYHEAD_TRIANGLE_HALF}px solid transparent`,
                borderTop: '20px solid #ffffff',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
