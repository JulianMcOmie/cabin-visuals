'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore, MIN_TOTAL_BARS, MAX_TOTAL_BARS } from '../store/ProjectStore'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

// Vertical drag sensitivity: bars per pixel (up = longer).
const BARS_PER_PX = 0.25
// Two pointer-downs within this window (ms) count as a double-click → type mode.
const DOUBLE_CLICK_MS = 350

/**
 * Project-length readout that doubles as a vertical drag scrubber and a
 * double-click-to-type field, the same interaction as BpmControl. Writes
 * totalBars to the project store — the ruler, timeline width, and transport
 * end all follow from there.
 */
export function ProjectLengthControl() {
  const totalBars = useProjectStore((s) => s.totalBars)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const lastDownRef = useRef(0)

  const commit = () => {
    const n = parseInt(draft, 10)
    if (!Number.isNaN(n)) {
      useProjectStore.getState().setTotalBars(Math.max(MIN_TOTAL_BARS, Math.min(MAX_TOTAL_BARS, n)))
    }
    setEditing(false)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    // Double-click (two downs close in time) enters type-to-edit; detected by
    // timing so it doesn't depend on pointer-event `detail`, which browsers
    // populate inconsistently.
    const now = e.timeStamp
    if (now - lastDownRef.current < DOUBLE_CLICK_MS) {
      lastDownRef.current = 0
      e.preventDefault()
      setDraft(String(useProjectStore.getState().totalBars))
      setEditing(true)
      return
    }
    lastDownRef.current = now

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

  // Readout and input share identical box metrics (padding, border, ch-based
  // width for the current digit count), so toggling edit mode never reflows —
  // and a 2-digit value doesn't reserve 3 digits of dead space.
  const box = 'inline-block box-content align-baseline font-mono text-xs tabular-nums px-1 rounded border'
  const chWidth = (len: number) => ({ width: `${Math.max(2, len)}ch` })

  return (
    <span className="font-mono text-xs text-zinc-500 select-none tabular-nums">
      BARS:{' '}
      {editing ? (
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          style={chWidth(draft.length)}
          className={`${box} bg-zinc-800 text-zinc-100 border-zinc-600 outline-none focus:border-zinc-400`}
        />
      ) : (
        // Only the number is the drag / double-click target — not the label.
        <span
          onPointerDown={onPointerDown}
          title="Drag up / down to change project length — double-click to type"
          style={chWidth(String(totalBars).length)}
          className={`${box} border-transparent text-zinc-200 cursor-ns-resize hover:text-zinc-100 transition-colors`}
        >
          {totalBars}
        </span>
      )}
    </span>
  )
}
