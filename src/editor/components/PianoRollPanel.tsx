'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'

export function PianoRollPanel() {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const tracks = useProjectStore((s) => s.tracks)

  const track = editingBlock ? tracks[editingBlock.trackId] : undefined
  const block = track?.blocks.find((b) => b.id === editingBlock?.blockId)

  // Auto-close if the block disappeared (track/block deleted)
  useEffect(() => {
    if (editingBlock && !block) setEditingBlock(null)
  }, [editingBlock, block, setEditingBlock])

  // Esc closes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingBlock(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setEditingBlock])

  if (!track || !block) return null

  return (
    <div className="flex flex-col h-full border-t border-zinc-800">
      <div className="flex items-center gap-2 h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <span className="text-xs font-medium" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="text-xs text-zinc-600">
          Bar {block.startBar + 1} · {block.durationBars} bar{block.durationBars !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setEditingBlock(null)}
          title="Close (Esc)"
          className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-zinc-600">Piano roll coming in the next commit</p>
      </div>
    </div>
  )
}
