import type { Block as BlockType } from '../types'

interface BlockProps {
  block: BlockType
  totalBars: number
  beatsPerBar: number
  color: string
}

export function Block({ block, totalBars, beatsPerBar, color }: BlockProps) {
  const left = (block.startBar / totalBars) * 100
  const width = (block.durationBars / totalBars) * 100
  const totalBeatsInBlock = block.durationBars * beatsPerBar

  return (
    <div
      className="absolute top-1 bottom-1 rounded overflow-hidden"
      style={{
        left: `${left}%`,
        width: `${Math.max(width, 0.5)}%`,
        backgroundColor: color + '28',
        border: `1px solid ${color}66`,
        borderLeft: `2px solid ${color}`,
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
