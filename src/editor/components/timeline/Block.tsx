import { useUIStore } from '../../store/UIStore'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { LOOP_CURSOR } from '../../utils/dragCursor'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Block as BlockType } from '../../types'

interface BlockProps {
  block: BlockType
  trackId: string
  barWidthPx: number
  beatsPerBar: number
  color: string
  isSelected: boolean
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
}

export function Block({ block, trackId, barWidthPx, beatsPerBar, color, isSelected, onBlockPointerDown }: BlockProps) {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const isEditing = editingBlock?.blockId === block.id

  const left = block.startBar * barWidthPx
  const width = block.durationBars * barWidthPx
  const totalBeatsInBlock = block.durationBars * beatsPerBar

  return (
    <div
      data-block-id={block.id}
      title="Double-click to edit notes"
      className="absolute top-1 bottom-1 rounded-[3px] overflow-hidden"
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 4)}px`,
        backgroundColor: color + '24',
        borderTop: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}55`,
        borderRight: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}55`,
        borderBottom: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}55`,
        borderLeft: `2px solid ${color}`,
        boxShadow: isSelected || isEditing ? `0 0 0 1px ${color}` : undefined,
      }}
      onPointerDown={(e) => onBlockPointerDown(e, trackId, block.id)}
      onPointerMove={(e) => {
        // Measure relative to the block (currentTarget), not offsetX - offsetX is
        // relative to whatever child is under the pointer (e.g. a note sliver).
        const rect = e.currentTarget.getBoundingClientRect()
        const w = rect.width
        const edge = Math.min(8, w / 4)
        const localX = e.clientX - rect.left
        const onRightEdge = localX > w - edge
        const onLeftEdge = localX < edge
        // The top half of the right edge arms looping (drag past the pattern to
        // repeat) - dedicated loop icon cursor. The bottom half and
        // the left edge are plain resizes; the body is a move (default).
        const topHalf = e.clientY < rect.top + rect.height / 2
        const onLoopHandle = onRightEdge && topHalf
        e.currentTarget.style.cursor =
          onLoopHandle ? LOOP_CURSOR : onRightEdge || onLeftEdge ? 'ew-resize' : 'default'
        // Tooltip tracks the zone under the pointer (updated live so it swaps as
        // you cross the halves): the right edge splits top = loop, bottom =
        // resize; the left edge resizes; the body opens the editor.
        e.currentTarget.title = onLoopHandle
          ? 'Drag to loop'
          : onRightEdge
            ? 'Drag to resize'
          : onLeftEdge
            ? 'Drag to resize'
            : 'Double-click to edit notes'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditingBlock({ trackId, blockId: block.id })
      }}
    >
      <NotePreview
        notes={block.notes}
        totalBeats={totalBeatsInBlock}
        loopBeats={block.loop ? loopLengthBeats(block, beatsPerBar) : null}
        color={color}
      />
    </div>
  )
}

// Preview divs per looped block stay bounded; a tiny pattern in a huge block
// caps out instead of flooding the DOM.
const PREVIEW_NOTE_CAP = 512

/** Miniature of the block's notes: x/width from time, y from pitch - normalized to
 *  the block's own pitch range (at least an octave, so near-monotone lines stay
 *  calm), dashes long notes read as dashes and hits as ticks. A looping block
 *  tiles the pattern (repeats dimmed) with a dashed line at each loop boundary. */
function NotePreview({ notes, totalBeats, loopBeats, color }: { notes: BlockType['notes']; totalBeats: number; loopBeats: number | null; color: string }) {
  if (totalBeats <= 0) return null
  // Loop boundaries describe the block's repeated pattern even when that
  // pattern is currently empty, so note previews and divisions stay separate.
  let minPitch = notes[0]?.pitch ?? 60
  let maxPitch = minPitch
  for (const n of notes) {
    if (n.pitch < minPitch) minPitch = n.pitch
    if (n.pitch > maxPitch) maxPitch = n.pitch
  }
  const span = Math.max(12, maxPitch - minPitch)
  const lo = (minPitch + maxPitch) / 2 - span / 2

  const looping = loopBeats != null && loopBeats > 0 && loopBeats < totalBeats
  const occurrences = looping
    ? tileLoopNotes(notes, loopBeats, totalBeats, PREVIEW_NOTE_CAP)
    : notes.map((note) => ({ note, startBeat: note.startBeat, durationBeats: note.durationBeats, repeat: 0 }))
  const boundaries: number[] = []
  if (looping) {
    for (let b = loopBeats; b < totalBeats; b += loopBeats) boundaries.push(b)
  }

  return (
    <>
      {occurrences.map(({ note, startBeat, durationBeats, repeat }) => {
        const leftPct = (startBeat / totalBeats) * 100
        const widthPct = (durationBeats / totalBeats) * 100
        // Top pitch at the top; 8%–88% band keeps dashes inside the rounded border.
        const topPct = 8 + (1 - (note.pitch - lo) / span) * 80
        return (
          <div
            key={`${note.id}:${repeat}`}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${leftPct}%`,
              width: `max(${widthPct}%, 3px)`,
              top: `${topPct}%`,
              height: 2,
              backgroundColor: color + 'cc',
              opacity: repeat > 0 ? 0.55 : 1,
            }}
          />
        )
      })}
      {boundaries.map((b) => (
        <div
          key={`loop:${b}`}
          className="absolute pointer-events-none"
          style={{
            left: `${(b / totalBeats) * 100}%`,
            top: '8%',
            bottom: '8%',
            width: 0,
            borderLeft: `1px dashed ${color}88`,
          }}
        />
      ))}
    </>
  )
}
