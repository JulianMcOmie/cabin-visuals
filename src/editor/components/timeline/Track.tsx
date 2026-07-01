import { ChevronDown, ChevronRight } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { Block } from './Block'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { INDENT_PX, LABEL_BASE_PX } from './trackDrop'
import { modifierColor } from '../../utils/modifierColors'
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
  /** Nesting depth (0 = root) — indents the label by INDENT_PX per level. */
  depth?: number
  /** During an Alt copy-drag / library drag: vertical shift (px) to open the gap. */
  liftOffset?: number
  /** This row is the source of an in-progress nest-drag (dim it). */
  dimmed?: boolean
  /** This row is the live nest-into target (highlight it). */
  dropInto?: boolean
  /** Begin an Alt copy-drag from this track's label. */
  onCopyDragStart?: (e: ReactPointerEvent, trackId: string) => void
  /** Begin a drag-to-nest from this track's label. */
  onNestDragStart?: (e: ReactPointerEvent, trackId: string) => void
}

export function Track({ track, barWidthPx, timelineWidthPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, depth = 0, liftOffset, dimmed, dropInto, onCopyDragStart, onNestDragStart }: TrackProps) {
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const setSelectedTrackId = useUIStore((s) => s.setSelectedTrackId)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const setTrackCollapsed = useUIStore((s) => s.setTrackCollapsed)
  const isCollapsed = useUIStore((s) => s.collapsedTrackIds.has(track.id))
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)

  const isSelected = selectedTrackId === track.id
  const hasChildren = track.childIds.length > 0
  // A no-instrument track whose type is a modifier is an event-modifier (control) row.
  const modColor = modifierColor(track)
  const isModifier = modColor != null
  const blockColor = modColor ?? track.color

  // While a copy/library drag is in progress, rows shift via liftOffset (with a
  // smooth transition) to open the insertion gap.
  const inCopyDrag = liftOffset !== undefined

  return (
    <div
      style={{
        transform: inCopyDrag ? `translateY(${liftOffset}px)` : undefined,
        transition: inCopyDrag ? 'transform 0.15s ease' : undefined,
        opacity: dimmed ? 0.4 : 1,
        // During a copy-drag the shifted rows must sit above the empty label box
        // below them (z-10), or the bottom row hides under it as it reflows down.
        zIndex: inCopyDrag ? 15 : undefined,
        position: 'relative',
        height: rowHeight,
      }}
      className={`flex items-stretch border-b border-zinc-800/60 last:border-b-0 cursor-default transition-colors duration-100 ${
        isSelected ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/40'
      }`}
      onClick={() => setSelectedTrackId(isSelected ? null : track.id)}
    >
      <div
        onPointerDownCapture={(e) => {
          if (e.button !== 0) return
          // The M/S buttons are not drag handles.
          if ((e.target as HTMLElement).closest('button')) return
          // Alt+drag duplicates; a plain drag re-nests. Neither preventDefault on the
          // plain path, so a click without movement still selects the row.
          if (e.altKey) {
            e.stopPropagation()
            e.preventDefault()
            onCopyDragStart?.(e, track.id)
          } else {
            onNestDragStart?.(e, track.id)
          }
        }}
        style={{ width: labelWidth, paddingLeft: LABEL_BASE_PX + depth * INDENT_PX }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 pr-3 border-r border-r-zinc-800/60 transition-colors duration-100 ${
          isLast ? '' : 'border-b border-b-zinc-900'
        } ${
          dropInto ? 'bg-indigo-600/40 ring-1 ring-inset ring-indigo-400' : isSelected ? 'bg-zinc-700' : 'bg-[#202024]'
        }`}
      >
        {/* Name + its collapse toggle, grouped so the chevron hugs the name text
            (the empty space sits to their right, not between them). */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {isModifier && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: blockColor }} />
          )}
          <span className={`text-xs font-medium truncate ${isModifier ? 'text-zinc-300' : 'text-white'}`}>{track.name}</span>
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); setTrackCollapsed(track.id, !isCollapsed) }}
              className="flex-shrink-0 flex items-center justify-center text-zinc-500 hover:text-zinc-200"
              aria-label={isCollapsed ? 'Expand track' : 'Collapse track'}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
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
            color={blockColor}
            isSelected={selectedBlockIds.has(block.id)}
            onBlockPointerDown={onBlockPointerDown}
          />
        ))}
      </div>
    </div>
  )
}
