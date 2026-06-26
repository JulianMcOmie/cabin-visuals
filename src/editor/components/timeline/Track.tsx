import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTimeStore } from '../../store/TimeStore'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { Block } from './Block'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Track as TrackType } from '../../types'

interface TrackProps {
  track: TrackType
  barWidthPx: number
  timelineWidthPx: number
  selectedBlockIds: Set<string>
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
  onLanePointerDown: (e: ReactPointerEvent, trackId?: string) => void
  /** Last track in the list — suppresses the label-section divider, like the grid. */
  isLast?: boolean
  /** During an Alt copy-drag: vertical shift (px) to open the insertion gap.
   *  `undefined` = no copy-drag in progress (use the normal dnd transform). */
  liftOffset?: number
  /** Begin an Alt copy-drag from this track's label. */
  onCopyDragStart?: (e: ReactPointerEvent, trackId: string) => void
}

export function Track({ track, barWidthPx, timelineWidthPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, liftOffset, onCopyDragStart }: TrackProps) {
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)

  const isSelected = selectedTrackId === track.id

  // Sortable: the label column is the drag handle; reordering is owned by the
  // DndContext in TimelineArea (separate from block/lane pointer gestures).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id })

  // While a copy-drag is in progress, rows shift via liftOffset (with a smooth
  // transition) to open the insertion gap; otherwise the dnd-kit transform applies.
  const inCopyDrag = liftOffset !== undefined

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: inCopyDrag
          ? `translateY(${liftOffset}px) ${CSS.Transform.toString(transform) ?? ''}`.trim()
          : CSS.Transform.toString(transform),
        transition: inCopyDrag ? 'transform 0.15s ease' : transition,
        opacity: isDragging ? 0.6 : 1,
        // During a copy-drag the shifted rows must sit above the empty label box
        // below them (z-10), or the bottom row hides under it as it reflows down.
        zIndex: isDragging ? 20 : inCopyDrag ? 15 : undefined,
        position: 'relative',
        height: rowHeight,
      }}
      className={`flex items-stretch border-b border-zinc-800/60 last:border-b-0 cursor-default transition-colors duration-100 ${
        isSelected ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/40'
      }`}
      onClick={() => setSelectedTrackId(isSelected ? null : track.id)}
    >
      <div
        {...attributes}
        {...listeners}
        onPointerDownCapture={(e) => {
          // Alt+drag on the label runs the custom copy gesture; intercept before
          // dnd-kit's sensor sees it so the two never both start.
          if (e.altKey && e.button === 0) {
            e.stopPropagation()
            e.preventDefault()
            onCopyDragStart?.(e, track.id)
          }
        }}
        style={{ width: TRACK_LABEL_WIDTH }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 px-3 border-r border-r-zinc-800/60 transition-colors duration-100 ${
          isLast ? '' : 'border-b border-b-zinc-900'
        } ${
          isSelected ? 'bg-zinc-700' : 'bg-[#202024]'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate text-white">
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

      {/* Gutter (half a triangle wide) between the label and the lane so the ruler
          playhead triangle has room to show its left half at beat 0. */}
      <div className="flex-shrink-0" style={{ width: PLAYHEAD_TRIANGLE_HALF }} />

      <div
        className="relative flex-shrink-0"
        style={{ width: timelineWidthPx }}
        onPointerDown={(e) => onLanePointerDown(e, track.id)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {track.blocks.map((block) => (
          <Block
            key={block.id}
            block={block}
            trackId={track.id}
            barWidthPx={barWidthPx}
            beatsPerBar={beatsPerBar}
            color={track.color}
            isSelected={selectedBlockIds.has(block.id)}
            onBlockPointerDown={onBlockPointerDown}
          />
        ))}
      </div>
    </div>
  )
}
