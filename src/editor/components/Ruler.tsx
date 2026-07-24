import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useTimeStore } from '../store/TimeStore'
import {
  LOOP_MOVE_EDGE_INSET,
  LOOP_REGION_DISABLED_COLOR,
  LOOP_REGION_ENABLED_COLOR,
  PLAYHEAD_TRIANGLE_HALF,
} from '../constants'
import { computeRulerGrid } from './rulerGrid'
import type { LoopResizeEdge } from '../hooks/useLoopDrag'

interface RulerProps {
  /** Strip height (px) - the tracks ruler is shorter than the MIDI editor's. */
  height: number
  /** Width of the frozen corner box (the label column it sits above). */
  labelWidth: number
  /** Content rendered in the frozen corner (left of the strip). */
  corner?: ReactNode
  /** Inner content width (px) - the scrollable timeline extent. */
  contentWidthPx: number
  /** Trailing gutter (px) so the strip ends where a vertical scrollbar starts. */
  gutterPx?: number
  pixelsPerBeat: number
  beatsPerBar: number
  /** Bars drawn (numbered per the thinning interval). */
  totalBars: number
  /** Optional project boundary. Ruler content after this bar remains visible,
   *  but is desaturated and darkened to mark it outside the active range. */
  dimAfterBars?: number
  /** Beat-tick extent; defaults to totalBars * beatsPerBar (used when the
   *  timeline ends mid-bar, so ticks don't overshoot the content). */
  totalBeats?: number
  /** Sub-pixel nudge for the playhead triangle (aligns it with a lane line that
   *  renders in a separate viewport-space overlay). */
  playheadNudgePx?: number
  /** Inner content element - translated horizontally to mirror the lane/grid scroll. */
  contentRef: RefObject<HTMLDivElement | null>
  /** Playhead triangle element (the head), positioned by the caller's RAF loop. */
  playheadHeadRef: RefObject<HTMLDivElement | null>
  /** Begin a scrub gesture (bottom half of the strip). */
  onScrubStart: (e: ReactPointerEvent) => void
  /** Begin a loop-region drag (top half of the strip). */
  onLoopDragStart: (e: ReactPointerEvent) => void
  /** Move the existing loop region by dragging its safe middle area. */
  onLoopMoveStart: (e: ReactPointerEvent) => void
  /** Resize one boundary of the existing loop region. */
  onLoopResizeStart: (e: ReactPointerEvent, edge: LoopResizeEdge) => void
  /** Extra content-space layers (e.g. the MIDI editor's block clip header),
   *  rendered between the bar lines and the playhead triangle. */
  children?: ReactNode
}

/**
 * The shared Logic-style ruler: lighter top half with the loop lane + bar numbers,
 * darker bottom half with tick lines and the playhead triangle. Used by both the
 * main timeline and the MIDI editor so every styling change lands in ONE place.
 * The strip is a clipped viewport whose inner content (contentRef) is translated
 * to mirror the caller's horizontal scroll - transform-based so it never clamps
 * short or drifts out of alignment. The playhead line itself lives in the caller's
 * lanes/grid; only the triangle head renders here.
 */
export function Ruler({
  height,
  labelWidth,
  corner,
  contentWidthPx,
  gutterPx = 0,
  pixelsPerBeat,
  beatsPerBar,
  totalBars,
  dimAfterBars,
  totalBeats,
  playheadNudgePx = 0,
  contentRef,
  playheadHeadRef,
  onScrubStart,
  onLoopDragStart,
  onLoopMoveStart,
  onLoopResizeStart,
  children,
}: RulerProps) {
  const loopRegion = useTimeStore((s) => s.loopRegion)
  const barWidthPx = beatsPerBar * pixelsPerBeat
  const beatExtent = totalBeats ?? totalBars * beatsPerBar

  // Zoom-adaptive grid (Logic-style), shared with the playhead snap - see
  // computeRulerGrid. Zooming out thins the numbered lines 1 → 2 → 4 → 8...
  // bars; each major span carries 4 minor ticks; deep zoom adds 16th sub-ticks.
  const { majorBars, minorBeats, subBeats } = computeRulerGrid(pixelsPerBeat, beatsPerBar, totalBars)
  const bars = Array.from({ length: Math.ceil(totalBars / majorBars) }, (_, i) => i * majorBars)
  // Minor ticks: every minor position that isn't a major line (k % 4 skips them
  // exactly - floats included - since majors sit every 4 minors).
  const minors = Array.from({ length: Math.ceil(beatExtent / minorBeats) }, (_, k) => k)
    .filter((k) => (majorBars === 1 ? k % beatsPerBar !== 0 : k % 4 !== 0))
    .map((k) => k * minorBeats)
  const subs = subBeats != null
    ? Array.from({ length: Math.ceil(beatExtent / subBeats) }, (_, k) => k).filter((k) => k % 4 !== 0).map((k) => k * subBeats)
    : []

  return (
    <div className="flex border-b border-[var(--border)] bg-[var(--bg-timeline)] select-none flex-shrink-0" style={{ height, paddingRight: gutterPx }}>
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
        <div ref={contentRef} className="absolute top-0 bottom-0" style={{ left: PLAYHEAD_TRIANGLE_HALF, width: contentWidthPx, willChange: 'transform' }}>

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
                backgroundColor: loopRegion.enabled ? LOOP_REGION_ENABLED_COLOR : LOOP_REGION_DISABLED_COLOR,
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

          {/* Faint 16th sub-ticks (deep zoom only) - shortest and dimmest. */}
          {subs.map((beat) => (
            <div key={`s${beat}`} className="absolute bottom-0 w-px bg-[#222228]" style={{ left: beat * pixelsPerBeat, top: '78%' }} />
          ))}

          {/* Short minor ticks - 4 per major span. */}
          {minors.map((beat) => (
            <div key={`b${beat}`} className="absolute bottom-0 w-px bg-[#2c2c33]" style={{ left: beat * pixelsPerBeat, top: '65%' }} />
          ))}

          {bars.map((bar) => {
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
                        actually sitting on the highlight. */}
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
              </div>
            )
          })}

          {/* Caller-specific content-space layers (e.g. the MIDI block header) -
              below the playhead triangle. */}
          {children}

          {dimAfterBars != null && dimAfterBars < totalBars && (
            <div
              data-outside-project-ruler=""
              className="pointer-events-none absolute top-0 bottom-0"
              style={{
                left: dimAfterBars * barWidthPx,
                right: 0,
                zIndex: 20,
                backgroundColor: 'rgba(8, 8, 11, 0.46)',
                backdropFilter: 'grayscale(0.85) saturate(0.3) brightness(0.68)',
              }}
            />
          )}

          {/* Playhead head: a marker confined to the ruler's bottom half (below the
              loop band) - a rectangular top tapering to a rounded point, one
              continuous rounded shape (positioned by the caller's RAF loop). Clipped
              to the strip, so at beat 0 it sits flush at the lane edge rather than
              spilling over the corner box. */}
          <div
            ref={playheadHeadRef}
            className="absolute pointer-events-none"
            style={{ top: '50%', bottom: 0, left: playheadNudgePx, width: 0, zIndex: 21 }}
          >
            <svg
              className="absolute top-0"
              width={PLAYHEAD_TRIANGLE_HALF * 2}
              height={height / 2}
              viewBox={`0 0 ${PLAYHEAD_TRIANGLE_HALF * 2} ${height / 2}`}
              style={{ left: -PLAYHEAD_TRIANGLE_HALF }}
              fill="none"
            >
              {(() => {
                const w = PLAYHEAD_TRIANGLE_HALF * 2
                const h = height / 2
                const p = 1.25 // inset so the rounded stroke stays inside the viewBox
                const midY = h / 2
                const d = `M ${p},${p} L ${w - p},${p} L ${w - p},${midY} L ${w / 2},${h - p} L ${p},${midY} Z`
                return (
                  <path
                    d={d}
                    fill="#ecedef"
                    stroke="#ecedef"
                    strokeWidth={2.5}
                    strokeLinejoin="round"
                  />
                )
              })()}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
