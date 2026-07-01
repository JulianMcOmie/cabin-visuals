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
  /** During an Alt copy-drag: vertical shift (px) so the lane reflows with its track. */
  liftOffset?: number
}

/**
 * One ability lane, rendered as an indented sub-row that looks and behaves like a child
 * track (sticky label + mute/solo), so it reads uniformly with automation tracks. A
 * PARALLEL structure though — NOT a child track. Right-click the lane to draw a block;
 * double-click a block to edit its notes (scoped to this lane via `laneKey`).
 */
export function AbilityLaneRow({ trackId, laneKey, label, color, depth, barWidthPx, timelineWidthPx, isLast, liftOffset }: AbilityLaneRowProps) {
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const blocks = useProjectStore((s) => s.tracks[trackId]?.lanes?.[laneKey])
  const meta = useProjectStore((s) => s.tracks[trackId]?.laneMeta?.[laneKey])
  const toggleLaneMuted = useProjectStore((s) => s.toggleLaneMuted)
  const toggleLaneSolo = useProjectStore((s) => s.toggleLaneSolo)
  const muted = meta?.muted ?? false
  const solo = meta?.solo ?? false
  const dot = color ?? '#818cf8'

  const laneRef = useRef<HTMLDivElement>(null)
  const { onLanePointerDown, onBlockPointerDown } = useLaneGestures(trackId, laneKey, laneRef)
  const inCopyDrag = liftOffset !== undefined

  return (
    <div
      className="flex items-stretch border-b border-zinc-800/60 last:border-b-0"
      style={{
        height: rowHeight,
        position: 'relative',
        transform: inCopyDrag ? `translateY(${liftOffset}px)` : undefined,
        transition: inCopyDrag ? 'transform 0.15s ease' : undefined,
        zIndex: inCopyDrag ? 15 : undefined,
      }}
    >
      <div
        style={{ width: labelWidth, paddingLeft: LABEL_BASE_PX + depth * INDENT_PX }}
        className={`sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 pr-3 border-r border-r-zinc-800/60 bg-[#1d1d21] ${
          isLast ? '' : 'border-b border-b-zinc-900'
        }`}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
          <span className={`text-xs font-medium truncate ${muted ? 'text-zinc-500' : 'text-zinc-200'}`}>{label}</span>
        </div>

        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => toggleLaneMuted(trackId, laneKey)}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              muted ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            M
          </button>
          <button
            onClick={() => toggleLaneSolo(trackId, laneKey)}
            className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
              solo ? 'bg-green-500 text-black' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            S
          </button>
        </div>
      </div>

      {/* Gutter, matching the track row so lanes line up under it. */}
      <div className="flex-shrink-0" style={{ width: PLAYHEAD_TRIANGLE_HALF }} />

      <div
        ref={laneRef}
        className="relative flex-shrink-0 bg-black/10"
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
