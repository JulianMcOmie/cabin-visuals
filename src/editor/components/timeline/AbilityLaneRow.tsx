import { useRef } from 'react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { Block } from './Block'
import { useLaneGestures } from './useLaneGestures'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { INDENT_PX, LABEL_BASE_PX } from './trackDrop'

interface AbilityLaneRowProps {
  /** The object track this ability lane belongs to. */
  trackId: string
  /** The instrument's ability key — indexes `track.lanes[laneKey]`. */
  laneKey: string
  label: string
  color?: string
  /** Indent depth — one level under the owning track. */
  depth: number
  barWidthPx: number
  timelineWidthPx: number
  /** Last row overall — suppresses the label divider, like a track. */
  isLast?: boolean
}

/**
 * One ability lane, rendered as an indented, track-like sub-row under its object
 * track (so the object track reads as a taller, grouped block). A parallel structure
 * — NOT a child track. Right-click the lane to draw a block; double-click a block to
 * edit its notes in the MIDI editor (both scoped to this lane via `laneKey`).
 */
export function AbilityLaneRow({ trackId, laneKey, label, color, depth, barWidthPx, timelineWidthPx, isLast }: AbilityLaneRowProps) {
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const blocks = useProjectStore((s) => s.tracks[trackId]?.lanes?.[laneKey])
  const dot = color ?? '#818cf8'

  const laneRef = useRef<HTMLDivElement>(null)
  const { onLanePointerDown, onBlockPointerDown } = useLaneGestures(trackId, laneKey, laneRef)

  return (
    <div
      className="flex items-stretch border-b border-zinc-800/60 last:border-b-0"
      style={{ height: rowHeight, position: 'relative' }}
    >
      <div
        style={{ width: labelWidth, paddingLeft: LABEL_BASE_PX + depth * INDENT_PX }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-1.5 pr-3 border-r border-r-zinc-800/60 bg-[#1b1b1f] ${
          isLast ? '' : 'border-b border-b-zinc-900'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
        <span className="text-[11px] font-medium truncate text-zinc-400">{label}</span>
      </div>

      {/* Gutter, matching the track row so lanes line up under it. */}
      <div className="flex-shrink-0" style={{ width: PLAYHEAD_TRIANGLE_HALF }} />

      <div
        ref={laneRef}
        className="relative flex-shrink-0 bg-black/15"
        style={{ width: timelineWidthPx }}
        onPointerDown={onLanePointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {(blocks ?? []).map((block) => (
          <Block
            key={block.id}
            block={block}
            trackId={trackId}
            laneKey={laneKey}
            barWidthPx={barWidthPx}
            beatsPerBar={beatsPerBar}
            color={dot}
            isSelected={selectedBlockIds.has(block.id)}
            onBlockPointerDown={onBlockPointerDown}
          />
        ))}
      </div>
    </div>
  )
}
