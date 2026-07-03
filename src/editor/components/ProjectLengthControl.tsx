'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore, MIN_TOTAL_BARS, MAX_TOTAL_BARS } from '../store/ProjectStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Vertical drag sensitivity: bars per pixel (up = longer).
const BARS_PER_PX = 0.25

/**
 * Project-length readout that doubles as a vertical drag scrubber, the same
 * interaction as BpmControl. Writes totalBars to the project store — the ruler,
 * timeline width, and transport end all follow from there.
 */
export function ProjectLengthControl() {
  const totalBars = useProjectStore((s) => s.totalBars)

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startBars = useProjectStore.getState().totalBars
    lockCursor('ns-resize')

    const controller = new AbortController()
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        MIN_TOTAL_BARS,
        Math.min(MAX_TOTAL_BARS, Math.round(startBars + (startY - ev.clientY) * BARS_PER_PX)),
      )
      useProjectStore.getState().setTotalBars(next)
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
      title="Drag up / down to change project length"
      className="font-mono text-xs text-zinc-500 select-none tabular-nums cursor-ns-resize hover:text-zinc-400 transition-colors"
    >
      BARS:{' '}
      <span className="text-zinc-200">{totalBars}</span>
    </span>
  )
}
