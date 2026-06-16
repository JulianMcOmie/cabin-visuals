import { useUIStore } from '../store/UIStore'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Block as BlockType } from '../types'

interface BlockProps {
  block: BlockType
  trackId: string
  totalBars: number
  beatsPerBar: number
  color: string
  isSelected: boolean
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
}

export function Block({ block, trackId, totalBars, beatsPerBar, color, isSelected, onBlockPointerDown }: BlockProps) {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const isEditing = editingBlock?.blockId === block.id

  const left = (block.startBar / totalBars) * 100
  const width = (block.durationBars / totalBars) * 100
  const totalBeatsInBlock = block.durationBars * beatsPerBar

  return (
    <div
      data-block-id={block.id}
      title="Double-click to edit notes"
      className="absolute top-1 bottom-1 rounded overflow-hidden cursor-grab"
      style={{
        left: `${left}%`,
        width: `${Math.max(width, 0.5)}%`,
        backgroundColor: color + '28',
        border: isEditing || isSelected ? `1px solid ${color}` : `1px solid ${color}66`,
        borderLeft: `2px solid ${color}`,
        boxShadow: isSelected
          ? `0 0 0 1px ${color}, 0 0 8px ${color}aa`
          : isEditing ? `0 0 6px ${color}88` : undefined,
      }}
      onPointerDown={(e) => onBlockPointerDown(e, trackId, block.id)}
      onPointerMove={(e) => {
        const el = e.currentTarget
        const w = el.offsetWidth
        const edge = Math.min(8, w / 4)
        const localX = e.nativeEvent.offsetX
        el.style.cursor = localX < edge || localX > w - edge ? 'ew-resize' : 'grab'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditingBlock({ trackId, blockId: block.id })
      }}
    >
      {block.notes.map((note) => {
        const notePct = totalBeatsInBlock > 0
          ? (note.startBeat / totalBeatsInBlock) * 100
          : 0
        return (
          <div
            key={note.id}
            className="absolute top-1 bottom-1 w-0.5 rounded-full"
            style={{ left: `${notePct}%`, backgroundColor: color + 'cc' }}
          />
        )
      })}
    </div>
  )
}
