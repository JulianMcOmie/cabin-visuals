import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { Ruler } from '../Ruler'
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
  /** Number of bars rendered, including the dimmed area after the project end. */
  displayBars: number
  /** Trailing gutter (px) so the strip ends where the lanes' vertical scrollbar starts. */
  gutterPx: number
  /** Inner content element - translated horizontally to mirror the lane scroll. */
  contentRef: RefObject<HTMLDivElement | null>
  /** Playhead triangle element (the head), positioned by the RAF loop. */
  playheadHeadRef: RefObject<HTMLDivElement | null>
  /** Content rendered in the frozen corner (left of the ruler) - e.g. the Tracks header. */
  corner?: ReactNode
}

/** The main timeline's ruler - a thin adapter over the shared Ruler (also used by
 *  the MIDI editor), fed from the project/UI stores. All ruler UI lives in Ruler. */
export function TimelineRuler({ onScrubStart, onLoopDragStart, onLoopMoveStart, onLoopResizeStart, barWidthPx, timelineWidthPx, displayBars, gutterPx, contentRef, playheadHeadRef, corner }: TimelineRulerProps) {
  const totalBars = useProjectStore((s) => s.totalBars)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const pixelsPerBeat = beatsPerBar > 0 ? barWidthPx / beatsPerBar : barWidthPx

  return (
    <Ruler
      height={32}
      labelWidth={labelWidth}
      corner={corner}
      contentWidthPx={timelineWidthPx}
      gutterPx={gutterPx}
      pixelsPerBeat={pixelsPerBeat}
      beatsPerBar={beatsPerBar}
      totalBars={displayBars}
      dimAfterBars={totalBars}
      // left: 0.5 nudges the apex to sit on the lane playhead line - the line
      // lives in a separate viewport-space overlay, so the ruler triangle
      // otherwise renders ~0.5px to its left.
      playheadNudgePx={0.5}
      contentRef={contentRef}
      playheadHeadRef={playheadHeadRef}
      onScrubStart={onScrubStart}
      onLoopDragStart={onLoopDragStart}
      onLoopMoveStart={onLoopMoveStart}
      onLoopResizeStart={onLoopResizeStart}
    />
  )
}
