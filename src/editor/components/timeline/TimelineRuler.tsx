import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { useTimeStore } from '../../store/TimeStore'
import { LOOP_MOVE_EDGE_INSET, PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import type { LoopResizeEdge } from '../../hooks/useLoopDrag'

interface TimelineRulerProps {
  /** Begin a scrub gesture (provided by TimelineArea via useScrub). */
  onScrubStart: (e: ReactPointerEvent) => void
  /** Begin a loop-region drag (provided by TimelineArea via useLoopDrag). */
  onLoopDragStart: (e: ReactPointerEvent) => void
  /** Move the existing loop region by dragging its safe middle area. */
  onLoopMoveStart: (e: ReactPointerEvent) => void
  /** Resize one boundary of the existing loop region. */
  onLoopResizeStart: (e: ReactPointerEvent, edge: LoopResizeEdge) => void
  /** Width of one bar in pixels (beatsPerBar * pixelsPerBeat). */
  barWidthPx: number
  /** Full timeline width in pixels (totalBars * barWidthPx). */
  timelineWidthPx: number
  /** Trailing gutter (px) so the strip ends where the lanes' vertical scrollbar starts. */
  gutterPx: number
  /** Inner content element - translated horizontally to mirror the lane scroll. */
  contentRef: RefObject<HTMLDivElement | null>
  /** Playhead triangle element (the head), positioned by the RAF loop. */
  playheadHeadRef: RefObject<HTMLDivElement | null>
  /** Content rendered in the frozen corner (left of the ruler) - e.g. the Tracks header. */
  corner?: ReactNode
}

/**
 * Logic-style ruler: lighter top half with bar numbers, darker bottom half with
 * tick lines and the playhead triangle. The strip is a clipped viewport whose
 * inner content (contentRef) is translated to mirror the lane horizontal scroll -
 * transform-based so it never clamps short or drifts out of alignment, and the
 * triangle is clipped to the strip (never drawn over the corner). The playhead
 * line itself lives in the lanes (TimelineArea).
 */
export function TimelineRuler({ onScrubStart, onLoopDragStart, onLoopMoveStart, onLoopResizeStart, barWidthPx, timelineWidthPx, gutterPx, contentRef, playheadHeadRef, corner }: TimelineRulerProps) {
  const totalBars = useProjectStore((s) => s.totalBars)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const loopRegion = useTimeStore((s) => s.loopRegion)
  // Every bar gets a tick line; only every `interval`th bar is numbered.
  const interval = totalBars <= 16 ? 1 : totalBars <= 64 ? 2 : 4
  const bars = Array.from({ length: totalBars }, (_, i) => i)
  const pixelsPerBeat = beatsPerBar > 0 ? barWidthPx / beatsPerBar : barWidthPx
  // Faint sub-beat ticks (every beat that isn't a bar line).
  const beats = Array.from({ length: totalBars * beatsPerBar }, (_, i) => i).filter((i) => i % beatsPerBar !== 0)

  return (
    <div className="flex h-8 border-b border-[var(--border)] bg-[var(--bg-timeline)] select-none" style={{ paddingRight: gutterPx }}>
      <div style={{ width: labelWidth }} className="flex-shrink-0 flex items-center border-r border-[var(--border)] bg-[var(--bg-panel-raised)]">
        {corner}
      </div>
      <div
        data-loop-lane=""
        className="relative flex-1 overflow-hidden"
        onPointerDown={(e) => {
          // Top half = the loop lane (drag defines a region, click clears it);
          // bottom half = the scrub, unchanged.
          const rect = e.currentTarget.getBoundingClientRect()
          if (e.clientY < rect.top + rect.height / 2) onLoopDragStart(e)
          else onScrubStart(e)
        }}
        onPointerMove={(e) => {
          // The loop lane (top half) shows the normal cursor; only the scrub
          // half advertises ew-resize.
          const rect = e.currentTarget.getBoundingClientRect()
          e.currentTarget.style.cursor = e.clientY < rect.top + rect.height / 2 ? 'default' : 'ew-resize'
        }}
      >
        <div ref={contentRef} className="absolute top-0 bottom-0" style={{ left: PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}>

          {/* mid divider between top and bottom half of the ruler */}
          <div className="absolute left-0 right-0 h-px bg-[var(--border-strong)] opacity-40 pointer-events-none" style={{ top: '50%' }} />

          {/* Loop region band - top half only (the loop lane), content space so
              it scrolls with the ruler. Region set = looping on. */}
          {loopRegion && (
            <div
              data-loop-region=""
              data-loop-enabled={loopRegion.enabled ? 'true' : 'false'}
              className="absolute top-0 pointer-events-none"
              style={{
                left: loopRegion.startBeat * pixelsPerBeat,
                width: (loopRegion.endBeat - loopRegion.startBeat) * pixelsPerBeat,
                height: '50%',
                backgroundColor: loopRegion.enabled ? '#4da3d9' : '#52525b',
                borderLeft: `1px solid ${loopRegion.enabled ? '#3982b3' : '#3f3f46'}`,
                borderRight: `1px solid ${loopRegion.enabled ? '#3982b3' : '#3f3f46'}`,
                zIndex: 5,
              }}
            >
              <div
                data-loop-resize-handle="start"
                className="absolute top-0 bottom-0 left-0 cursor-ew-resize pointer-events-auto"
                style={{ width: LOOP_MOVE_EDGE_INSET }}
                onPointerDown={(e) => onLoopResizeStart(e, 'start')}
              />
              <div
                data-loop-move-handle=""
                className="absolute top-0 bottom-0 cursor-grab pointer-events-auto"
                style={{ left: LOOP_MOVE_EDGE_INSET, right: LOOP_MOVE_EDGE_INSET }}
                onPointerDown={onLoopMoveStart}
              />
              <div
                data-loop-resize-handle="end"
                className="absolute top-0 bottom-0 right-0 cursor-ew-resize pointer-events-auto"
                style={{ width: LOOP_MOVE_EDGE_INSET }}
                onPointerDown={(e) => onLoopResizeStart(e, 'end')}
              />
            </div>
          )}

          {/* Faint, short beat ticks */}
          {beats.map((beat) => (
            <div key={`b${beat}`} className="absolute bottom-0 w-px bg-[#2c2c33]" style={{ left: beat * pixelsPerBeat, top: '65%' }} />
          ))}

          {bars.map((bar) => {
            const numbered = bar % interval === 0
            // Numbers sit ON the (solid) loop band - inside an active loop they
            // invert to black to stay readable against the gold.
            const barBeat = bar * beatsPerBar
            // Lines strictly inside the band (its edges already draw borders)
            // get a dark top-half segment drawn OVER the solid band.
            const inLoopBand = !!loopRegion && barBeat > loopRegion.startBeat && barBeat < loopRegion.endBeat
            // Band extent relative to this bar's origin - for the clipped black
            // copy of the number (dynamic per-pixel inversion at the band edges).
            const bandStartRel = loopRegion ? loopRegion.startBeat * pixelsPerBeat - bar * barWidthPx : 0
            const bandEndRel = loopRegion ? loopRegion.endBeat * pixelsPerBeat - bar * barWidthPx : 0
            // Only bars whose number (at x 4px, ~30px wide max) can touch the band.
            const numberTouchesBand = !!loopRegion?.enabled && bandEndRel > 4 && bandStartRel < 34
            return (
              <div key={bar} className="absolute top-0 bottom-0" style={{ left: bar * barWidthPx }}>
                {numbered ? (
                  <>
                    {/* Top half: bar number - 10px/500 mono, one step brighter
                        than faint so it reads at a glance */}
                    <span
                      className="absolute left-1 font-mono text-[10px] font-medium leading-none text-[var(--text-3)]"
                      style={{ top: 3, zIndex: 6 }}
                    >
                      {bar + 1}
                    </span>
                    {/* Black copy of the number, clipped to the band's extent -
                        a number straddling the band edge inverts only the part
                        actually sitting on the gold. */}
                    {numberTouchesBand && (
                      <div
                        className="absolute top-0 overflow-hidden pointer-events-none"
                        style={{ left: Math.max(0, bandStartRel), width: bandEndRel - Math.max(0, bandStartRel), height: '50%', zIndex: 7 }}
                      >
                        <span
                          className="absolute font-mono text-[10px] font-medium leading-none text-black"
                          style={{ top: 3, left: 4 - Math.max(0, bandStartRel) }}
                        >
                          {bar + 1}
                        </span>
                      </div>
                    )}
                    {/* Near-full-height line beside the number - stops a hair
                        below the ruler's top edge (matches other DAWs). */}
                    <div className="absolute bottom-0 w-px bg-[var(--border-strong)]" style={{ top: 2 }} />
                    {/* Its top-half restated above the loop band, darkened to
                        read against the solid fill. */}
                    {inLoopBand && (
                      <div className="absolute w-px" style={{ top: 2, height: 'calc(50% - 2px)', backgroundColor: 'rgba(0, 0, 0, 0.4)', zIndex: 6 }} />
                    )}
                  </>
                ) : (
                  /* Blank bar: short tick, same as the beat ticks */
                  <div className="absolute bottom-0 w-px bg-[#2c2c33]" style={{ top: '65%' }} />
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
            // left: 0.5 nudges the apex to sit on the lane playhead line - the line
            // lives in a separate viewport-space overlay, so the ruler triangle
            // otherwise renders ~0.5px to its left.
            style={{ top: '50%', bottom: 0, left: 0.5, width: 0 }}
          >
            <div
              className="absolute top-0"
              style={{
                left: -5,
                width: 0,
                height: 0,
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '15px solid #ecedef',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
