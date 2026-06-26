import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTimeStore } from '../store/TimeStore'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { Block } from './Block'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF } from '../constants'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Track as TrackType } from '../types'

interface TrackProps {
  track: TrackType
  barWidthPx: number
  timelineWidthPx: number
  selectedBlockIds: Set<string>
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
  onLanePointerDown: (e: ReactPointerEvent, trackId?: string) => void
  /** Last track in the list — suppresses the label-section divider, like the grid. */
  isLast?: boolean
  /** An Alt (copy) drag is in flight — keep this row visually static. */
  copyDrag?: boolean
}

export function Track({ track, barWidthPx, timelineWidthPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, copyDrag }: TrackProps) {
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)

  const isSelected = selectedTrackId === track.id

  // Sortable: the label column is the drag handle; reordering is owned by the
  // DndContext in TimelineArea (separate from block/lane pointer gestures).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        // During an Alt-copy drag the original stays exactly where it is; a clone
        // is dropped at the release point instead of reordering.
        transform: isDragging && copyDrag ? undefined : CSS.Transform.toString(transform),
        transition,
        opacity: isDragging && !copyDrag ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
        position: 'relative',
        cursor: isDragging && copyDrag ? 'copy' : undefined,
      }}
      className={`flex items-stretch h-12 border-b border-zinc-800/60 last:border-b-0 cursor-default transition-colors duration-100 ${
        isSelected ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/40'
      }`}
      onClick={() => setSelectedTrackId(isSelected ? null : track.id)}
    >
      <div
        {...attributes}
        {...listeners}
        style={{ width: TRACK_LABEL_WIDTH }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 px-3 border-r border-r-zinc-800/60 cursor-grab active:cursor-grabbing transition-colors duration-100 ${
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
