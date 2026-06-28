'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore, MIN_BPM, MAX_BPM } from '../store/ProjectStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Vertical drag sensitivity: bpm change per pixel (up = faster).
const BPM_PER_PX = 0.5

/**
 * Tempo readout that doubles as a vertical drag scrubber — drag up to raise the
 * BPM, down to lower it. Writes the project store; the live transport follows via
 * the bpm subscription in usePlayback (which also covers undo/redo while playing).
 */
export function BpmControl() {
  const bpm = useProjectStore((s) => s.bpm)

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startBpm = useProjectStore.getState().bpm
    lockCursor('ns-resize')

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        MIN_BPM,
        Math.min(MAX_BPM, Math.round(startBpm + (startY - ev.clientY) * BPM_PER_PX)),
      )
      useProjectStore.getState().setBpm(next)
    }
    const onUp = () => {
      unlockCursor()
      controller.abort()
    }
    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }

  return (
    <span
      onPointerDown={onPointerDown}
      title="Drag up / down to change tempo"
      className="font-mono text-xs text-zinc-500 select-none tabular-nums cursor-ns-resize hover:text-zinc-400 transition-colors"
    >
      BPM:{' '}
      <span className="text-zinc-200">{bpm}</span>
    </span>
  )
}
