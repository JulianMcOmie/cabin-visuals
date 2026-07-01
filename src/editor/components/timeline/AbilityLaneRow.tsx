import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { INDENT_PX, LABEL_BASE_PX } from './trackDrop'

interface AbilityLaneRowProps {
  /** The object track this ability lane belongs to. */
  trackId: string
  /** The instrument's ability key — indexes `track.lanes[laneKey]` (wired in the
   *  next commit, when the MIDI editor targets a lane). */
  laneKey: string
  label: string
  color?: string
  /** Indent depth — one level under the owning track. */
  depth: number
  timelineWidthPx: number
  /** Last row overall — suppresses the label divider, like a track. */
  isLast?: boolean
}

/**
 * One ability lane, rendered as an indented, track-like sub-row under its object
 * track (so the object track reads as a taller, grouped block). A parallel structure
 * — NOT a child track. The lane region is inert for now; block drawing + MIDI editing
 * on lanes lands with the editor lane-targeting commit.
 */
export function AbilityLaneRow({ trackId, laneKey, label, color, depth, timelineWidthPx, isLast }: AbilityLaneRowProps) {
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const dot = color ?? '#818cf8'

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
        className="relative flex-shrink-0 bg-black/15"
        style={{ width: timelineWidthPx }}
        data-lane-track={trackId}
        data-lane-key={laneKey}
      />
    </div>
  )
}
