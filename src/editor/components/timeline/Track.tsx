import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { Block } from './Block'
import { AudioBlock } from './AudioBlock'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { INDENT_PX, LABEL_BASE_PX } from './trackDrop'
import { modifierColor } from '../../utils/modifierColors'
import { selectTrack, shouldSuppressTrackSelect } from '../../utils/selection'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Track as TrackType } from '../../types'

// Logic-style M/S painting: pointer-down on a button starts a stroke, and every
// button of the SAME kind the pointer crosses while held gets the first
// toggle's resulting state (painted, not flipped — sweeps stay predictable).
// Module-level on purpose: one stroke spans many Track instances.
let msPaint: { kind: 'mute' | 'solo'; value: boolean } | null = null

function startMsPaint(kind: 'mute' | 'solo', value: boolean) {
  msPaint = { kind, value }
  window.addEventListener('pointerup', () => { msPaint = null }, { once: true })
}

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
  /** Right-click on the label — opens the add-ability / add-automation menu. */
  onLabelContextMenu?: (e: ReactMouseEvent, trackId: string) => void
}

export function Track({ track, barWidthPx, timelineWidthPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, depth = 0, liftOffset, dimmed, dropInto, onCopyDragStart, onNestDragStart, onLabelContextMenu }: TrackProps) {
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const setTrackCollapsed = useUIStore((s) => s.setTrackCollapsed)
  const isCollapsed = useUIStore((s) => s.collapsedTrackIds.has(track.id))
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)
  const renameTrack = useProjectStore((s) => s.renameTrack)

  // Double-click the name → inline rename. Enter/blur commits, Esc cancels.
  const [renaming, setRenaming] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming])

  const isSelected = selectedTrackId === track.id
  const hasChildren = track.childIds.length > 0
  // A no-instrument track whose type is a modifier is an event-modifier (control) row.
  const modColor = modifierColor(track)
  const isModifier = modColor != null
  const blockColor = modColor ?? track.color
  // Automation, ability, and dimension tracks are attached sub-rows of their object.
  const isAutomation = track.type === 'automation' || track.type === 'ability' || track.type === 'dimension'

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
    >
      <div
        onClick={() => {
          // Track selection is the LABEL's job — the lane (timeline grid) never
          // selects or deselects a track. A drag that started here (nest/copy)
          // must not hijack the selection when its trailing click lands.
          if (shouldSuppressTrackSelect()) return
          // No toggle: clicking the selected track keeps it selected. Foreign
          // selected blocks are pruned; this track's stay (utils/selection).
          selectTrack(track.id)
        }}
        onPointerDownCapture={(e) => {
          if (e.button !== 0) return
          // The M/S buttons are not drag handles; neither is the rename input.
          if ((e.target as HTMLElement).closest('button, input')) return
          // The audio track is pinned at the top — not draggable, not duplicable.
          if (track.type === 'audio') return
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
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onLabelContextMenu?.(e, track.id) }}
        style={{ width: labelWidth, paddingLeft: LABEL_BASE_PX + depth * INDENT_PX }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 pr-3 border-r border-r-zinc-800/60 transition-colors duration-100 ${
          isLast ? '' : 'border-b border-b-zinc-900'
        } ${
          dropInto ? 'bg-indigo-600/40 ring-1 ring-inset ring-indigo-400' : isSelected ? 'bg-zinc-700' : isAutomation ? 'bg-[#1d1d21]' : 'bg-[#202024]'
        }`}
      >
        {/* Name + its collapse toggle, grouped so the chevron hugs the name text
            (the empty space sits to their right, not between them). */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {isModifier && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: blockColor }} />
          )}
          {renaming ? (
            <input
              ref={renameRef}
              defaultValue={track.name}
              onBlur={(e) => { renameTrack(track.id, e.currentTarget.value); setRenaming(false) }}
              onKeyDown={(e) => {
                e.stopPropagation() // keep Delete/Esc/space from the timeline + transport keys
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') { e.currentTarget.value = track.name; e.currentTarget.blur() }
              }}
              className="w-full min-w-0 text-xs font-medium text-white bg-zinc-900 border border-zinc-600 rounded px-1 py-0 outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setRenaming(true)}
              className={`text-xs font-medium truncate ${isModifier ? 'text-zinc-300' : 'text-white'}`}
            >
              {track.name}
            </span>
          )}
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
            onPointerDown={(e) => {
              if (e.button !== 0) return
              startMsPaint('mute', !track.muted)
              toggleMute(track.id)
            }}
            onPointerEnter={() => {
              if (msPaint?.kind === 'mute' && track.muted !== msPaint.value) toggleMute(track.id)
            }}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              track.muted
                ? 'bg-amber-500 text-black'
                : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            M
          </button>
          <button
            onPointerDown={(e) => {
              if (e.button !== 0) return
              startMsPaint('solo', !track.solo)
              toggleSolo(track.id)
            }}
            onPointerEnter={() => {
              if (msPaint?.kind === 'solo' && track.solo !== msPaint.value) toggleSolo(track.id)
            }}
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
        className={`relative flex-shrink-0 ${isAutomation ? 'bg-black/10' : ''}`}
        style={{ width: timelineWidthPx }}
        // Audio lanes have no MIDI gestures (no right-click block drawing / marquee),
        // but clicking their empty space still deselects blocks, like any lane.
        onPointerDown={track.type === 'audio'
          ? (e) => { if (e.button === 0 && !e.shiftKey) useUIStore.getState().setSelectedBlockIds(new Set()) }
          : (e) => onLanePointerDown(e, track.id)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {track.type === 'audio'
          ? (track.audioBlocks ?? []).map((block) => (
              <AudioBlock
                key={block.id}
                block={block}
                trackId={track.id}
                barWidthPx={barWidthPx}
                beatsPerBar={beatsPerBar}
                color={blockColor}
              />
            ))
          : track.blocks.map((block) => (
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
