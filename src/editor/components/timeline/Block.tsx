import { useUIStore } from '../../store/UIStore'
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
      className="absolute top-1 bottom-1 rounded overflow-hidden"
      style={{
        left: `${left}px`,
        width: `${Math.max(width, 4)}px`,
        backgroundColor: color + '28',
        borderTop: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}66`,
        borderRight: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}66`,
        borderBottom: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}66`,
        borderLeft: `2px solid ${color}`,
        boxShadow: isSelected
          ? `0 0 0 1px ${color}, 0 0 8px ${color}aa`
          : isEditing ? `0 0 6px ${color}88` : undefined,
      }}
      onPointerDown={(e) => onBlockPointerDown(e, trackId, block.id)}
      onPointerMove={(e) => {
        // Measure relative to the block (currentTarget), not offsetX — offsetX is
        // relative to whatever child is under the pointer (e.g. a note sliver).
        const rect = e.currentTarget.getBoundingClientRect()
        const w = rect.width
        const edge = Math.min(8, w / 4)
        const localX = e.clientX - rect.left
        e.currentTarget.style.cursor = localX < edge || localX > w - edge ? 'ew-resize' : 'default'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditingBlock({ trackId, blockId: block.id })
      }}
    >
      <NotePreview notes={block.notes} totalBeats={totalBeatsInBlock} color={color} />
    </div>
  )
}

/** Miniature of the block's notes: x/width from time, y from pitch — normalized to
 *  the block's own pitch range (at least an octave, so near-monotone lines stay
 *  calm), dashes long notes read as dashes and hits as ticks. */
function NotePreview({ notes, totalBeats, color }: { notes: BlockType['notes']; totalBeats: number; color: string }) {
  if (notes.length === 0 || totalBeats <= 0) return null
  let minPitch = Infinity
  let maxPitch = -Infinity
  for (const n of notes) {
    if (n.pitch < minPitch) minPitch = n.pitch
    if (n.pitch > maxPitch) maxPitch = n.pitch
  }
  const span = Math.max(12, maxPitch - minPitch)
  const lo = (minPitch + maxPitch) / 2 - span / 2
  return (
    <>
      {notes.map((note) => {
        const leftPct = (note.startBeat / totalBeats) * 100
        const widthPct = (note.durationBeats / totalBeats) * 100
        // Top pitch at the top; 8%–88% band keeps dashes inside the rounded border.
        const topPct = 8 + (1 - (note.pitch - lo) / span) * 80
        return (
          <div
            key={note.id}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${leftPct}%`,
              width: `max(${widthPct}%, 3px)`,
              top: `${topPct}%`,
              height: 2,
              backgroundColor: color + 'cc',
            }}
          />
        )
      })}
    </>
  )
}
